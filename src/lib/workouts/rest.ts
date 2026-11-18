import type { ExercisePrefill, WorkoutExercise } from '@/types/domain';

/** Maximum measured rest duration (15 minutes). Longer intervals are stored as unmeasured (`null`). */
export const MAX_MEASURED_REST_SECONDS = 900;

export interface RestSetTimingInput {
  isCompleted: boolean;
  isWarmup?: boolean;
  completedAt?: string | null;
  restEndedAt?: string | null;
  completionSeq?: number | null;
  wasUnchecked?: boolean;
  completedViaCheckAll?: boolean;
}

export interface ComputedSetRest {
  actualRestSeconds: number | null;
  restApproximate: boolean;
}

export interface SessionRestSummary {
  completedSetCount: number;
  nonFinalSetCount: number;
  measuredCount: number;
  measuredNonFinalCount: number;
  hasAnyApproximate: boolean;
  allRestsMeasured: boolean;
  hasUnmeasuredRests: boolean;
  totalRestSeconds: number;
  averageRestSeconds: number | null;
  durationSeconds: number | null;
  workingTimeSeconds: number | null;
}

export interface LastTimeRestMatch {
  actualRestSeconds: number;
  restApproximate: boolean;
}

function parseTimestampMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Formats a rest duration in seconds as `M:SS` (with leading `~` when approximate).
 * Returns an empty string when `seconds` is null/undefined/non-finite.
 */
export function formatRestSeconds(
  seconds: number | null | undefined,
  approximate = false,
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '';
  }
  const whole = Math.max(0, Math.round(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  const formatted = `${mins}:${String(secs).padStart(2, '0')}`;
  return approximate ? `~${formatted}` : formatted;
}

/**
 * Parses a user-entered rest string in either integer seconds (`"90"`) or `M:SS` (`"1:30"`).
 * Returns `null` for empty/invalid inputs.
 */
export function parseRestInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const mmss = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (mmss) {
    const mins = Number(mmss[1]);
    const secs = Number(mmss[2]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) {
      return null;
    }
    return mins * 60 + secs;
  }
  const numeric = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.round(numeric);
}

/**
 * Normalizes an explicitly supplied or computed rest interval against the 15-minute cutoff.
 * Negative or > 900s intervals are returned as `{ actualRestSeconds: null, restApproximate: false }`.
 */
export function normalizeMeasuredRestSeconds(
  rawSeconds: number | null | undefined,
  approximate: boolean,
): ComputedSetRest {
  if (
    rawSeconds === null ||
    rawSeconds === undefined ||
    !Number.isFinite(rawSeconds)
  ) {
    return { actualRestSeconds: null, restApproximate: false };
  }
  const rounded = Math.round(rawSeconds);
  if (rounded < 0 || rounded > MAX_MEASURED_REST_SECONDS) {
    return { actualRestSeconds: null, restApproximate: false };
  }
  return {
    actualRestSeconds: rounded,
    restApproximate: Boolean(approximate),
  };
}

/**
 * Computes per-set `actualRestSeconds` and `restApproximate` across a workout's exercises at save time.
 *
 * Rules:
 * - Rest belongs to the set it follows (pause between completing set N and starting/completing set N+1).
 * - Explicit rest stop (`restEndedAt - completedAt`) is exact (`restApproximate: false`).
 * - Fallback (`nextCompletedSet.completedAt - setN.completedAt`) is approximate (`restApproximate: true`).
 * - Crosses exercise boundaries (last completed set of exercise i -> first completed set of exercise i+1).
 * - Final completed set of the workout has no rest (`null`).
 * - Sets completed via "check all", sets un-ticked and re-ticked, or sets completed out of order get `null`.
 * - Intervals > 900s (15 min) or negative intervals become `null`.
 */
