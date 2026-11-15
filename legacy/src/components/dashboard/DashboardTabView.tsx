'use client';

import React, { useState, useMemo } from 'react';
import type {
  DashboardTabViewProps,
  MuscleVolumeLandmark,
  MuscleRecoveryStatus,
  E1rmTrendPoint,
  PrRecord,
  BossMilestone,
  ConsistencyDay,
} from '@/types/domain';
import VolumeLandmarksCard from './VolumeLandmarksCard';
import MuscleRecoveryMap from './MuscleRecoveryMap';
import ProgressionChartCard from './ProgressionChartCard';
import PrTrophyRoomCard from './PrTrophyRoomCard';
import ShareableWorkoutCard from './ShareableWorkoutCard';
import {
  BarChart3,
  Activity,
  TrendingUp,
  Trophy,
  Share2,
  RefreshCw,
  Flame,
  Shield,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';

type DashboardSubSection =
  | 'all'
  | 'volume'
  | 'recovery'
  | 'progression'
  | 'trophies'
  | 'share';

const FALLBACK_LANDMARKS: MuscleVolumeLandmark[] = [
  {
    muscle: 'lats',
    label: 'Lats',
    weeklySets: 14.0,
    directSets: 12,
    indirectSets: 2.0,
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 22,
    zone: 'mav_sweet_spot',
    masteryLevel: 4,
    masteryTitle: 'Freak',
    masteryXp: 3400,
  },
  {
    muscle: 'chest',
    label: 'Chest',
    weeklySets: 13.0,
    directSets: 11,
    indirectSets: 2.0,
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 22,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2850,
  },
  {
    muscle: 'side_delts',
    label: 'Side Delts',
    weeklySets: 15.0,
    directSets: 14,
    indirectSets: 1.0,
    mv: 6,
    mev: 8,
    mavMin: 14,
    mavMax: 22,
    mrv: 26,
    zone: 'mav_sweet_spot',
    masteryLevel: 4,
    masteryTitle: 'Freak',
    masteryXp: 3120,
  },
  {
    muscle: 'upper_back',
    label: 'Upper Back',
    weeklySets: 12.5,
    directSets: 8,
    indirectSets: 4.5,
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 22,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2600,
  },
  {
    muscle: 'quads',
    label: 'Quads',
    weeklySets: 12.0,
    directSets: 10,
    indirectSets: 2.0,
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 20,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2450,
  },
  {
    muscle: 'hamstrings',
    label: 'Hamstrings',
    weeklySets: 10.5,
    directSets: 8,
    indirectSets: 2.5,
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 20,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2100,
  },
  {
    muscle: 'biceps',
    label: 'Biceps',
    weeklySets: 11.5,
    directSets: 7,
    indirectSets: 4.5,
    mv: 4,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 22,
    zone: 'mev_to_mav',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2300,
  },
  {
    muscle: 'triceps',
    label: 'Triceps',
    weeklySets: 11.0,
    directSets: 6,
    indirectSets: 5.0,
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 20,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 2200,
  },
  {
    muscle: 'rear_delts',
    label: 'Rear Delts',
    weeklySets: 9.0,
    directSets: 6,
    indirectSets: 3.0,
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 22,
    zone: 'mev_to_mav',
    masteryLevel: 2,
    masteryTitle: 'Intermediate',
    masteryXp: 1650,
  },
  {
    muscle: 'front_delts',
    label: 'Front Delts',
    weeklySets: 9.5,
    directSets: 4,
    indirectSets: 5.5,
    mv: 0,
    mev: 4,
    mavMin: 6,
    mavMax: 12,
    mrv: 16,
    zone: 'mav_sweet_spot',
    masteryLevel: 3,
    masteryTitle: 'Advanced',
    masteryXp: 1950,
  },
  {
    muscle: 'glutes',
    label: 'Glutes',
    weeklySets: 8.5,
    directSets: 4,
    indirectSets: 4.5,
    mv: 2,
    mev: 4,
    mavMin: 8,
    mavMax: 14,
    mrv: 18,
    zone: 'mav_sweet_spot',
    masteryLevel: 2,
    masteryTitle: 'Intermediate',
    masteryXp: 1700,
  },
  {
    muscle: 'calves',
    label: 'Calves',
    weeklySets: 8.0,
    directSets: 8,
    indirectSets: 0,
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 20,
    zone: 'mev_to_mav',
    masteryLevel: 2,
    masteryTitle: 'Intermediate',
    masteryXp: 1400,
  },
  {
    muscle: 'abs',
    label: 'Abs & Core',
    weeklySets: 6.0,
    directSets: 6,
    indirectSets: 0,
    mv: 0,
    mev: 4,
    mavMin: 8,
    mavMax: 14,
    mrv: 18,
    zone: 'mev_to_mav',
    masteryLevel: 2,
    masteryTitle: 'Intermediate',
    masteryXp: 1250,
  },
];

const FALLBACK_RECOVERY: MuscleRecoveryStatus[] = [
  { muscle: 'lats', label: 'Lats', recoveryPct: 92, status: 'fresh', hoursSinceLastTrained: 46, lastSetsLogged: 6, readyInHours: 0 },
  { muscle: 'upper_back', label: 'Upper Back', recoveryPct: 90, status: 'fresh', hoursSinceLastTrained: 46, lastSetsLogged: 5, readyInHours: 0 },
  { muscle: 'biceps', label: 'Biceps', recoveryPct: 94, status: 'fresh', hoursSinceLastTrained: 46, lastSetsLogged: 4, readyInHours: 0 },
  { muscle: 'chest', label: 'Chest', recoveryPct: 64, status: 'recovering', hoursSinceLastTrained: 24, lastSetsLogged: 6, readyInHours: 14 },
  { muscle: 'front_delts', label: 'Front Delts', recoveryPct: 68, status: 'recovering', hoursSinceLastTrained: 24, lastSetsLogged: 4, readyInHours: 12 },
  { muscle: 'side_delts', label: 'Side Delts', recoveryPct: 76, status: 'recovering', hoursSinceLastTrained: 24, lastSetsLogged: 5, readyInHours: 8 },
  { muscle: 'triceps', label: 'Triceps', recoveryPct: 66, status: 'recovering', hoursSinceLastTrained: 24, lastSetsLogged: 5, readyInHours: 13 },
  { muscle: 'quads', label: 'Quads', recoveryPct: 38, status: 'fatigued', hoursSinceLastTrained: 14, lastSetsLogged: 7, readyInHours: 28 },
  { muscle: 'hamstrings', label: 'Hamstrings', recoveryPct: 42, status: 'fatigued', hoursSinceLastTrained: 14, lastSetsLogged: 6, readyInHours: 24 },
  { muscle: 'glutes', label: 'Glutes', recoveryPct: 48, status: 'recovering', hoursSinceLastTrained: 14, lastSetsLogged: 5, readyInHours: 20 },
  { muscle: 'calves', label: 'Calves', recoveryPct: 72, status: 'recovering', hoursSinceLastTrained: 14, lastSetsLogged: 4, readyInHours: 10 },
  { muscle: 'rear_delts', label: 'Rear Delts', recoveryPct: 95, status: 'fresh', hoursSinceLastTrained: 46, lastSetsLogged: 3, readyInHours: 0 },
  { muscle: 'abs', label: 'Abs & Core', recoveryPct: 88, status: 'fresh', hoursSinceLastTrained: 36, lastSetsLogged: 3, readyInHours: 0 },
];

const FALLBACK_TRENDS: E1rmTrendPoint[] = [
  {
    date: '2026-09-25',
    sessionLabel: 'Pull A',
    exerciseId: 'lat-pulldown-pulley',
    exerciseName: 'Lat Pulldown (Pulley)',
    movementSlot: 'vertical_pull',
    weightKg: 72.5,
    effectiveLoadKg: 72.5,
    reps: 9,
    rir: 1,
    exerciseE1rmKg: 96.7,
    slotCanonicalE1rmKg: 96.7,
  },
  {
    date: '2026-10-04',
    sessionLabel: 'Upper B',
    exerciseId: 'weighted-chin-up',
    exerciseName: 'Weighted Chin-ups (Supinated)',
    movementSlot: 'vertical_pull',
    weightKg: 10,
    effectiveLoadKg: 84.6,
    reps: 8,
    rir: 1,
    exerciseE1rmKg: 110.0,
    slotCanonicalE1rmKg: 98.2,
    isSwappedVariation: true,
  },
  {
    date: '2026-10-14',
    sessionLabel: 'Pull A',
    exerciseId: 'lat-pulldown-pulley',
    exerciseName: 'Lat Pulldown (Pulley)',
    movementSlot: 'vertical_pull',
    weightKg: 75.0,
    effectiveLoadKg: 75.0,
    reps: 10,
    rir: 1,
    exerciseE1rmKg: 102.5,
    slotCanonicalE1rmKg: 102.5,
  },
  {
    date: '2026-10-25',
    sessionLabel: 'Upper B',
    exerciseId: 'weighted-chin-up',
    exerciseName: 'Weighted Chin-ups (Supinated)',
    movementSlot: 'vertical_pull',
    weightKg: 15,
    effectiveLoadKg: 89.6,
    reps: 8,
    rir: 1,
    exerciseE1rmKg: 116.5,
    slotCanonicalE1rmKg: 104.0,
    isSwappedVariation: true,
  },
  {
    date: '2026-11-04',
    sessionLabel: 'Pull A',
    exerciseId: 'lat-pulldown-pulley',
    exerciseName: 'Lat Pulldown (Pulley)',
    movementSlot: 'vertical_pull',
    weightKg: 80.0,
    effectiveLoadKg: 80.0,
    reps: 9,
    rir: 1,
    exerciseE1rmKg: 106.7,
    slotCanonicalE1rmKg: 106.7,
  },
  {
    date: '2026-11-12',
    sessionLabel: 'Upper B',
    exerciseId: 'weighted-chin-up',
    exerciseName: 'Weighted Chin-ups (Supinated)',
    movementSlot: 'vertical_pull',
    weightKg: 17.5,
    effectiveLoadKg: 92.1,
    reps: 8,
    rir: 1,
    exerciseE1rmKg: 119.7,
    slotCanonicalE1rmKg: 106.9,
    isSwappedVariation: true,
  },
];

const FALLBACK_MILESTONES: BossMilestone[] = [
  {
    id: 'boss-chinup-20',
    title: '+20kg Weighted Chin-up',
    subtitle: 'Vertical Pull Mastery',
    targetDescription: 'Belt +20kg × 5+ reps',
    unlocked: true,
    progressPct: 100,
    currentValueText: '+20kg × 6 (121kg e1RM)',
    xpReward: 500,
    icon: '🦍',
  },
  {
    id: 'boss-bench-100',
    title: '2-Plate Bench Press (100kg)',
    subtitle: 'Horizontal Press Boss',
    targetDescription: '100kg e1RM or 1RM',
    unlocked: true,
    progressPct: 100,
    currentValueText: '108.5kg e1RM (85kg × 8)',
    xpReward: 500,
    icon: '🛡️',
  },
  {
    id: 'boss-squat-140',
    title: '3-Plate Squat (140kg)',
    subtitle: 'Lower Body Foundation',
    targetDescription: '140kg e1RM on Squat',
    unlocked: false,
    progressPct: 92,
    currentValueText: '129.0kg e1RM (105kg × 7)',
    xpReward: 750,
    icon: '🦵',
  },
  {
    id: 'boss-tonnage-10k',
    title: '10,000kg Single-Session Tonnage',
    subtitle: 'High-Volume Workhorse',
    targetDescription: '10,000kg moved in 1 workout',
    unlocked: true,
    progressPct: 100,
    currentValueText: '11,420kg best session',
    xpReward: 400,
    icon: '⚡',
  },
];

export default function DashboardTabView({
  user,
  analytics,
  exercises,
  onRefresh,
  onShowToast,
}: DashboardTabViewProps) {
  const [activeSection, setActiveSection] = useState<DashboardSubSection>('all');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const weeklyTonnageKg = analytics?.weeklyTonnageKg ?? 38450;
  const previousWeekTonnageKg = analytics?.previousWeekTonnageKg ?? 35200;
  const weeklySessionsCompleted = analytics?.weeklySessionsCompleted ?? 4;
  const weeklySessionsTarget = analytics?.weeklySessionsTarget ?? 5;
  const volumeLandmarks =
    analytics?.volumeLandmarks && analytics.volumeLandmarks.length > 0
      ? analytics.volumeLandmarks
      : FALLBACK_LANDMARKS;
  const muscleRecovery =
    analytics?.muscleRecovery && analytics.muscleRecovery.length > 0
      ? analytics.muscleRecovery
      : FALLBACK_RECOVERY;
  const e1rmTrends =
    analytics?.e1rmTrends && analytics.e1rmTrends.length > 0
      ? analytics.e1rmTrends
      : FALLBACK_TRENDS;
  const bossMilestones =
    analytics?.bossMilestones && analytics.bossMilestones.length > 0
      ? analytics.bossMilestones
      : FALLBACK_MILESTONES;
  const recentPrs: PrRecord[] = analytics?.recentPrs ?? [];
  const recentSessions = analytics?.recentSessions ?? [];

  const consistencyCalendar: ConsistencyDay[] = useMemo(() => {
    if (analytics?.consistencyCalendar && analytics.consistencyCalendar.length > 0) {
      return analytics.consistencyCalendar;
    }
    const days: ConsistencyDay[] = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const trained = dow !== 0 && dow !== 3 && i % 2 === 0;
      days.push({
        date: iso,
        trained,
        routineLabel: trained ? 'Hypertrophy Session' : undefined,
        volumeKg: trained ? 8900 : 0,
        prsCount: trained && i % 6 === 0 ? 1 : 0,
        isScheduledRest: dow === 0 || dow === 3,
      });
    }
    return days;
  }, [analytics?.consistencyCalendar]);

  const tonnageDeltaKg = weeklyTonnageKg - previousWeekTonnageKg;
  const tonnageDeltaPct =
    previousWeekTonnageKg > 0
      ? Number(((tonnageDeltaKg / previousWeekTonnageKg) * 100).toFixed(1))
      : 0;

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      onShowToast('Refreshed hypertrophy analytics & recovery telemetry!');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Hero Analytics Banner + 4 Before->After KPI Strip (fit-or-pivot style) */}
      <div className="card bg-[#fbf5e4] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl text-[#1d1a16]">
                PROGRESS & BIOMECHANICS LAB
              </h1>
              <span className="pill gold text-xs">8-WEEK TELEMETRY</span>
            </div>
            <p className="text-sm font-bold text-[#5d5446]">
              Science-based MEV/MAV/MRV volume landmarks, 72h recovery, and variation-unified e1RM curves
            </p>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="btn alt !min-h-[44px] !px-3 !py-1.5 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Sync Lab
          </button>
        </div>

        {/* 4 Signature fit-or-pivot Before -> After KPI Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 wobble-grid">
          {/* KPI 1: Weekly Tonnage Before -> After */}
          <div className={`kpi ${tonnageDeltaKg >= 0 ? 'ok' : ''}`}>
            <div className="text-xs font-bold uppercase text-[#5d5446] flex items-center justify-between">
              <span>Weekly Tonnage</span>
              {tonnageDeltaKg >= 0 && (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#2e7d3a]" />
              )}
            </div>
            <div className="font-marker text-base sm:text-lg text-[#1d1a16] mt-0.5">
              <span className="text-xs text-[#5d5446] line-through mr-1">
                {(previousWeekTonnageKg / 1000).toFixed(1)}t
              </span>
              → {(weeklyTonnageKg / 1000).toFixed(1)}t
            </div>
            <div
              className={`text-xs font-bold mt-0.5 ${
                tonnageDeltaKg >= 0 ? 'text-[#2e7d3a]' : 'text-[#d9412b]'
              }`}
            >
              {tonnageDeltaKg >= 0 ? '▲' : '▼'}{' '}
              {tonnageDeltaKg >= 0 ? '+' : ''}
              {tonnageDeltaKg.toLocaleString()} kg ({tonnageDeltaPct}%)
            </div>
          </div>

          {/* KPI 2: Weekly Split Sessions */}
          <div
            className={`kpi ${
              weeklySessionsCompleted >= weeklySessionsTarget ? 'ok' : ''
            }`}
          >
            <div className="text-xs font-bold uppercase text-[#5d5446]">
              Split Adherence
            </div>
            <div className="font-marker text-xl text-[#1d1a16] mt-0.5">
              {weeklySessionsCompleted} / {weeklySessionsTarget}{' '}
              <span className="text-xs font-sans font-bold text-[#5d5446]">
                days
              </span>
            </div>
            <div className="text-xs font-bold text-[#2e7d3a] mt-0.5">
              {weeklySessionsCompleted >= weeklySessionsTarget
                ? '✔ Target Locked (+1 Shield)'
                : `${Math.max(0, weeklySessionsTarget - weeklySessionsCompleted)} left this week`}
            </div>
          </div>

          {/* KPI 3: Hypertrophy Rank & Level */}
          <div className="kpi !bg-[#fbedba]">
            <div className="text-xs font-bold uppercase text-[#5d5446] flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[#d9412b]" />
              <span>Athlete Rank</span>
            </div>
            <div className="font-marker text-lg sm:text-xl text-[#1d1a16] mt-0.5">
              {user.rankTier} • Lv.{user.level}
            </div>
            <div className="text-xs font-bold text-[#5d5446] mt-0.5">
              {user.xp.toLocaleString()} Total XP
            </div>
          </div>

          {/* KPI 4: Active Streak & Shields */}
          <div className="kpi">
            <div className="text-xs font-bold uppercase text-[#5d5446] flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-[#d9412b] fill-[#d9412b]" />
              <span>Streak & Shields</span>
            </div>
            <div className="font-marker text-lg sm:text-xl text-[#1d1a16] mt-0.5 flex items-center gap-2">
              <span>🔥 {user.currentStreak}d</span>
              <span className="text-sm bg-[#d4e3f7] px-1.5 py-0.5 rounded border border-[#1d1a16] inline-flex items-center gap-0.5">
                <Shield className="w-3 h-3 text-[#2b5fa8]" />
                {user.streakShields}
              </span>
            </div>
            <div className="text-xs font-bold text-[#5d5446] mt-0.5">
              All-Time Best: {user.bestStreak}d
            </div>
          </div>
        </div>

        {/* Sub-Section Filter Pills */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(
            [
              { id: 'all', label: '📋 Full Notebook', icon: BarChart3 },
              { id: 'volume', label: '📊 MEV/MAV/MRV Volume', icon: BarChart3 },
              { id: 'recovery', label: '🧬 72h Recovery Map', icon: Activity },
              { id: 'progression', label: '📈 e1RM & Slot Curves', icon: TrendingUp },
              { id: 'trophies', label: '🏆 PRs & Bosses', icon: Trophy },
              { id: 'share', label: '🃏 Share Workout Card', icon: Share2 },
            ] as const
          ).map((tab) => {
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`btn !min-h-[44px] !px-3 !py-1.5 text-sm ${
                  active ? '' : 'alt'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 1: Volume Landmarks & Muscle Mastery */}
      {(activeSection === 'all' || activeSection === 'volume') && (
        <VolumeLandmarksCard landmarks={volumeLandmarks} />
      )}

      {/* Section 2: 72-Hour Muscle Recovery & Fatigue Map */}
      {(activeSection === 'all' || activeSection === 'recovery') && (
        <MuscleRecoveryMap recoveryList={muscleRecovery} />
      )}

      {/* Section 3: e1RM & Progressive Overload Curves + Consistency Heatmap */}
      {(activeSection === 'all' || activeSection === 'progression') && (
        <ProgressionChartCard
          trends={e1rmTrends}
          consistencyCalendar={consistencyCalendar}
          exercises={exercises}
          userBodyweightKg={user.bodyweightKg}
        />
      )}

      {/* Section 4: PR Trophy Room & Boss Milestones */}
      {(activeSection === 'all' || activeSection === 'trophies') && (
        <PrTrophyRoomCard prs={recentPrs} bossMilestones={bossMilestones} />
      )}

      {/* Section 5: Shareable Cartoon Workout Summary Card */}
      {(activeSection === 'all' || activeSection === 'share') && (
        <ShareableWorkoutCard
          user={user}
          recentSessions={recentSessions}
          volumeLandmarks={volumeLandmarks}
          recentPrs={recentPrs}
          weeklyTonnageKg={weeklyTonnageKg}
          weeklySessionsCompleted={weeklySessionsCompleted}
          weeklySessionsTarget={weeklySessionsTarget}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
}
