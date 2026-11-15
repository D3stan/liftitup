import type {
  AnalyticsSummary,
  AppleHealthWorkout,
  BossMilestone,
  ConsistencyDay,
  E1rmTrendPoint,
  MuscleGroup,
  MuscleRecoveryStatus,
  MuscleVolumeLandmark,
  PrRecord,
  Schedule,
  UserProfile,
  WorkoutSession,
} from '@/types/domain';
import { getExerciseById } from './exercises';
import {
  computeEffectiveLoadKg,
  computeExerciseE1rm,
  computeSlotCanonicalE1rm,
} from './equivalence';

export const MUSCLE_METADATA: {
  muscle: MuscleGroup;
  label: string;
  mv: number;
  mev: number;
  mavMin: number;
  mavMax: number;
  mrv: number;
}[] = [
  { muscle: 'chest', label: 'Chest (Pectorals)', mv: 4, mev: 8, mavMin: 10, mavMax: 18, mrv: 22 },
  { muscle: 'lats', label: 'Lats (Width)', mv: 4, mev: 8, mavMin: 10, mavMax: 18, mrv: 22 },
  { muscle: 'upper_back', label: 'Upper Back & Traps', mv: 4, mev: 6, mavMin: 10, mavMax: 18, mrv: 22 },
  { muscle: 'side_delts', label: 'Side Delts (Lateral)', mv: 4, mev: 8, mavMin: 12, mavMax: 20, mrv: 26 },
  { muscle: 'front_delts', label: 'Front Delts (Anterior)', mv: 2, mev: 4, mavMin: 6, mavMax: 12, mrv: 16 },
  { muscle: 'rear_delts', label: 'Rear Delts (Posterior)', mv: 3, mev: 6, mavMin: 8, mavMax: 16, mrv: 22 },
  { muscle: 'quads', label: 'Quadriceps', mv: 4, mev: 6, mavMin: 10, mavMax: 16, mrv: 20 },
  { muscle: 'hamstrings', label: 'Hamstrings', mv: 3, mev: 6, mavMin: 8, mavMax: 14, mrv: 18 },
  { muscle: 'glutes', label: 'Glutes', mv: 2, mev: 4, mavMin: 6, mavMax: 14, mrv: 18 },
  { muscle: 'biceps', label: 'Biceps', mv: 3, mev: 6, mavMin: 8, mavMax: 16, mrv: 20 },
  { muscle: 'triceps', label: 'Triceps', mv: 3, mev: 6, mavMin: 8, mavMax: 16, mrv: 20 },
  { muscle: 'calves', label: 'Calves', mv: 3, mev: 6, mavMin: 8, mavMax: 16, mrv: 20 },
  { muscle: 'abs', label: 'Core & Abs', mv: 0, mev: 4, mavMin: 6, mavMax: 14, mrv: 20 },
];