export function computeActualRestForWorkoutSets<T extends RestSetTimingInput>(
  exercises: ReadonlyArray<{ sets: ReadonlyArray<T> }>,
): ComputedSetRest[][] {
  const results: ComputedSetRest[][] = exercises.map((ex) =>
    ex.sets.map(() => ({ actualRestSeconds: null, restApproximate: false })),
  );

  interface CompletedRef {
    exIdx: number;
    setIdx: number;
    flatPos: number;
    set: T;
  }

  const completed: CompletedRef[] = [];
  const completedWarmups: Array<{ flatPos: number; set: T }> = [];
  let flatPos = 0;
  for (let exIdx = 0; exIdx < exercises.length; exIdx += 1) {
    const sets = exercises[exIdx].sets;
    for (let setIdx = 0; setIdx < sets.length; setIdx += 1) {
      const set = sets[setIdx];
      if (set.isCompleted) {
        if (set.isWarmup) {
          completedWarmups.push({ flatPos, set });
        } else {
          completed.push({ exIdx, setIdx, flatPos, set });
        }
      }
      flatPos += 1;
    }
  }

  if (completed.length <= 1) {
    return results;
  }

  // Only clean (non-check-all, non-unchecked) sets participate in completion-order checks.
  const isCleanTimingSet = (s: T): boolean =>
    !s.completedViaCheckAll && !s.wasUnchecked;

  const cleanSets = completed.filter((c) => isCleanTimingSet(c.set));
  const useCompletionSeq =
    cleanSets.length > 0 &&
    cleanSets.every(
      (c) =>
        typeof c.set.completionSeq === 'number' &&
        Number.isFinite(c.set.completionSeq),
    );

  const orderKeys: Array<number | null> = completed.map(({ set }) => {
    if (!isCleanTimingSet(set)) return null;
    if (useCompletionSeq) {
      return set.completionSeq as number;
    }
    return parseTimestampMs(set.completedAt);
  });

  const isOutOfOrder = (idx: number): boolean => {
    const key = orderKeys[idx];
    if (key === null) return true;
    for (let j = 0; j < idx; j += 1) {
      const earlier = orderKeys[j];
      if (earlier !== null && earlier > key) return true;
    }
    for (let j = idx + 1; j < completed.length; j += 1) {
      const later = orderKeys[j];
      if (later !== null && later < key) return true;
    }
    return false;
  };

  const hasWarmupBetween = (
    cur: CompletedRef,
    next: CompletedRef,
    startMs: number,
    nextStartMs: number,
  ): boolean => {
    for (const w of completedWarmups) {
      if (w.flatPos > cur.flatPos && w.flatPos < next.flatPos) {
        return true;
      }
      if (
        useCompletionSeq &&
        typeof w.set.completionSeq === 'number' &&
        Number.isFinite(w.set.completionSeq) &&
        typeof cur.set.completionSeq === 'number' &&
        typeof next.set.completionSeq === 'number' &&
        w.set.completionSeq > cur.set.completionSeq &&
        w.set.completionSeq < next.set.completionSeq
      ) {
        return true;
      }
      const wMs = parseTimestampMs(w.set.completedAt);
      if (wMs !== null && wMs > startMs && wMs < nextStartMs) {
        return true;
      }
    }
    return false;
  };

  for (let k = 0; k < completed.length - 1; k += 1) {
    const cur = completed[k];
    const { exIdx, setIdx, set } = cur;

    if (set.completedViaCheckAll || set.wasUnchecked) {
      continue;
    }
    if (isOutOfOrder(k)) {
      continue;
    }

    const startMs = parseTimestampMs(set.completedAt);
    if (startMs === null) {
      continue;
    }

    const explicitEndMs = parseTimestampMs(set.restEndedAt);
    if (explicitEndMs !== null) {
      const diffSeconds = (explicitEndMs - startMs) / 1000;
      results[exIdx][setIdx] = normalizeMeasuredRestSeconds(diffSeconds, false);
      continue;
    }

    const next = completed[k + 1];
    if (
      next.set.completedViaCheckAll ||
      next.set.wasUnchecked ||
      isOutOfOrder(k + 1)
    ) {
      continue;
    }

    const nextStartMs = parseTimestampMs(next.set.completedAt);
    if (nextStartMs === null) {
      continue;
    }

    if (hasWarmupBetween(cur, next, startMs, nextStartMs)) {
      continue;
    }

    const diffSeconds = (nextStartMs - startMs) / 1000;
    results[exIdx][setIdx] = normalizeMeasuredRestSeconds(diffSeconds, true);
  }

  return results;
}

