import type { WeightUnit } from '@/types/domain';
import {
  displayToKg,
  formatDurationSec,
  parseOptionalInt,
  parseOptionalNum,
  trackingUsesDistance,
  trackingUsesReps,
  trackingUsesTime,
  trackingUsesWeight,
  type LoggerExercise,
} from '@/components/workout/trackingFormat';
import { computeSessionElapsedSeconds } from '@/lib/workouts/clock';
import {
  computeActualRestForWorkoutSets,
  computeSessionRestSummary,
} from '@/lib/workouts/rest';

export const FOCUS_EDGE_SWIPE_GUARD_PX = 28;
export const FOCUS_SWIPE_MIN_DISTANCE_PX = 50;
export const FOCUS_SWIPE_MAX_VERTICAL_RATIO = 0.75;

export interface FocusSwipeInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth: number;
  isInteractiveTarget?: boolean;
}

export interface FocusSummaryStats {
  elapsedSeconds: number;
  totalRestSeconds: number;
  workingTimeSeconds: number | null;
  allRestsMeasured: boolean;
  hasAnyApproximate: boolean;
  measuredRestCount: number;
  nonFinalSetCount: number;
  completedSetsCount: number;
  totalSetsCount: number;
  completedExercisesCount: number;
  totalExercisesCount: number;
  totalVolumeKg: number;
  totalVolumeDisplay: number;
}

/**
 * Clamps the Focus step index into `[0, exerciseCount]`, where `exerciseCount`
 * represents the post-workout Summary step (or empty-workout screen when 0).
 */
export function clampFocusIndex(index: number, exerciseCount: number): number {
  const safeMax = Math.max(0, Math.trunc(exerciseCount));
  if (!Number.isFinite(index)) return 0;
  const truncated = Math.trunc(index);
  if (truncated < 0) return 0;
  if (truncated > safeMax) return safeMax;
  return truncated;
}

/**
 * Adjusts `currentIndex` after deleting the exercise at `deletedIndex`.
 */
export function adjustFocusIndexAfterDelete(
  currentIndex: number,
  deletedIndex: number,
  nextExerciseCount: number,
): number {
  const prevCount = nextExerciseCount + 1;
  if (nextExerciseCount <= 0) return 0;
  if (currentIndex >= prevCount) {
    return nextExerciseCount;
  }
  if (deletedIndex < currentIndex) {
    return clampFocusIndex(currentIndex - 1, nextExerciseCount);
  }
  return clampFocusIndex(currentIndex, nextExerciseCount);
}

/**
 * Reorders an exercise from `fromIndex` to `toIndex` while keeping
 * `currentFocusIndex` tracking the active exercise (or staying on Summary).
 */
export function moveFocusExercise<T>(
  exercises: ReadonlyArray<T>,
  fromIndex: number,
  toIndex: number,
  currentFocusIndex: number,
): { exercises: T[]; nextFocusIndex: number } {
  const count = exercises.length;
  const clampedFocus = clampFocusIndex(currentFocusIndex, count);
  if (
    count <= 1 ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= count ||
    toIndex < 0 ||
    toIndex >= count
  ) {
    return {
      exercises: [...exercises],
      nextFocusIndex: clampedFocus,
    };
  }

  const next = [...exercises];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  let nextFocusIndex = clampedFocus;
  if (clampedFocus < count) {
    if (clampedFocus === fromIndex) {
      nextFocusIndex = toIndex;
    } else if (fromIndex < clampedFocus && clampedFocus <= toIndex) {
      nextFocusIndex = clampedFocus - 1;
    } else if (toIndex <= clampedFocus && clampedFocus < fromIndex) {
      nextFocusIndex = clampedFocus + 1;
    }
  }

  return {
    exercises: next,
    nextFocusIndex,
  };
}

/**
 * Evaluates a touch swipe gesture for Focus mode horizontal navigation.
 * Protects iOS Safari edge-back/forward swipes and vertical page scrolling.
 */
export function evaluateFocusSwipe(
  input: FocusSwipeInput,
): 'next' | 'prev' | null {
  if (input.isInteractiveTarget) {
    return null;
  }

  const { startX, startY, endX, endY, viewportWidth } = input;
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    !Number.isFinite(viewportWidth)
  ) {
    return null;
  }

  if (startX <= FOCUS_EDGE_SWIPE_GUARD_PX) {
    return null;
  }
  if (
    viewportWidth > 0 &&
    startX >= viewportWidth - FOCUS_EDGE_SWIPE_GUARD_PX
  ) {
    return null;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < FOCUS_SWIPE_MIN_DISTANCE_PX) {
    return null;
  }
  if (absDy >= absDx * FOCUS_SWIPE_MAX_VERTICAL_RATIO) {
    return null;
  }

  return dx < 0 ? 'next' : 'prev';
}

/**
 * Formats a concise one-line target preview for the next-exercise peek strip.
 */
