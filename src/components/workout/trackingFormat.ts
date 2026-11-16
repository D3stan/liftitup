import type {
  ExercisePrefill,
  ScheduleDayExercise,
  TrackingType,
  WeightUnit,
  WorkoutSet,
} from '@/types/domain';
import type { DraftRestClock } from '@/lib/workouts/clock';

export type { DraftRestClock };

export interface LoggerRepQuality {
  repIndex: number;
  qualityPct: number;
}

export interface LoggerSet {
  localId: string;
  setNumber: number;
  weightDisplay: string; // string so mobile decimal typing like "12." works cleanly
  reps: string;
  timeSeconds: string;
  distanceM: string;
  restSeconds: number | null;
  executionQualityPct: number | null;
  repQualities: LoggerRepQuality[];
  isCompleted: boolean;
  /** ISO timestamp when this set was marked completed (consumed by Phase 3). */
  completedAt?: string | null;
  /** ISO timestamp when user explicitly stopped the rest clock after this set (consumed by Phase 3). */
  restEndedAt?: string | null;
}

export interface LoggerExercise {
  localId: string;
  exerciseId: string;
  exerciseName: string;
  trackingType: TrackingType;
  defaultRestSeconds: number;
  scheduleDayExerciseId?: string | null;
  notes: string;
  sets: LoggerSet[];
}

export interface WorkoutDraft {
  cid: string;
  title: string;
  notes: string;
  isJolly: boolean;
  jollyMode: 'extra' | 'instead' | null;
  /** ISO timestamp when user started the session (Start button or first completed set), or null before starting. */
  startedAt: string | null;
  /** How the session clock started, if started. */
  sessionStartSource?: 'manual' | 'first_set' | null;
  /** Persisted rest clock state (stopwatch or countdown) so reloads preserve elapsed/target/stop state. */
  restClock?: DraftRestClock | null;
  exercises: LoggerExercise[];
  updatedAt: string;
}

const LB_PER_KG = 2.2046226218;

export function kgToDisplay(
  kg: number | null | undefined,
  unit: WeightUnit,
): number | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return null;
  if (unit === 'lb') {
    return Math.round(kg * LB_PER_KG * 10) / 10;
  }
  return Math.round(kg * 100) / 100;
}

export function displayToKg(
  val: number | null | undefined,
  unit: WeightUnit,
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (unit === 'lb') {
    return Math.round((val / LB_PER_KG) * 100) / 100;
  }
  return Math.round(val * 100) / 100;
}

export function parseOptionalNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed.replace(',', '.'));
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function parseOptionalInt(raw: string): number | null {
  const num = parseOptionalNum(raw);
  return num === null ? null : Math.round(num);
}

