import type { RestClockMode } from '@/types/domain';

export interface DraftRestClock {
  /** ISO timestamp when the rest period started. */
  startedAt: string;
  /** Target rest duration in seconds (planned rest or adjusted target). */
  targetSeconds: number;
  /** Clock mode active for this rest instance ('stopwatch' | 'countdown'). */
  mode: RestClockMode;
  /** Label shown on the clock (e.g. exercise name). */
  label: string;
  /** Local ID of the exercise associated with this rest, if any. */
  exerciseLocalId: string | null;
  /** Local ID of the completed set this rest follows, if any. */
  setLocalId: string | null;
  /** ISO timestamp when the user explicitly tapped "Start next set", or null. */
  stoppedAt: string | null;
  /** Whether the floating rest clock is currently active. */
  isActive: boolean;
  /** Whether the target-reached alert has already fired for this rest instance. */
  alertFired: boolean;
}

export interface RestClockComputedState {
  isActive: boolean;
  mode: RestClockMode;
  elapsedSeconds: number;
  remainingSeconds: number;
  targetSeconds: number;
  targetReached: boolean;
  progressPct: number;
}

export function formatClockSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function createRestClock(params: {
  startedAt: string;
  targetSeconds: number;
  mode: RestClockMode;
  label?: string;
  exerciseLocalId?: string | null;
  setLocalId?: string | null;
}): DraftRestClock {
  const safeTarget = Number.isFinite(params.targetSeconds)
    ? Math.max(5, Math.round(params.targetSeconds))
    : 90;
  return {
    startedAt: params.startedAt,
    targetSeconds: safeTarget,
    mode: params.mode === 'countdown' ? 'countdown' : 'stopwatch',
    label: params.label ?? '',
    exerciseLocalId: params.exerciseLocalId ?? null,
    setLocalId: params.setLocalId ?? null,
    stoppedAt: null,
    isActive: true,
    alertFired: false,
  };
}

export function computeRestClockState(
  clock: DraftRestClock | null | undefined,
  nowMs: number,
): RestClockComputedState {
  if (!clock || !clock.isActive) {
    return {
      isActive: false,
      mode: clock?.mode === 'countdown' ? 'countdown' : 'stopwatch',
      elapsedSeconds: 0,
      remainingSeconds: 0,
      targetSeconds: clock?.targetSeconds ?? 0,
      targetReached: false,
      progressPct: 0,
    };
  }

  const startMs = Date.parse(clock.startedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    return {
      isActive: false,
      mode: clock.mode === 'countdown' ? 'countdown' : 'stopwatch',
      elapsedSeconds: 0,
      remainingSeconds: 0,
      targetSeconds: clock.targetSeconds,
      targetReached: false,
      progressPct: 0,
    };
  }

  const targetSeconds = Math.max(0, clock.targetSeconds);
  const elapsedSeconds = Math.max(0, (nowMs - startMs) / 1000);
  const remainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
  const targetReached =
    targetSeconds > 0 ? elapsedSeconds >= targetSeconds : true;
  const progressPct =
    targetSeconds > 0
      ? Math.min(100, Math.max(0, (elapsedSeconds / targetSeconds) * 100))
      : 100;

  return {
    isActive: true,
    mode: clock.mode === 'countdown' ? 'countdown' : 'stopwatch',
    elapsedSeconds,
    remainingSeconds,
    targetSeconds,
    targetReached,
    progressPct,
  };
}

export function shouldFireRestAlert(
  clock: DraftRestClock | null | undefined,
  nowMs: number,
): boolean {
  if (!clock || !clock.isActive || clock.alertFired) return false;
  return computeRestClockState(clock, nowMs).targetReached;
}

export function adjustRestClockTarget(
  clock: DraftRestClock,
  deltaSeconds: number,
  nowMs: number,
): DraftRestClock {
  const nextTarget = Math.max(5, Math.round(clock.targetSeconds + deltaSeconds));
  const startMs = Date.parse(clock.startedAt);
  const elapsedSeconds =
    Number.isFinite(startMs) && Number.isFinite(nowMs)
      ? Math.max(0, (nowMs - startMs) / 1000)
      : 0;
  return {
    ...clock,
    targetSeconds: nextTarget,
    alertFired: elapsedSeconds < nextTarget ? false : clock.alertFired,
  };
}

export function stopRestClock(
  clock: DraftRestClock,
  stoppedAtIso: string,
): DraftRestClock {
  return {
    ...clock,
    stoppedAt: stoppedAtIso,
    isActive: false,
  };
}

export function dismissRestClock(clock: DraftRestClock): DraftRestClock {
  return {
    ...clock,
    isActive: false,
  };
}

function parseValidTimestamp(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Resolves the session start timestamp as the earlier of `currentStartedAt`
 * and `candidateStartedAt`. Returns `null` when neither is set.
 */
export function resolveSessionStart(
  currentStartedAt: string | null | undefined,
  candidateStartedAt: string | null | undefined,
): string | null {
  const curMs = parseValidTimestamp(currentStartedAt);
  const candMs = parseValidTimestamp(candidateStartedAt);
  if (curMs === null && candMs === null) return null;
  if (curMs === null) return candidateStartedAt!.trim();
  if (candMs === null) return currentStartedAt!.trim();
  return curMs <= candMs ? currentStartedAt!.trim() : candidateStartedAt!.trim();
}

export function computeSessionElapsedSeconds(
  startedAt: string | null | undefined,
  nowMs: number,
): number {
  const startMs = parseValidTimestamp(startedAt);
  if (startMs === null || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function computeSessionDurationMinutes(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  const startMs = parseValidTimestamp(startedAt);
  const endMs = parseValidTimestamp(endedAt);
  if (startMs === null || endMs === null) return null;
  const diffMs = endMs - startMs;
  if (diffMs <= 0) return 0;
  return Math.min(600, Math.max(1, Math.round(diffMs / 60000)));
}
