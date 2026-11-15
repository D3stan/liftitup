import type {
  KpiBeforeAfter,
  PrRecord,
  RankTier,
  Schedule,
  SessionDebriefImpact,
  UserProfile,
  WorkoutSession,
} from '@/types/domain';
import { computeWeeklyMuscleVolumes } from '@/lib/hypertrophy/analytics';

export function computeLevelAndRank(xp: number): {
  level: number;
  rankTier: RankTier;
  xpToNextLevel: number;
} {
  const safeXp = Math.max(0, Math.round(xp));
  let level = 1;
  while (safeXp >= Math.round(500 * Math.pow(level, 1.25))) {
    level++;
    if (level > 99) break;
  }
  const xpToNextLevel = Math.round(500 * Math.pow(level, 1.25));

  let rankTier: RankTier = 'Iron';
  if (level >= 30) rankTier = 'Olympian';
  else if (level >= 23) rankTier = 'Titan';
  else if (level >= 17) rankTier = 'Diamond';
  else if (level >= 12) rankTier = 'Gold';
  else if (level >= 8) rankTier = 'Silver';
  else if (level >= 4) rankTier = 'Bronze';

  return { level, rankTier, xpToNextLevel };
}

export function calculateSessionImpact(params: {
  user: UserProfile;
  session: WorkoutSession;
  previousSessions: WorkoutSession[];
  schedule: Schedule;
  prsUnlocked: PrRecord[];
}): SessionDebriefImpact {
  const { user, session, previousSessions, prsUnlocked } = params;

  const baseSetXp = session.sets.length * 25;
  const rirPrecisionSets = session.sets.filter(
    (s) => s.rir >= 0 && s.rir <= 3
  ).length;
  const rirBonusXp = rirPrecisionSets * 10;
  const completionXp = 150;
  const streakBonusXp = Math.min(150, (user.currentStreak + 1) * 12);
  const prBonusXp = prsUnlocked.length * 200;

  const xpEarned =
    baseSetXp + rirBonusXp + completionXp + streakBonusXp + prBonusXp;

  const xpBreakdown = [
    { label: `Working Sets (${session.sets.length} × 25 XP)`, xp: baseSetXp },
    { label: `Hypertrophy RIR Precision (${rirPrecisionSets} sets)`, xp: rirBonusXp },
    { label: 'Session Completion Bonus', xp: completionXp },
    { label: `Streak Multiplier (🔥 ${user.currentStreak + 1}d)`, xp: streakBonusXp },
  ];
  if (prBonusXp > 0) {
    xpBreakdown.push({
      label: `Boss PR Milestone (${prsUnlocked.length} PRs)`,
      xp: prBonusXp,
    });
  }

  const prevState = computeLevelAndRank(user.xp);
  const nextState = computeLevelAndRank(user.xp + xpEarned);

  const beforeVolumes = computeWeeklyMuscleVolumes(previousSessions);
  const afterVolumes = computeWeeklyMuscleVolumes([session, ...previousSessions]);

  const muscleLandmarksCrossed = afterVolumes
    .filter((afterM) => {
      const beforeM = beforeVolumes.find((b) => b.muscle === afterM.muscle);
      return beforeM && afterM.weeklySets > beforeM.weeklySets;
    })
    .map((afterM) => {
      const beforeM = beforeVolumes.find((b) => b.muscle === afterM.muscle)!;
      let zone: 'below_mev' | 'mev' | 'mav_optimal' | 'mrv_danger' = 'below_mev';
      if (afterM.zone === 'mrv_overreaching') zone = 'mrv_danger';
      else if (afterM.zone === 'mav_sweet_spot') zone = 'mav_optimal';
      else if (afterM.zone === 'mev_to_mav') zone = 'mev';
      return {
        muscle: afterM.muscle,
        previousSets: beforeM.weeklySets,
        newSets: afterM.weeklySets,
        zone,
      };
    });

  const lastSameRoutine = previousSessions.find(
    (s) => s.routineLabel === session.routineLabel
  );
  const prevVol = lastSameRoutine
    ? Math.round(lastSameRoutine.totalVolumeKg)
    : Math.max(0, Math.round(session.totalVolumeKg * 0.94));
  const newVol = Math.round(session.totalVolumeKg);
  const volDelta = newVol - prevVol;

  const beforeAfterKpis: KpiBeforeAfter[] = [
    {
      label: 'Session Tonnage',
      before: `${prevVol.toLocaleString()} kg`,
      after: `${newVol.toLocaleString()} kg`,
      deltaText: `${volDelta >= 0 ? '+' : ''}${volDelta.toLocaleString()} kg`,
      direction: volDelta >= 0 ? 'up' : 'down',
      hitTarget: volDelta >= 0,
    },
    {
      label: 'Athlete XP & Level',
      before: `Lv.${prevState.level} (${user.xp.toLocaleString()})`,
      after: `Lv.${nextState.level} (${(user.xp + xpEarned).toLocaleString()})`,
      deltaText: `+${xpEarned} XP`,
      direction: 'up',
      hitTarget: true,
    },
    {
      label: 'Consistency Streak',
      before: `${user.currentStreak}d`,
      after: `${user.currentStreak + 1}d`,
      deltaText: '+1 Day 🔥',
      direction: 'up',
      hitTarget: true,
    },
    {
      label: 'PRs Unlocked',
      before: '0',
      after: `${prsUnlocked.length}`,
      deltaText: prsUnlocked.length > 0 ? `+${prsUnlocked.length} NEW PR!` : 'Solid Base',
      direction: prsUnlocked.length > 0 ? 'up' : 'neutral',
      hitTarget: prsUnlocked.length > 0,
    },
  ];

  const coachTakeaway =
    prsUnlocked.length > 0
      ? `Huge hypertrophy stimulus! You unlocked ${prsUnlocked.length} new PR(s) and pushed ${
          muscleLandmarksCrossed.filter((m) => m.zone === 'mav_optimal').length
        } muscle group(s) directly into the MAV sweet spot.`
      : `Clean mechanical tension logged across ${session.sets.length} sets (${newVol.toLocaleString()} kg volume). Next session's Smart Double-Progression targets have been updated!`;

  return {
    session,
    xpEarned,
    xpBreakdown,
    previousLevel: prevState.level,
    newLevel: nextState.level,
    leveledUp: nextState.level > prevState.level,
    previousRank: prevState.rankTier,
    newRank: nextState.rankTier,
    streakAfter: user.currentStreak + 1,
    prsUnlocked,
    muscleLandmarksCrossed,
    beforeAfterKpis,
    coachTakeaway,
  };
}
