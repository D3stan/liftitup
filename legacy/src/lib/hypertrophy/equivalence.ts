import type {
  ExerciseDefinition,
  PrecompiledSet,
  VariationSwapResponse,
} from '@/types/domain';
import { getExerciseById } from './exercises';

export function roundToStep(value: number, step = 2.5): number {
  const safeStep = step > 0 ? step : 2.5;
  return Math.round(value / safeStep) * safeStep;
}

/**
 * Computes total effective mechanical load moved by the athlete.
 * - external: logged weight as-is (e.g. 80kg on Lat Pulldown or Bench Press)
 * - unilateral_db: 2 * single dumbbell weight
 * - bodyweight_plus: (userBodyweightKg * bodyweightFactor) + addedExternalWeightKg
 */
export function computeEffectiveLoadKg(
  exercise: ExerciseDefinition,
  weightKg: number,
  userBodyweightKg: number
): number {
  const w = Math.max(0, Number(weightKg) || 0);
  const bw = Math.max(40, Number(userBodyweightKg) || 75);

  if (exercise.loadType === 'bodyweight_plus') {
    return Number((bw * exercise.bodyweightFactor + w).toFixed(1));
  }
  if (exercise.loadType === 'unilateral_db') {
    return Number((w * 2).toFixed(1));
  }
  return Number(w.toFixed(1));
}

/**
 * Converts a target total effective load back into the number the user enters on the bar/machine/belt.
 */
export function effectiveLoadToEnteredWeightKg(
  exercise: ExerciseDefinition,
  targetEffectiveLoadKg: number,
  userBodyweightKg: number
): number {
  const bw = Math.max(40, Number(userBodyweightKg) || 75);
  const step = exercise.defaultStepKg || 2.5;

  if (exercise.loadType === 'bodyweight_plus') {
    const rawAdded = targetEffectiveLoadKg - bw * exercise.bodyweightFactor;
    return Math.max(0, roundToStep(rawAdded, 1.25));
  }
  if (exercise.loadType === 'unilateral_db') {
    const perHand = targetEffectiveLoadKg / 2;
    return Math.max(2, roundToStep(perHand, step));
  }
  return Math.max(2.5, roundToStep(targetEffectiveLoadKg, step));
}

/**
 * Epley e1RM formula incorporating Reps in Reserve (RIR), capped at 15 effective reps.
 */
export function computeExerciseE1rm(
  effectiveLoadKg: number,
  reps: number,
  rir = 1
): number {
  const effReps = Math.min(18, Math.max(1, (Number(reps) || 1) + Math.max(0, Number(rir) || 0)));
  return Number((effectiveLoadKg * (1 + effReps / 30)).toFixed(1));
}

/**
 * Normalizes an exercise's e1RM to its MovementSlot canonical anchor e1RM.
 */
export function computeSlotCanonicalE1rm(
  exercise: ExerciseDefinition,
  exerciseE1rmKg: number
): number {
  const ratio = exercise.canonicalEquivalenceRatio || 1.0;
  return Number((exerciseE1rmKg / ratio).toFixed(1));
}

/**
 * Computes the equivalent weight, effective load, and precompiled set rows when swapping
 * between variations in the same movement slot (e.g. Lat Pulldown <-> Weighted Chin-up).
 */
export function computeVariationSwap(params: {
  fromExerciseId: string;
  toExerciseId: string;
  currentWeightKg: number;
  targetReps: number;
  targetRir: number;
  targetSets: number;
  userBodyweightKg: number;
  knownSlotCanonicalE1rm?: number;
  scope?: 'session' | 'schedule';
}): VariationSwapResponse {
  const fromEx = getExerciseById(params.fromExerciseId);
  const toEx = getExerciseById(params.toExerciseId);
  const targetReps = params.targetReps || toEx.defaultRepMin || 8;
  const targetRir = params.targetRir ?? 1;
  const targetSets = params.targetSets || 3;
  const bw = params.userBodyweightKg || 78.5;

  const fromEffectiveLoad = computeEffectiveLoadKg(
    fromEx,
    params.currentWeightKg,
    bw
  );
  const fromE1rm = computeExerciseE1rm(
    fromEffectiveLoad,
    targetReps,
    targetRir
  );
  const slotCanonicalE1rm =
    params.knownSlotCanonicalE1rm && params.knownSlotCanonicalE1rm > 0
      ? params.knownSlotCanonicalE1rm
      : computeSlotCanonicalE1rm(fromEx, fromE1rm);

  const targetToE1rm = slotCanonicalE1rm * (toEx.canonicalEquivalenceRatio || 1.0);
  const effReps = Math.min(18, targetReps + targetRir);
  const targetEffectiveLoad = Number(
    (targetToE1rm / (1 + effReps / 30)).toFixed(1)
  );

  const recommendedWeightKg = effectiveLoadToEnteredWeightKg(
    toEx,
    targetEffectiveLoad,
    bw
  );
  const actualEffectiveLoadKg = computeEffectiveLoadKg(
    toEx,
    recommendedWeightKg,
    bw
  );

  let explanationNote = '';
  if (toEx.loadType === 'bodyweight_plus') {
    const bwContribution = Number((bw * toEx.bodyweightFactor).toFixed(1));
    explanationNote = `Swapped ${fromEx.name} (${params.currentWeightKg}kg) → ${toEx.name}. At ${bw}kg BW (${bwContribution}kg pull base), add +${recommendedWeightKg}kg on belt (${actualEffectiveLoadKg}kg total effective load) for ${targetReps} reps @ RIR ${targetRir}.`;
  } else if (fromEx.loadType === 'bodyweight_plus') {
    explanationNote = `Swapped ${fromEx.name} (BW + ${params.currentWeightKg}kg = ${fromEffectiveLoad}kg effective) → ${toEx.name} at ${recommendedWeightKg}kg${
      toEx.loadType === 'unilateral_db' ? ' per DB' : ''
    } for ${targetReps} reps @ RIR ${targetRir}.`;
  } else {
    explanationNote = `Swapped ${fromEx.name} → ${toEx.name} using ${toEx.movementSlot.replace(
      '_',
      ' '
    )} equivalence (${recommendedWeightKg}kg${
      toEx.loadType === 'unilateral_db' ? ' per DB' : ''
    } × ${targetReps} @ RIR ${targetRir}, slot e1RM ${slotCanonicalE1rm}kg).`;
  }

  const sets: PrecompiledSet[] = Array.from({ length: targetSets }, (_, idx) => ({
    setNumber: idx + 1,
    targetWeightKg: recommendedWeightKg,
    targetReps,
    targetRir,
    effectiveLoadKg: actualEffectiveLoadKg,
    previousWeightKg: params.currentWeightKg,
    previousReps: targetReps,
    previousRir: targetRir,
    completed: false,
    actualWeightKg: recommendedWeightKg,
    actualReps: targetReps,
    actualRir: targetRir,
  }));

  return {
    fromExercise: fromEx,
    toExercise: toEx,
    recommendedWeightKg,
    effectiveLoadKg: actualEffectiveLoadKg,
    slotCanonicalE1rm,
    targetReps,
    targetRir,
    scope: params.scope || 'session',
    explanationNote,
    sets,
  };
}