export function formatWeight(
  kg: number | null | undefined,
  unit: WeightUnit,
): string {
  const val = kgToDisplay(kg, unit);
  if (val === null) return `0${unit}`;
  return `${val}${unit}`;
}

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '0s';
  const s = Math.max(0, Math.round(sec));
  if (s >= 60 && s % 60 === 0) return `${s / 60}m`;
  if (s >= 60) {
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}m${String(rem).padStart(2, '0')}s`;
  }
  return `${s}s`;
}

export function trackingUsesWeight(t: TrackingType): boolean {
  return (
    t === 'weight_reps' ||
    t === 'weighted_bodyweight' ||
    t === 'assisted_bodyweight' ||
    t === 'weight_time'
  );
}

export function trackingUsesReps(t: TrackingType): boolean {
  return (
    t === 'weight_reps' ||
    t === 'bodyweight_reps' ||
    t === 'weighted_bodyweight' ||
    t === 'assisted_bodyweight'
  );
}

export function trackingUsesTime(t: TrackingType): boolean {
  return t === 'time' || t === 'weight_time' || t === 'distance_time';
}

export function trackingUsesDistance(t: TrackingType): boolean {
  return t === 'distance' || t === 'distance_time';
}

export function getWeightFieldLabel(t: TrackingType, unit: WeightUnit): string {
  if (t === 'weighted_bodyweight') return `+${unit}`;
  if (t === 'assisted_bodyweight') return `-${unit}`;
  return unit;
}

export function getTrackingShortLabel(t: TrackingType): string {
  switch (t) {
    case 'weight_reps':
      return 'Wt × Reps';
    case 'bodyweight_reps':
      return 'BW Reps';
    case 'weighted_bodyweight':
      return 'BW + Wt';
    case 'assisted_bodyweight':
      return 'BW − Assist';
    case 'time':
      return 'Time';
    case 'weight_time':
      return 'Wt × Time';
    case 'distance':
      return 'Dist';
    case 'distance_time':
      return 'Dist + Time';
  }
}

export function formatPlannedTarget(
  ex: ScheduleDayExercise,
  unit: WeightUnit,
): string {
  const t = ex.trackingType ?? 'weight_reps';
  const setsPrefix = `${ex.targetSets} × `;
  const repsPart =
    ex.targetReps !== null
      ? `${ex.targetReps}`
      : ex.targetRepsMin !== null && ex.targetRepsMax !== null
        ? ex.targetRepsMin === ex.targetRepsMax
          ? `${ex.targetRepsMin}`
          : `${ex.targetRepsMin}–${ex.targetRepsMax}`
        : ex.targetRepsMin !== null
          ? `${ex.targetRepsMin}+`
          : '';

  switch (t) {
    case 'weight_reps': {
      const w =
        ex.targetWeightKg !== null
          ? ` @ ${formatWeight(ex.targetWeightKg, unit)}`
          : '';
      return `${setsPrefix}${repsPart || '—'}${w}`;
    }
    case 'bodyweight_reps':
      return `${setsPrefix}${repsPart || '—'} BW`;
    case 'weighted_bodyweight': {
      const w =
        ex.targetWeightKg !== null
          ? ` @ +${formatWeight(ex.targetWeightKg, unit)}`
          : '';
      return `${setsPrefix}${repsPart || '—'}${w}`;
    }
    case 'assisted_bodyweight': {
      const w =
        ex.targetWeightKg !== null
          ? ` @ -${formatWeight(ex.targetWeightKg, unit)}`
          : '';
      return `${setsPrefix}${repsPart || '—'}${w}`;
    }
    case 'time':
      return `${setsPrefix}${formatDurationSec(ex.targetTimeSeconds)}`;
    case 'weight_time': {
      const w =
        ex.targetWeightKg !== null
          ? `${formatWeight(ex.targetWeightKg, unit)} × `
          : '';
      return `${setsPrefix}${w}${formatDurationSec(ex.targetTimeSeconds)}`;
    }
    case 'distance':
      return `${setsPrefix}${ex.targetDistanceM ?? 0}m`;
    case 'distance_time': {
      const dist = `${ex.targetDistanceM ?? 0}m`;
      const dur =
        ex.targetTimeSeconds !== null
          ? ` · ${formatDurationSec(ex.targetTimeSeconds)}`
          : '';
      return `${setsPrefix}${dist}${dur}`;
    }
  }
}

export function formatLoggedSet(
  set: WorkoutSet,
  trackingType: TrackingType,
  unit: WeightUnit,
): string {
  switch (trackingType) {
    case 'weight_reps':
      return `${formatWeight(set.weightKg, unit)} × ${set.reps ?? 0}`;
    case 'bodyweight_reps':
      return `${set.reps ?? 0} reps`;
    case 'weighted_bodyweight':
      return `+${formatWeight(set.weightKg, unit)} × ${set.reps ?? 0}`;
    case 'assisted_bodyweight':
      return `−${formatWeight(set.weightKg, unit)} × ${set.reps ?? 0}`;
    case 'time':
      return formatDurationSec(set.timeSeconds);
    case 'weight_time':
      return `${formatWeight(set.weightKg, unit)} × ${formatDurationSec(set.timeSeconds)}`;
    case 'distance':
      return `${set.distanceM ?? 0}m`;
    case 'distance_time':
      return `${set.distanceM ?? 0}m · ${formatDurationSec(set.timeSeconds)}`;
  }
}

export function formatPrefillSummary(
  prefill: ExercisePrefill | undefined | null,
  trackingType: TrackingType,
  unit: WeightUnit,
): string | null {
  if (!prefill || prefill.sets.length === 0) return null;
  const first = prefill.sets[0];
  const fakeSet: WorkoutSet = {
    id: 'prefill',
    workoutExerciseId: 'prefill',
    setNumber: first.setNumber,
    weightKg: first.weightKg,
    reps: first.reps,
    timeSeconds: first.timeSeconds,
    distanceM: first.distanceM,
    restSeconds: first.restSeconds,
    executionQualityPct: null,
    isCompleted: true,
    createdAt: '',
  };
  return `${prefill.sets.length}× ${formatLoggedSet(fakeSet, trackingType, unit)}`;
}

/**
 * §5 Row color coding for completed sets.
 */
export function getQualityRowColor(
  isCompleted: boolean,
  enableSetQuality: boolean,
  qualityPct: number | null,
): string {
  if (!isCompleted) return 'bg-[var(--card)]';
  if (!enableSetQuality || qualityPct === null || qualityPct === 100) {
    return 'bg-[var(--green-bg)]';
  }
  if (qualityPct >= 80) return 'bg-[var(--gold-bg)]';
  if (qualityPct >= 50) return 'bg-[color-mix(in_srgb,var(--gold-bg)_45%,var(--red-bg))]';
  return 'bg-[var(--red-bg)]';
}

export function getQualityBadgeColor(qualityPct: number | null): string {
  if (qualityPct === null || qualityPct === 100) return '!bg-[var(--green-bg)]';
  if (qualityPct >= 80) return '!bg-[var(--gold-bg)]';
  if (qualityPct >= 50) return '!bg-[color-mix(in_srgb,var(--gold-bg)_45%,var(--red-bg))]';
  return '!bg-[var(--red-bg)]';
}

export function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDisplayDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function makeLocalId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildPrefilledSets(params: {
  targetSets: number;
  trackingType: TrackingType;
  unit: WeightUnit;
  prefill?: ExercisePrefill | null;
  slot?: Partial<ScheduleDayExercise>;
}): LoggerSet[] {
  const { targetSets, unit, prefill, slot } = params;
  const count = Math.max(1, targetSets);
  const sets: LoggerSet[] = [];

  for (let i = 0; i < count; i += 1) {
    const prev =
      prefill?.sets[i] ?? prefill?.sets[prefill.sets.length - 1] ?? null;

    const wKg = prev?.weightKg ?? slot?.targetWeightKg ?? null;
    const wDisplay = kgToDisplay(wKg, unit);
    const repsVal =
      prev?.reps ?? slot?.targetReps ?? slot?.targetRepsMin ?? null;
    const timeVal = prev?.timeSeconds ?? slot?.targetTimeSeconds ?? null;
    const distVal = prev?.distanceM ?? slot?.targetDistanceM ?? null;
    const restVal = prev?.restSeconds ?? slot?.restSeconds ?? null;

    sets.push({
      localId: makeLocalId('set'),
      setNumber: i + 1,
      weightDisplay: wDisplay !== null ? String(wDisplay) : '',
      reps: repsVal !== null ? String(repsVal) : '',
      timeSeconds: timeVal !== null ? String(timeVal) : '',
      distanceM: distVal !== null ? String(distVal) : '',
      restSeconds: restVal,
      executionQualityPct: null,
      repQualities: [],
      isCompleted: false,
      completedAt: null,
      restEndedAt: null,
    });
  }

  return sets;
}
