import type {
  PrecompiledSession,
  PrecompiledSlot,
  PrecompiledSet,
  ProgressionType,
  Schedule,
  UserProfile,
  WorkoutSession,
} from '@/types/domain';
import { getExerciseById, getExercisesBySlot, DAY_NAMES } from './exercises';
import {
  computeEffectiveLoadKg,
  computeExerciseE1rm,
  computeSlotCanonicalE1rm,
  effectiveLoadToEnteredWeightKg,
  roundToStep,
} from './equivalence';

const DEFAULT_STARTING_EFFECTIVE_LOAD_BY_SLOT: Record<string, number> = {
  horizontal_press: 75,
  incline_press: 62.5,
  chest_isolation: 50,
  vertical_pull: 72.5,
  horizontal_pull: 70,
  vertical_press: 50,
  lateral_delt: 15,
  rear_delt: 45,
  squat_pattern: 100,
  hinge_pattern: 95,
  knee_extension: 60,
  knee_flexion: 55,
  elbow_flexion: 27.5,
  elbow_extension: 32.5,
  calf_core: 70,
};

export function precompileSessionForUser(params: {
  user: UserProfile;
  schedule: Schedule;
  dayOfWeek?: number;
  date?: string;
  recentSessions: WorkoutSession[];
  sessionSwaps?: Record<string, string>; // scheduleSlotId -> overrideExerciseId
}): PrecompiledSession {
  const now = new Date();
  const dateStr = params.date || now.toISOString().slice(0, 10);
  // JS getDay(): 0=Sun..6=Sat -> convert to 0=Mon..6=Sun
  const jsDay = now.getDay();
  const defaultMonZeroDay = jsDay === 0 ? 6 : jsDay - 1;
  const targetDayOfWeek =
    params.dayOfWeek !== undefined && params.dayOfWeek !== null
      ? ((params.dayOfWeek % 7) + 7) % 7
      : defaultMonZeroDay;

  const scheduleDay =
    params.schedule.days.find((d) => d.dayOfWeek === targetDayOfWeek) ||
    params.schedule.days[0];

  const bw = params.user.bodyweightKg || 78.5;

  const todayCompleted = params.recentSessions.find(
    (s) => s.completedAt && s.completedAt.slice(0, 10) === dateStr
  );

  const compiledSlots: PrecompiledSlot[] = (scheduleDay?.slots || []).map(
    (slot, idx) => {
      const overrideExerciseId = params.sessionSwaps?.[slot.id];
      const activeExerciseId = overrideExerciseId || slot.exerciseId;
      const exercise = getExerciseById(activeExerciseId);
      const defaultExercise = getExerciseById(slot.exerciseId);
      const isSwappedVariation = activeExerciseId !== slot.exerciseId;

      // 1. Find most recent session with sets for this exact exercise
      const directMatchSession = params.recentSessions.find((sess) =>
        sess.sets.some((st) => st.exerciseId === activeExerciseId)
      );
      const directSets = directMatchSession
        ? directMatchSession.sets.filter((st) => st.exerciseId === activeExerciseId)
        : [];

      // 2. Also find most recent session with sets in the same movementSlot
      const slotMatchSession = params.recentSessions.find((sess) =>
        sess.sets.some((st) => st.movementSlot === slot.movementSlot)
      );
      const slotSets = slotMatchSession
        ? slotMatchSession.sets.filter(
            (st) => st.movementSlot === slot.movementSlot
          )
        : [];

      let progressionType: ProgressionType = 'new_slot';
      let progressionBadge = '🎯 BASELINE TARGET';
      let progressionReason = `Calibrated starting load for ${exercise.name} (${slot.repRangeMin}-${slot.repRangeMax} reps @ RIR ${slot.targetRir}).`;
      let previousSummary = 'First time logging this slot — baseline pre-filled';
      let targetWeightKg = effectiveLoadToEnteredWeightKg(
        exercise,
        DEFAULT_STARTING_EFFECTIVE_LOAD_BY_SLOT[slot.movementSlot] || 50,
        bw
      );
      let targetReps = slot.repRangeMin;
      const targetRir = slot.targetRir ?? 1;

      if (directSets.length > 0 && !isSwappedVariation) {
        const lastWeights = directSets.map((s) => s.weightKg);
        const topWeight = Math.max(...lastWeights);
        const avgReps = Math.round(
          directSets.reduce((acc, s) => acc + s.reps, 0) / directSets.length
        );
        const minRepsHit = Math.min(...directSets.map((s) => s.reps));
        const avgRir =
          directSets.reduce((acc, s) => acc + (s.rir ?? 1), 0) /
          directSets.length;

        const repsListStr = directSets.map((s) => s.reps).join(', ');
        previousSummary = `Last: ${
          exercise.loadType === 'bodyweight_plus'
            ? `BW + ${topWeight}kg`
            : `${topWeight}kg`
        } × ${repsListStr} @ RIR ${Math.round(avgRir)}`;

        // Smart Double-Progression Decision Tree
        if (minRepsHit >= slot.repRangeMax && avgRir >= Math.max(0, targetRir - 0.5)) {
          progressionType = 'load_up';
          const step = exercise.defaultStepKg || 2.5;
          targetWeightKg = roundToStep(topWeight + step, step);
          targetReps = slot.repRangeMin;
          progressionBadge = `🚀 LOAD UP +${step}kg`;
          progressionReason = `You hit ${repsListStr} reps (top of ${slot.repRangeMin}-${slot.repRangeMax} range) last session! Auto-stepping load by +${step}kg and resetting target to ${slot.repRangeMin} reps.`;
        } else if (minRepsHit >= slot.repRangeMin) {
          progressionType = 'add_rep';
          targetWeightKg = topWeight;
          targetReps = Math.min(slot.repRangeMax, avgReps + 1);
          progressionBadge = `📈 +1 REP TARGET (${targetReps}r)`;
          progressionReason = `Solid sets at ${
            exercise.loadType === 'bodyweight_plus'
              ? `BW + ${topWeight}kg`
              : `${topWeight}kg`
          } (${repsListStr}). Keep load locked and push for ${targetReps} reps per set today!`;
        } else {
          progressionType = 'hold';
          targetWeightKg = topWeight;
          targetReps = slot.repRangeMin;
          progressionBadge = '🛡️ HOLD & OWN LOAD';
          progressionReason = `Last session dipped below ${slot.repRangeMin} reps (${repsListStr}). Consolidate ${topWeight}kg for clean ${slot.repRangeMin}+ rep sets before adding weight.`;
        }
      } else if (slotSets.length > 0) {
        // Variation Equivalence Path (e.g. swapped Lat Pulldown <-> Weighted Chin-up)
        const refSet = slotSets[0];
        const refEx = getExerciseById(refSet.exerciseId);
        const refEffLoad = computeEffectiveLoadKg(refEx, refSet.weightKg, bw);
        const refE1rm = computeExerciseE1rm(refEffLoad, refSet.reps, refSet.rir);
        const slotCanonicalE1rm = computeSlotCanonicalE1rm(refEx, refE1rm);

        // Compute equivalent load + slight progressive overload (+1 rep or equivalent)
        const targetExE1rm =
          slotCanonicalE1rm * (exercise.canonicalEquivalenceRatio || 1.0);
        targetReps = Math.min(
          slot.repRangeMax,
          Math.max(slot.repRangeMin, refSet.reps)
        );
        const effReps = Math.min(18, targetReps + targetRir);
        const targetEffectiveLoad = targetExE1rm / (1 + effReps / 30);

        targetWeightKg = effectiveLoadToEnteredWeightKg(
          exercise,
          targetEffectiveLoad,
          bw
        );
        progressionType = 'variation_equiv';
        progressionBadge = '🔄 VARIATION EQUIV';
        previousSummary = `Equiv from ${refEx.name}: ${
          refEx.loadType === 'bodyweight_plus'
            ? `BW+${refSet.weightKg}kg`
            : `${refSet.weightKg}kg`
        } × ${refSet.reps}`;
        if (exercise.loadType === 'bodyweight_plus') {
          progressionReason = `Auto-converted from ${refEx.name} (${refSet.weightKg}kg × ${refSet.reps}). At ${bw}kg BW, equivalent load is BW + ${targetWeightKg}kg belt for ${targetReps} reps.`;
        } else {
          progressionReason = `Auto-converted from ${refEx.name} (${
            refEx.loadType === 'bodyweight_plus'
              ? `BW + ${refSet.weightKg}kg`
              : `${refSet.weightKg}kg`
          } × ${refSet.reps}) → ${targetWeightKg}kg × ${targetReps} reps.`;
        }
      }

      const effectiveLoadKg = computeEffectiveLoadKg(
        exercise,
        targetWeightKg,
        bw
      );
      const exerciseE1rmKg = computeExerciseE1rm(
        effectiveLoadKg,
        targetReps,
        targetRir
      );
      const slotCanonicalE1rmKg = computeSlotCanonicalE1rm(
        exercise,
        exerciseE1rmKg
      );

      const sets: PrecompiledSet[] = Array.from(
        { length: slot.targetSets },
        (_, sIdx) => {
          const prevSet = directSets[sIdx] || directSets[0] || slotSets[0];
          return {
            setNumber: sIdx + 1,
            targetWeightKg,
            targetReps,
            targetRir,
            effectiveLoadKg,
            previousWeightKg: prevSet ? prevSet.weightKg : null,
            previousReps: prevSet ? prevSet.reps : null,
            previousRir: prevSet ? prevSet.rir : null,
            completed: false,
            actualWeightKg: targetWeightKg,
            actualReps: targetReps,
            actualRir: targetRir,
          };
        }
      );

      return {
        slotIndex: idx,
        scheduleSlotId: slot.id,
        movementSlot: slot.movementSlot,
        exercise,
        defaultExerciseId: slot.exerciseId,
        isSwappedVariation,
        swappedFromExerciseName: isSwappedVariation
          ? defaultExercise.name
          : undefined,
        targetSets: slot.targetSets,
        repRangeMin: slot.repRangeMin,
        repRangeMax: slot.repRangeMax,
        targetRir,
        restSeconds: slot.restSeconds || exercise.defaultRestSeconds,
        progressionType,
        progressionBadge,
        progressionReason,
        previousSummary,
        slotCanonicalE1rmKg,
        exerciseE1rmKg,
        sets,
        siblingsInSlot: getExercisesBySlot(slot.movementSlot),
      };
    }
  );

  const totalSets = compiledSlots.reduce((acc, s) => acc + s.targetSets, 0);
  const estimatedDurationMin = scheduleDay?.isRestDay
    ? 0
    : Math.max(25, Math.round(totalSets * 3.2 + 8));

  return {
    date: dateStr,
    dayOfWeek: targetDayOfWeek,
    scheduleId: params.schedule.id,
    scheduleName: params.schedule.name,
    scheduleDayId: scheduleDay?.id || `day-${targetDayOfWeek}`,
    routineLabel:
      scheduleDay?.routineLabel || `${DAY_NAMES[targetDayOfWeek]} Session`,
    isRestDay: Boolean(scheduleDay?.isRestDay),
    focusMuscles: scheduleDay?.focusMuscles || [],
    estimatedDurationMin,
    userBodyweightKg: bw,
    slots: compiledSlots,
    alreadyCompletedToday: Boolean(todayCompleted),
    completedSessionId: todayCompleted?.id || null,
  };
}
