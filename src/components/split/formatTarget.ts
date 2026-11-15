import type {
  ScheduleDayExercise,
  TrackingType,
  WeightUnit,
} from '@/types/domain';

const KG_TO_LB = 2.2046226218;

export function kgToUnit(kg: number, unit: WeightUnit): number {
  if (unit === 'lb') {
    return Math.round(kg * KG_TO_LB * 10) / 10;
  }
  return Math.round(kg * 10) / 10;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  if (unit === 'lb') {
    return Math.round((value / KG_TO_LB) * 100) / 100;
  }
  return Math.round(value * 100) / 100;
}

export function getLocalTodayIso(): string {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const TRACKING_TYPE_LABEL: Record<TrackingType, string> = {
  weight_reps: 'Weight × Reps',
  bodyweight_reps: 'Bodyweight',
  weighted_bodyweight: 'Weighted BW',
  assisted_bodyweight: 'Assisted BW',
  time: 'Time',
  weight_time: 'Weight × Time',
  distance: 'Distance',
  distance_time: 'Dist × Time',
};

function formatDurationShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

function formatRepsPart(ex: ScheduleDayExercise): string | null {
  if (ex.targetRepsMin !== null && ex.targetRepsMax !== null) {
    return ex.targetRepsMin === ex.targetRepsMax
      ? `${ex.targetRepsMin}`
      : `${ex.targetRepsMin}–${ex.targetRepsMax}`;
  }
  if (ex.targetReps !== null) {
    return `${ex.targetReps}`;
  }
  if (ex.targetRepsMin !== null) {
    return `${ex.targetRepsMin}+`;
  }
  return null;
}

/**
 * Formats a planned exercise's target line (e.g. "3 × 6–8 · 80 kg · 150s rest").
 */
export function formatExerciseTarget(
  ex: ScheduleDayExercise,
  unit: WeightUnit,
): string {
  const type: TrackingType = ex.trackingType ?? 'weight_reps';
  const parts: string[] = [];

  if (type === 'time' || type === 'weight_time') {
    const timeStr =
      ex.targetTimeSeconds !== null
        ? formatDurationShort(ex.targetTimeSeconds)
        : '—';
    parts.push(`${ex.targetSets} × ${timeStr}`);
  } else if (type === 'distance' || type === 'distance_time') {
    const distStr =
      ex.targetDistanceM !== null ? `${ex.targetDistanceM}m` : '—';
    if (type === 'distance_time' && ex.targetTimeSeconds !== null) {
      parts.push(
        `${ex.targetSets} × ${distStr} / ${formatDurationShort(ex.targetTimeSeconds)}`,
      );
    } else {
      parts.push(`${ex.targetSets} × ${distStr}`);
    }
  } else {
    const repsStr = formatRepsPart(ex) ?? '—';
    parts.push(`${ex.targetSets} × ${repsStr}`);
  }

  if (ex.targetWeightKg !== null) {
    const val = kgToUnit(ex.targetWeightKg, unit);
    if (type === 'weighted_bodyweight') {
      parts.push(`+${val} ${unit}`);
    } else if (type === 'assisted_bodyweight') {
      parts.push(`−${val} ${unit}`);
    } else if (
      type === 'weight_reps' ||
      type === 'weight_time'
    ) {
      parts.push(`${val} ${unit}`);
    }
  }

  parts.push(`${ex.restSeconds}s rest`);
  return parts.join(' · ');
}
