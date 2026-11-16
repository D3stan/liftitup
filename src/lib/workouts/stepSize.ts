import type { WeightUnit } from '@/types/domain';

export const LB_PER_KG = 2.2046226218;

export const DEFAULT_WEIGHT_STEP_KG = 2.5;
export const DEFAULT_WEIGHT_STEP_LB = 5;
export const DEFAULT_REPS_STEP = 1;
export const DEFAULT_TIME_STEP_SECONDS = 5;
/** Default distance stepper increment in meters (10 m). */
export const DEFAULT_DISTANCE_STEP_M = 10;

export const KG_WEIGHT_STEP_OPTIONS = [0.5, 1.25, 2.5, 5, 10] as const;
export const LB_WEIGHT_STEP_OPTIONS = [1, 2.5, 5, 10] as const;

export type WeightStepSource = 'override' | 'exercise' | 'global' | 'default';

/**
 * Rounds a kg step value to 2 decimal places without floating-point noise.
 */
export function roundStepKg(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Snaps a step in pounds to the nearest fixed lb choice (1, 2.5, 5, 10 lb).
 */
export function snapLbStep(
  rawLb: number,
): (typeof LB_WEIGHT_STEP_OPTIONS)[number] {
  if (!Number.isFinite(rawLb) || rawLb <= 0) {
    return DEFAULT_WEIGHT_STEP_LB;
  }
  let best: (typeof LB_WEIGHT_STEP_OPTIONS)[number] = LB_WEIGHT_STEP_OPTIONS[0];
  let bestDiff = Math.abs(rawLb - best);
  for (const option of LB_WEIGHT_STEP_OPTIONS) {
    const diff = Math.abs(rawLb - option);
    if (diff < bestDiff) {
      best = option;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Converts a stored kg weight step (or null for default) to the user's display unit.
 * In lb mode, always snaps to the fixed list (1, 2.5, 5, 10 lb) so values like
 * 1.25 kg show as 2.5 lb rather than 2.7558 lb.
 */
export function stepKgToDisplay(
  stepKg: number | null | undefined,
  unit: WeightUnit,
): number {
  if (
    stepKg === null ||
    stepKg === undefined ||
    !Number.isFinite(stepKg) ||
    stepKg <= 0
  ) {
    return unit === 'lb' ? DEFAULT_WEIGHT_STEP_LB : DEFAULT_WEIGHT_STEP_KG;
  }
  if (unit === 'lb') {
    return snapLbStep(stepKg * LB_PER_KG);
  }
  return roundStepKg(stepKg);
}

/**
 * Converts a user-selected display step in `unit` to a clean kg value for DB storage.
 */
export function displayStepToKg(displayStep: number, unit: WeightUnit): number {
  if (!Number.isFinite(displayStep) || displayStep <= 0) {
    return DEFAULT_WEIGHT_STEP_KG;
  }
  if (unit === 'lb') {
    const snappedLb = snapLbStep(displayStep);
    return roundStepKg(snappedLb / LB_PER_KG);
  }
  return Math.max(0.05, roundStepKg(displayStep));
}

/**
 * Resolves the effective weight step in kg using the 3-level lookup order:
 * 1. Per-user exercise override (`user_exercise_prefs.weight_step_kg`)
 * 2. Exercise default (`exercises.weight_step_kg`)
 * 3. User global default (`users.default_weight_step_kg`)
 * 4. Unit default (`null`, meaning 2.5 kg or 5 lb)
 */
export function resolveWeightStepKg(sources: {
  userOverrideKg?: number | null;
  exerciseDefaultKg?: number | null;
  userGlobalDefaultKg?: number | null;
}): { stepKg: number | null; source: WeightStepSource } {
  if (
    sources.userOverrideKg !== null &&
    sources.userOverrideKg !== undefined &&
    Number.isFinite(sources.userOverrideKg) &&
    sources.userOverrideKg > 0
  ) {
    return { stepKg: sources.userOverrideKg, source: 'override' };
  }
  if (
    sources.exerciseDefaultKg !== null &&
    sources.exerciseDefaultKg !== undefined &&
    Number.isFinite(sources.exerciseDefaultKg) &&
    sources.exerciseDefaultKg > 0
  ) {
    return { stepKg: sources.exerciseDefaultKg, source: 'exercise' };
  }
  if (
    sources.userGlobalDefaultKg !== null &&
    sources.userGlobalDefaultKg !== undefined &&
    Number.isFinite(sources.userGlobalDefaultKg) &&
    sources.userGlobalDefaultKg > 0
  ) {
    return { stepKg: sources.userGlobalDefaultKg, source: 'global' };
  }
  return { stepKg: null, source: 'default' };
}

/**
 * Resolves the effective display step in `unit` and its lookup source.
 */
export function resolveDisplayWeightStep(sources: {
  userOverrideKg?: number | null;
  exerciseDefaultKg?: number | null;
  userGlobalDefaultKg?: number | null;
  unit: WeightUnit;
}): {
  displayStep: number;
  stepKg: number | null;
  source: WeightStepSource;
} {
  const resolved = resolveWeightStepKg(sources);
  return {
    ...resolved,
    displayStep: stepKgToDisplay(resolved.stepKg, sources.unit),
  };
}

/**
 * Derives the catalog default `weight_step_kg` for `syncExerciseCatalog`.
 * Uses explicit per-entry `weightStepKg` when provided, `1.25` for dumbbells,
 * and `null` for all other equipment so the user's global default applies.
 */
export function deriveCatalogWeightStepKg(ex: {
  equipment: string;
  weightStepKg?: number;
}): number | null {
  if (
    ex.weightStepKg !== undefined &&
    Number.isFinite(ex.weightStepKg) &&
    ex.weightStepKg > 0
  ) {
    return ex.weightStepKg;
  }
  if (ex.equipment === 'dumbbell') {
    return 1.25;
  }
  return null;
}

function countDecimals(num: number): number {
  if (!Number.isFinite(num)) return 0;
  const str = num.toString().toLowerCase();
  const expIdx = str.indexOf('e-');
  if (expIdx !== -1) {
    const mantissa = str.slice(0, expIdx);
    const exp = Number(str.slice(expIdx + 2));
    const dot = mantissa.indexOf('.');
    const fracLen = dot === -1 ? 0 : mantissa.length - dot - 1;
    return Math.min(8, fracLen + (Number.isFinite(exp) ? exp : 0));
  }
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

/**
 * Applies a single +1 or -1 step to a displayed numeric string, rounding to the
 * step's precision (eliminating float noise like 62.50000001) and clamping >= min.
 * When `currentRaw` is empty or invalid, steps from `fallbackValue` (or `min`).
 */
export function computeSteppedValue(params: {
  currentRaw: string;
  direction: 1 | -1;
  step: number;
  min?: number;
  max?: number;
  fallbackValue?: number | null;
}): string {
  const min = params.min ?? 0;
  const step =
    Number.isFinite(params.step) && params.step > 0 ? params.step : 1;

  const trimmed = params.currentRaw.trim().replace(',', '.');
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
  const hasCurrent = trimmed !== '' && Number.isFinite(parsed);

  let base: number;
  if (hasCurrent) {
    base = parsed;
  } else if (
    params.fallbackValue !== null &&
    params.fallbackValue !== undefined &&
    Number.isFinite(params.fallbackValue) &&
    params.fallbackValue >= min
  ) {
    base = params.fallbackValue;
  } else {
    base = min;
  }

  const stepDecimals = countDecimals(step);
  const baseDecimals = countDecimals(base);
  // Preserve user-entered decimals up to 3 places, while stripping float noise (> 4 places)
  const precision = Math.min(
    4,
    Math.max(stepDecimals, baseDecimals <= 3 ? baseDecimals : stepDecimals),
  );

  let next = base + params.direction * step;
  if (next < min) next = min;
  if (params.max !== undefined && Number.isFinite(params.max) && next > params.max) {
    next = params.max;
  }

  const rounded = Number(next.toFixed(precision));
  if (!Number.isFinite(rounded) || Object.is(rounded, -0)) {
    return String(min);
  }
  return String(rounded);
}