export function computeWeeklyMuscleVolumes(
  sessions: WorkoutSession[],
  referenceDate = new Date()
): MuscleVolumeLandmark[] {
  const sevenDaysAgo = referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recent7dSessions = sessions.filter(
    (s) => new Date(s.completedAt).getTime() >= sevenDaysAgo
  );

  // Also compute total all-time sets per muscle for Mastery Level
  const allTimeDirect: Record<string, number> = {};
  const directMap: Record<string, number> = {};
  const indirectMap: Record<string, number> = {};

  for (const sess of sessions) {
    const isLast7d = new Date(sess.completedAt).getTime() >= sevenDaysAgo;
    for (const set of sess.sets) {
      const ex = getExerciseById(set.exerciseId);
      allTimeDirect[ex.primaryMuscle] = (allTimeDirect[ex.primaryMuscle] || 0) + 1;
      for (const sec of ex.secondaryMuscles) {
        allTimeDirect[sec.muscle] =
          (allTimeDirect[sec.muscle] || 0) + sec.factor;
      }
      if (isLast7d) {
        directMap[ex.primaryMuscle] = (directMap[ex.primaryMuscle] || 0) + 1;
        for (const sec of ex.secondaryMuscles) {
          indirectMap[sec.muscle] = (indirectMap[sec.muscle] || 0) + sec.factor;
        }
      }
    }
  }

  // Ensure if user hasn't logged in the exact last 7 wall-clock days (e.g. demo seed edge), take latest 4 sessions
  const effectiveSessions =
    recent7dSessions.length > 0 ? recent7dSessions : sessions.slice(0, 4);
  if (recent7dSessions.length === 0) {
    for (const sess of effectiveSessions) {
      for (const set of sess.sets) {
        const ex = getExerciseById(set.exerciseId);
        directMap[ex.primaryMuscle] = (directMap[ex.primaryMuscle] || 0) + 1;
        for (const sec of ex.secondaryMuscles) {
          indirectMap[sec.muscle] = (indirectMap[sec.muscle] || 0) + sec.factor;
        }
      }
    }
  }

  return MUSCLE_METADATA.map((meta) => {
    const directSets = Number((directMap[meta.muscle] || 0).toFixed(1));
    const indirectSets = Number((indirectMap[meta.muscle] || 0).toFixed(1));
    const weeklySets = Number((directSets + indirectSets).toFixed(1));

    let zone: MuscleVolumeLandmark['zone'] = 'below_mev';
    if (weeklySets >= meta.mrv) {
      zone = 'mrv_overreaching';
    } else if (weeklySets >= meta.mavMin) {
      zone = 'mav_sweet_spot';
    } else if (weeklySets >= meta.mev) {
      zone = 'mev_to_mav';
    }

    const totalHistoricalSets = allTimeDirect[meta.muscle] || 0;
    const masteryXp = Math.round(totalHistoricalSets * 35);
    let masteryLevel = 1;
    let masteryTitle: MuscleVolumeLandmark['masteryTitle'] = 'Novice';
    if (totalHistoricalSets >= 70) {
      masteryLevel = 4;
      masteryTitle = 'Freak';
    } else if (totalHistoricalSets >= 40) {
      masteryLevel = 3;
      masteryTitle = 'Advanced';
    } else if (totalHistoricalSets >= 18) {
      masteryLevel = 2;
      masteryTitle = 'Intermediate';
    }

    return {
      muscle: meta.muscle,
      label: meta.label,
      weeklySets,
      directSets,
      indirectSets,
      mv: meta.mv,
      mev: meta.mev,
      mavMin: meta.mavMin,
      mavMax: meta.mavMax,
      mrv: meta.mrv,
      zone,
      masteryLevel,
      masteryTitle,
      masteryXp,
    };
  });
}

export function computeMuscleRecoveryMap(
  sessions: WorkoutSession[],
  referenceDate = new Date()
): MuscleRecoveryStatus[] {
  const nowMs = referenceDate.getTime();

  return MUSCLE_METADATA.map((meta) => {
    let hoursSinceLastTrained: number | null = null;
    let setsInLast72h = 0;

    for (const sess of sessions) {
      const diffHours = Math.max(
        1,
        Math.round((nowMs - new Date(sess.completedAt).getTime()) / (1000 * 3600))
      );
      let sessionMuscleSets = 0;
      for (const st of sess.sets) {
        const ex = getExerciseById(st.exerciseId);
        if (ex.primaryMuscle === meta.muscle) {
          sessionMuscleSets += 1;
        } else {
          const sec = ex.secondaryMuscles.find((s) => s.muscle === meta.muscle);
          if (sec) sessionMuscleSets += sec.factor;
        }
      }

      if (sessionMuscleSets > 0) {
        if (hoursSinceLastTrained === null || diffHours < hoursSinceLastTrained) {
          hoursSinceLastTrained = diffHours;
        }
        if (diffHours <= 72) {
          setsInLast72h += sessionMuscleSets;
        }
      }
    }

    let recoveryPct = 100;
    if (hoursSinceLastTrained !== null && hoursSinceLastTrained <= 72) {
      // Fatigue scales with sets logged and decays over 72 hours
      const initialFatigue = Math.min(88, Math.round(setsInLast72h * 11 + 20));
      const remainingFatigue = Math.round(
        initialFatigue * Math.max(0, 1 - hoursSinceLastTrained / 72)
      );
      recoveryPct = Math.min(100, Math.max(12, 100 - remainingFatigue));
    }

    let status: MuscleRecoveryStatus['status'] = 'fresh';
    if (recoveryPct < 50) {
      status = 'fatigued';
    } else if (recoveryPct < 85) {
      status = 'recovering';
    }

    const readyInHours =
      recoveryPct >= 85
        ? 0
        : Math.max(4, Math.round(((85 - recoveryPct) / 85) * 48));

    return {
      muscle: meta.muscle,
      label: meta.label,
      recoveryPct,
      status,
      hoursSinceLastTrained,
      lastSetsLogged: Number(setsInLast72h.toFixed(1)),
      readyInHours,
    };
  });
}