/**
 * Computes per-session total rest, average rest, and working-vs-rest time split.
 * Working time vs rest time is only populated when every non-final completed set
 * has a measured `actualRestSeconds` and the session has a recorded `durationMinutes`.
 */
export function computeSessionRestSummary(session: {
  durationMinutes: number | null;
  exercises: ReadonlyArray<{
    sets: ReadonlyArray<
      Pick<
        WorkoutExercise['sets'][number],
        'isCompleted' | 'actualRestSeconds' | 'restApproximate'
      > & { isWarmup?: boolean }
    >;
  }>;
}): SessionRestSummary {
  const completedSets = session.exercises.flatMap((ex) =>
    ex.sets.filter((s) => !s.isWarmup && s.isCompleted !== false),
  );
  const completedSetCount = completedSets.length;
  const nonFinalSets =
    completedSetCount > 1 ? completedSets.slice(0, completedSetCount - 1) : [];
  const nonFinalSetCount = nonFinalSets.length;

  const measuredSets = completedSets.filter(
    (s) => s.actualRestSeconds !== null && s.actualRestSeconds !== undefined,
  );
  const measuredCount = measuredSets.length;
  const measuredNonFinalCount = nonFinalSets.filter(
    (s) => s.actualRestSeconds !== null && s.actualRestSeconds !== undefined,
  ).length;

  const hasAnyApproximate = measuredSets.some((s) => Boolean(s.restApproximate));
  const allRestsMeasured =
    nonFinalSetCount > 0 && measuredNonFinalCount === nonFinalSetCount;
  const hasUnmeasuredRests =
    nonFinalSetCount > 0 && measuredNonFinalCount < nonFinalSetCount;

  const totalRestSeconds = measuredSets.reduce(
    (sum, s) => sum + Math.max(0, Math.round(s.actualRestSeconds ?? 0)),
    0,
  );
  const averageRestSeconds =
    measuredCount > 0 ? Math.round(totalRestSeconds / measuredCount) : null;

  const durationSeconds =
    session.durationMinutes !== null &&
    session.durationMinutes !== undefined &&
    Number.isFinite(session.durationMinutes)
      ? Math.max(0, Math.round(session.durationMinutes * 60))
      : null;

  const workingTimeSeconds =
    allRestsMeasured && durationSeconds !== null
      ? Math.max(0, durationSeconds - totalRestSeconds)
      : null;

  return {
    completedSetCount,
    nonFinalSetCount,
    measuredCount,
    measuredNonFinalCount,
    hasAnyApproximate,
    allRestsMeasured,
    hasUnmeasuredRests,
    totalRestSeconds,
    averageRestSeconds,
    durationSeconds,
    workingTimeSeconds,
  };
}

/**
 * Looks up the actual rest from the most recent completed session for the same exercise
 * and same 0-based position among completed sets. Returns `null` if missing.
 */
export function getLastTimeRestForCompletedSet(
  prefill: ExercisePrefill | null | undefined,
  completedSetPosition: number,
): LastTimeRestMatch | null {
  if (
    !prefill ||
    !Number.isInteger(completedSetPosition) ||
    completedSetPosition < 0 ||
    completedSetPosition >= prefill.sets.length
  ) {
    return null;
  }
  const match = prefill.sets[completedSetPosition];
  if (
    !match ||
    match.actualRestSeconds === null ||
    match.actualRestSeconds === undefined ||
    !Number.isFinite(match.actualRestSeconds)
  ) {
    return null;
  }
  return {
    actualRestSeconds: Math.max(0, Math.round(match.actualRestSeconds)),
    restApproximate: Boolean(match.restApproximate),
  };
}