export function formatExercisePeekTarget(
  exercise: LoggerExercise,
  unit: WeightUnit,
): string {
  const totalSets = exercise.sets.length;
  const setLabel = totalSets === 1 ? '1 set' : `${totalSets} sets`;
  const firstSet = exercise.sets[0];
  if (!firstSet) return setLabel;

  const t = exercise.trackingType;
  const wVal = parseOptionalNum(firstSet.weightDisplay);
  const rVal = parseOptionalInt(firstSet.reps);
  const tVal = parseOptionalInt(firstSet.timeSeconds);
  const dVal = parseOptionalNum(firstSet.distanceM);

  if (trackingUsesWeight(t) && trackingUsesReps(t)) {
    const prefix =
      t === 'weighted_bodyweight'
        ? '+'
        : t === 'assisted_bodyweight'
          ? '−'
          : '';
    if (wVal !== null && rVal !== null) {
      return `${setLabel} · ${prefix}${wVal}${unit} × ${rVal}`;
    }
    if (wVal !== null) {
      return `${setLabel} · ${prefix}${wVal}${unit}`;
    }
    if (rVal !== null) {
      return `${setLabel} · ${rVal} reps`;
    }
  }

  if (t === 'bodyweight_reps' && rVal !== null) {
    return `${setLabel} · ${rVal} reps`;
  }

  if (trackingUsesDistance(t) && trackingUsesTime(t)) {
    if (dVal !== null && tVal !== null) {
      return `${setLabel} · ${dVal}m · ${formatDurationSec(tVal)}`;
    }
    if (dVal !== null) return `${setLabel} · ${dVal}m`;
    if (tVal !== null) return `${setLabel} · ${formatDurationSec(tVal)}`;
  }

  if (t === 'distance' && dVal !== null) {
    return `${setLabel} · ${dVal}m`;
  }

  if (t === 'weight_time') {
    if (wVal !== null && tVal !== null) {
      return `${setLabel} · ${wVal}${unit} × ${formatDurationSec(tVal)}`;
    }
    if (tVal !== null) return `${setLabel} · ${formatDurationSec(tVal)}`;
    if (wVal !== null) return `${setLabel} · ${wVal}${unit}`;
  }

  if (t === 'time' && tVal !== null) {
    return `${setLabel} · ${formatDurationSec(tVal)}`;
  }

  return setLabel;
}

/**
 * Computes live Focus Summary statistics (total time, working vs rest time,
 * completed sets, and volume) reusing Phase 2 & Phase 3 helpers.
 */
export function computeFocusSummaryStats(params: {
  exercises: ReadonlyArray<LoggerExercise>;
  unit: WeightUnit;
  startedAt: string | null;
  durationMinutesInput?: string | null;
  isEditing?: boolean;
  nowMs?: number;
}): FocusSummaryStats {
  const {
    exercises,
    unit,
    startedAt,
    durationMinutesInput = null,
    isEditing = false,
    nowMs = Date.now(),
  } = params;

  const parsedEditDuration = isEditing
    ? parseOptionalInt(durationMinutesInput ?? '')
    : null;
  const elapsedSeconds = isEditing
    ? parsedEditDuration !== null
      ? Math.max(0, parsedEditDuration * 60)
      : 0
    : computeSessionElapsedSeconds(startedAt, nowMs);

  const restMatrix = isEditing ? null : computeActualRestForWorkoutSets(exercises);
  const restEvalExercises = exercises.map((ex, exIdx) => ({
    sets: ex.sets.map((s, setIdx) => ({
      isCompleted: s.isCompleted,
      isWarmup: s.isWarmup,
      actualRestSeconds: isEditing
        ? s.actualRestSeconds ?? null
        : restMatrix?.[exIdx]?.[setIdx]?.actualRestSeconds ?? null,
      restApproximate: isEditing
        ? Boolean(s.restApproximate)
        : restMatrix?.[exIdx]?.[setIdx]?.restApproximate ?? false,
    })),
  }));

  const durationMinutesForSummary = isEditing
    ? parsedEditDuration
    : startedAt
      ? Math.max(1, Math.round(elapsedSeconds / 60))
      : null;

  const restSummary = computeSessionRestSummary({
    durationMinutes: durationMinutesForSummary,
    exercises: restEvalExercises,
  });

  const workingTimeSeconds = isEditing
    ? restSummary.workingTimeSeconds
    : restSummary.allRestsMeasured && startedAt
      ? Math.max(0, elapsedSeconds - restSummary.totalRestSeconds)
      : null;

  let completedSetsCount = 0;
  let totalSetsCount = 0;
  let completedExercisesCount = 0;
  let totalVolumeDisplay = 0;
  let totalVolumeKg = 0;

  for (const ex of exercises) {
    const workingSets = ex.sets.filter((s) => !s.isWarmup);
    const setsCount = workingSets.length;
    totalSetsCount += setsCount;
    let exCompleted = 0;
    const supportsVolume =
      ex.trackingType === 'weight_reps' ||
      ex.trackingType === 'weighted_bodyweight';

    for (const s of workingSets) {
      if (!s.isCompleted) continue;
      completedSetsCount += 1;
      exCompleted += 1;

      if (supportsVolume) {
        const displayWeight = parseOptionalNum(s.weightDisplay);
        const reps = parseOptionalInt(s.reps);
        if (
          displayWeight !== null &&
          reps !== null &&
          displayWeight > 0 &&
          reps > 0
        ) {
          totalVolumeDisplay += displayWeight * reps;
          const weightKg = displayToKg(displayWeight, unit);
          if (weightKg !== null) {
            totalVolumeKg += weightKg * reps;
          }
        }
      }
    }

    if (setsCount > 0 && exCompleted === setsCount) {
      completedExercisesCount += 1;
    }
  }

  return {
    elapsedSeconds,
    totalRestSeconds: restSummary.totalRestSeconds,
    workingTimeSeconds,
    allRestsMeasured: restSummary.allRestsMeasured,
    hasAnyApproximate: restSummary.hasAnyApproximate,
    measuredRestCount: restSummary.measuredNonFinalCount,
    nonFinalSetCount: restSummary.nonFinalSetCount,
    completedSetsCount,
    totalSetsCount,
    completedExercisesCount,
    totalExercisesCount: exercises.length,
    totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
    totalVolumeDisplay: Math.round(totalVolumeDisplay * 10) / 10,
  };
}