export function buildAnalyticsSummary(params: {
  user: UserProfile;
  schedule: Schedule;
  sessions: WorkoutSession[];
  prs: PrRecord[];
  appleHealthWorkouts: AppleHealthWorkout[];
}): AnalyticsSummary {
  const now = new Date();
  const sevenDaysAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const fourteenDaysAgo = now.getTime() - 14 * 24 * 3600 * 1000;

  const thisWeekSessions = params.sessions.filter(
    (s) => new Date(s.completedAt).getTime() >= sevenDaysAgo
  );
  const prevWeekSessions = params.sessions.filter((s) => {
    const t = new Date(s.completedAt).getTime();
    return t >= fourteenDaysAgo && t < sevenDaysAgo;
  });

  const weeklyTonnageKg = Math.round(
    (thisWeekSessions.length > 0
      ? thisWeekSessions
      : params.sessions.slice(0, 4)
    ).reduce((acc, s) => acc + s.totalVolumeKg, 0)
  );

  const previousWeekTonnageKg = Math.round(
    (prevWeekSessions.length > 0
      ? prevWeekSessions
      : params.sessions.slice(4, 8)
    ).reduce((acc, s) => acc + s.totalVolumeKg, 0)
  );

  const weeklySessionsTarget =
    params.schedule.days.filter((d) => !d.isRestDay).length || 5;
  const weeklySessionsCompleted =
    thisWeekSessions.length || Math.min(weeklySessionsTarget, params.sessions.slice(0, 4).length);

  const volumeLandmarks = computeWeeklyMuscleVolumes(params.sessions, now);
  const muscleRecovery = computeMuscleRecoveryMap(params.sessions, now);

  // Build chronological e1RM trend points (best top set per exercise per session)
  const sortedChronological = [...params.sessions].sort(
    (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
  );

  const e1rmTrends: E1rmTrendPoint[] = [];
  for (const sess of sortedChronological) {
    const byEx = new Map<string, typeof sess.sets[0]>();
    for (const st of sess.sets) {
      const ex = getExerciseById(st.exerciseId);
      const effLoad = computeEffectiveLoadKg(
        ex,
        st.weightKg,
        sess.userBodyweightKg || params.user.bodyweightKg
      );
      const e1rm = computeExerciseE1rm(effLoad, st.reps, st.rir);
      const existing = byEx.get(st.exerciseId);
      if (!existing || (existing.e1rmKg || 0) < e1rm) {
        byEx.set(st.exerciseId, {
          ...st,
          effectiveLoadKg: effLoad,
          e1rmKg: e1rm,
        });
      }
    }

    for (const [, bestSet] of byEx.entries()) {
      const ex = getExerciseById(bestSet.exerciseId);
      const effLoad =
        bestSet.effectiveLoadKg ||
        computeEffectiveLoadKg(ex, bestSet.weightKg, params.user.bodyweightKg);
      const exE1rm =
        bestSet.e1rmKg || computeExerciseE1rm(effLoad, bestSet.reps, bestSet.rir);
      const slotCanonical = computeSlotCanonicalE1rm(ex, exE1rm);

      e1rmTrends.push({
        date: sess.completedAt.slice(0, 10),
        sessionLabel: sess.routineLabel,
        exerciseId: ex.id,
        exerciseName: ex.name,
        movementSlot: ex.movementSlot,
        weightKg: bestSet.weightKg,
        effectiveLoadKg: effLoad,
        reps: bestSet.reps,
        rir: bestSet.rir,
        exerciseE1rmKg: exE1rm,
        slotCanonicalE1rmKg: slotCanonical,
      });
    }
  }

  // Boss Milestones
  const bestBenchE1rm = Math.max(
    0,
    ...e1rmTrends
      .filter((p) => p.movementSlot === 'horizontal_press')
      .map((p) => p.slotCanonicalE1rmKg)
  );
  const bestChinAdded = Math.max(
    0,
    ...e1rmTrends
      .filter((p) => p.exerciseId === 'weighted-chin-up')
      .map((p) => p.weightKg)
  );
  const bestSquatE1rm = Math.max(
    0,
    ...e1rmTrends
      .filter((p) => p.movementSlot === 'squat_pattern')
      .map((p) => p.slotCanonicalE1rmKg)
  );
  const bestRdlE1rm = Math.max(
    0,
    ...e1rmTrends
      .filter((p) => p.movementSlot === 'hinge_pattern')
      .map((p) => p.slotCanonicalE1rmKg)
  );
  const maxSessionVolume = Math.max(
    0,
    ...params.sessions.map((s) => s.totalVolumeKg)
  );

  const bossMilestones: BossMilestone[] = [
    {
      id: 'boss-bench-100',
      title: '2-Plate Bench Club (100kg e1RM)',
      subtitle: 'Horizontal Press Mastery',
      targetDescription: 'Reach 100kg e1RM on Barbell Bench or equivalent press',
      unlocked: bestBenchE1rm >= 100,
      progressPct: Math.min(100, Math.round((bestBenchE1rm / 100) * 100)),
      currentValueText: `${bestBenchE1rm.toFixed(1)} / 100 kg`,
      xpReward: 500,
      icon: 'Flame',
    },
    {
      id: 'boss-chinup-20',
      title: 'Weighted Chin-up +20kg Belt',
      subtitle: 'Vertical Pull Freak',
      targetDescription: 'Rep out Weighted Chin-ups with +20kg attached to dip belt',
      unlocked: bestChinAdded >= 20,
      progressPct: Math.min(100, Math.round((bestChinAdded / 20) * 100)),
      currentValueText: `+${bestChinAdded.toFixed(1)} / +20 kg`,
      xpReward: 600,
      icon: 'Shield',
    },
    {
      id: 'boss-squat-140',
      title: '3-Plate Squat Titan (140kg e1RM)',
      subtitle: 'Quad & Lower Body Dominance',
      targetDescription: 'Reach 140kg canonical Squat / Hack Squat e1RM',
      unlocked: bestSquatE1rm >= 140,
      progressPct: Math.min(100, Math.round((bestSquatE1rm / 140) * 100)),
      currentValueText: `${bestSquatE1rm.toFixed(1)} / 140 kg`,
      xpReward: 750,
      icon: 'Trophy',
    },
    {
      id: 'boss-rdl-150',
      title: 'Posterior Chain Steel (150kg Hinge e1RM)',
      subtitle: 'RDL & Hamstring Mastery',
      targetDescription: 'Reach 150kg e1RM on Romanian Deadlift / Hinge slot',
      unlocked: bestRdlE1rm >= 150,
      progressPct: Math.min(100, Math.round((bestRdlE1rm / 150) * 100)),
      currentValueText: `${bestRdlE1rm.toFixed(1)} / 150 kg`,
      xpReward: 650,
      icon: 'Zap',
    },
    {
      id: 'boss-tonnage-10k',
      title: '10-Ton Iron Moving Company',
      subtitle: 'Single-Session Hypertrophy Volume',
      targetDescription: 'Move 10,000+ kg total effective volume in one workout',
      unlocked: maxSessionVolume >= 10000,
      progressPct: Math.min(100, Math.round((maxSessionVolume / 10000) * 100)),
      currentValueText: `${Math.round(maxSessionVolume).toLocaleString()} / 10,000 kg`,
      xpReward: 500,
      icon: 'Dumbbell',
    },
  ];

  // 28-day consistency calendar
  const consistencyCalendar: ConsistencyDay[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
    const dateKey = d.toISOString().slice(0, 10);
    const match = params.sessions.find(
      (s) => s.completedAt.slice(0, 10) === dateKey
    );
    const jsDay = d.getDay();
    const monZero = jsDay === 0 ? 6 : jsDay - 1;
    const schedDay = params.schedule.days.find((sd) => sd.dayOfWeek === monZero);

    consistencyCalendar.push({
      date: dateKey,
      trained: Boolean(match),
      routineLabel: match?.routineLabel || schedDay?.routineLabel,
      volumeKg: match?.totalVolumeKg,
      prsCount: match?.prsCount,
      isScheduledRest: Boolean(schedDay?.isRestDay),
    });
  }

  return {
    user: params.user,
    weeklyTonnageKg,
    previousWeekTonnageKg,
    weeklySessionsCompleted,
    weeklySessionsTarget,
    volumeLandmarks,
    muscleRecovery,
    e1rmTrends,
    recentPrs: params.prs.slice(0, 15),
    bossMilestones,
    recentSessions: params.sessions.slice(0, 15),
    appleHealthWorkouts: params.appleHealthWorkouts.slice(0, 10),
    consistencyCalendar,
  };
}
