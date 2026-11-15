'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  WorkoutTabViewProps,
  PrecompiledSlot,
  PrecompiledSet,
  ExerciseDefinition,
  VariationSwapResponse,
  SessionDebriefImpact,
  WorkoutSet,
} from '@/types/domain';
import HeroTodayCard from './HeroTodayCard';
import ActiveSessionSheet from './ActiveSessionSheet';
import VariationSwapSheet from './VariationSwapSheet';
import ScheduleBuilderSheet from './ScheduleBuilderSheet';
import FloatingRestTimer from './FloatingRestTimer';
import PlateCalculatorModal from './PlateCalculatorModal';
import SessionDebriefModal from './SessionDebriefModal';
import {
  Dumbbell,
  Calendar,
  History,
  Disc,
  Timer,
  CloudUpload,
  RotateCcw,
  Trophy,
  Watch,
} from 'lucide-react';
import {
  playMechanicalClick,
  playSetComplete,
  playPrFanfare,
} from '@/lib/audio/soundEngine';
import {
  enqueueOutboxOp,
  flushOutbox,
  generateCid,
  getPendingOps,
  saveActiveWorkoutDraft,
} from '@/lib/offline/outbox';

export type ExtendedWorkoutTabViewProps = WorkoutTabViewProps & {
  activeMode?: 'workout' | 'schedule';
};

export default function WorkoutTabView({
  user,
  precompiledSession,
  schedule,
  exercises,
  recentSessions,
  soundEnabled,
  activeMode,
  onRefresh,
  onSelectRoutineDay,
  onSessionLogged,
  onScheduleUpdated,
  onShowToast,
}: ExtendedWorkoutTabViewProps) {
  const [subView, setSubView] = useState<'workout' | 'schedule' | 'history'>(
    activeMode === 'schedule' ? 'schedule' : 'workout'
  );
  const [slots, setSlots] = useState<PrecompiledSlot[]>([]);
  const [isSessionStarted, setIsSessionStarted] = useState<boolean>(false);
  const [isSubmittingWorkout, setIsSubmittingWorkout] =
    useState<boolean>(false);

  // Modals & Sheets State
  const [swapTargetSlot, setSwapTargetSlot] =
    useState<PrecompiledSlot | null>(null);
  const [plateCalcState, setPlateCalcState] = useState<{
    isOpen: boolean;
    initialWeightKg: number;
    onApply?: (weightKg: number) => void;
  }>({
    isOpen: false,
    initialWeightKg: 100,
  });
  const [restTimerState, setRestTimerState] = useState<{
    endTimeMs: number | null;
    totalSeconds: number;
    label?: string;
    isExpandedPicker: boolean;
  }>({
    endTimeMs: null,
    totalSeconds: 120,
    isExpandedPicker: false,
  });
  const [debriefImpact, setDebriefImpact] =
    useState<SessionDebriefImpact | null>(null);
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(0);

  // Sync subView when parent BottomTabBar switches between 'workout' and 'schedule'
  useEffect(() => {
    if (activeMode === 'schedule') {
      setSubView('schedule');
    } else if (activeMode === 'workout' && subView === 'schedule') {
      setSubView('workout');
    }
  }, [activeMode]);

  // Sync slots when precompiledSession updates
  useEffect(() => {
    if (precompiledSession?.slots) {
      const cloned: PrecompiledSlot[] = JSON.parse(
        JSON.stringify(precompiledSession.slots)
      );
      setSlots(cloned);
    } else {
      setSlots([]);
    }
  }, [precompiledSession]);

  // Flush offline outbox on mount & when coming back online
  const syncPendingOutbox = useCallback(async () => {
    const currentOps = getPendingOps();
    setPendingOutboxCount(currentOps.length);
    if (currentOps.length === 0) return;

    const res = await flushOutbox();
    setPendingOutboxCount(res.remainingCount);
    if (res.flushedCount > 0) {
      await onRefresh();
      onShowToast(`Synced ${res.flushedCount} offline workout op(s)!`);
    }
  }, [onRefresh, onShowToast]);

  useEffect(() => {
    syncPendingOutbox();
    const handleOnline = () => {
      syncPendingOutbox();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncPendingOutbox]);

  // Set Row Mutation Handlers
  const handleUpdateSet = useCallback(
    (
      slotIndex: number,
      setNumber: number,
      patch: Partial<PrecompiledSet>
    ) => {
      setSlots((prev) => {
        const next = prev.map((s) => {
          if (s.slotIndex !== slotIndex) return s;
          return {
            ...s,
            sets: s.sets.map((setRow) =>
              setRow.setNumber === setNumber ? { ...setRow, ...patch } : setRow
            ),
          };
        });
        saveActiveWorkoutDraft({
          routineLabel: precompiledSession?.routineLabel,
          updatedAt: new Date().toISOString(),
          slots: next,
        });
        return next;
      });
    },
    [precompiledSession?.routineLabel]
  );

  const handleAddSet = useCallback((slotIndex: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.slotIndex !== slotIndex) return s;
        const lastSet = s.sets[s.sets.length - 1];
        const nextSetNumber = s.sets.length + 1;
        const newSet: PrecompiledSet = {
          setNumber: nextSetNumber,
          targetWeightKg: lastSet?.targetWeightKg ?? 60,
          targetReps: lastSet?.targetReps ?? s.repRangeMin,
          targetRir: lastSet?.targetRir ?? s.targetRir,
          effectiveLoadKg: lastSet?.effectiveLoadKg ?? 60,
          completed: false,
          actualWeightKg:
            lastSet?.actualWeightKg ?? lastSet?.targetWeightKg ?? 60,
          actualReps:
            lastSet?.actualReps ?? lastSet?.targetReps ?? s.repRangeMin,
          actualRir: lastSet?.actualRir ?? lastSet?.targetRir ?? s.targetRir,
        };
        return {
          ...s,
          targetSets: s.sets.length + 1,
          sets: [...s.sets, newSet],
        };
      })
    );
  }, []);

  const handleRemoveLastSet = useCallback((slotIndex: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.slotIndex !== slotIndex || s.sets.length <= 1) return s;
        const trimmed = s.sets.slice(0, -1);
        return {
          ...s,
          targetSets: trimmed.length,
          sets: trimmed,
        };
      })
    );
  }, []);

  const handleAddAdHocExercise = useCallback(
    (exercise: ExerciseDefinition) => {
      setSlots((prev) => {
        const nextIndex = prev.length;
        const isBwPlus = exercise.loadType === 'bodyweight_plus';
        const defaultWeight = isBwPlus ? 10 : 40;
        const effLoad = isBwPlus
          ? Number(
              (
                user.bodyweightKg * (exercise.bodyweightFactor || 0.95) +
                defaultWeight
              ).toFixed(1)
            )
          : exercise.loadType === 'unilateral_db'
          ? defaultWeight * 2
          : defaultWeight;

        const siblings = exercises.filter(
          (ex) => ex.movementSlot === exercise.movementSlot
        );

        const newSlot: PrecompiledSlot = {
          slotIndex: nextIndex,
          scheduleSlotId: `adhoc-${Date.now()}`,
          movementSlot: exercise.movementSlot,
          exercise,
          defaultExerciseId: exercise.id,
          isSwappedVariation: false,
          targetSets: 3,
          repRangeMin: exercise.defaultRepMin || 8,
          repRangeMax: exercise.defaultRepMax || 12,
          targetRir: 2,
          restSeconds: exercise.defaultRestSeconds || 90,
          progressionType: 'new_slot',
          progressionBadge: 'AD-HOC BONUS SLOT',
          progressionReason: `Added ${exercise.name} for extra ${exercise.primaryMuscle.replace(
            /_/g,
            ' '
          )} hypertrophy stimulus.`,
          previousSummary: 'Ad-hoc bonus sets',
          slotCanonicalE1rmKg: 0,
          exerciseE1rmKg: 0,
          siblingsInSlot: siblings,
          sets: [1, 2, 3].map((num) => ({
            setNumber: num,
            targetWeightKg: defaultWeight,
            targetReps: exercise.defaultRepMin || 10,
            targetRir: 2,
            effectiveLoadKg: effLoad,
            completed: false,
            actualWeightKg: defaultWeight,
            actualReps: exercise.defaultRepMin || 10,
            actualRir: 2,
          })),
        };
        return [...prev, newSlot];
      });
      onShowToast(`Added ${exercise.name} to today's session!`);
    },
    [exercises, onShowToast, user.bodyweightKg]
  );

  const handleCheckAllRemainingSets = useCallback(() => {
    playSetComplete(soundEnabled);
    setSlots((prev) =>
      prev.map((slot) => ({
        ...slot,
        sets: slot.sets.map((s) => {
          const w = s.actualWeightKg ?? s.targetWeightKg;
          const r = s.actualReps ?? s.targetReps;
          const rir = s.actualRir ?? s.targetRir;
          const eff =
            slot.exercise.loadType === 'bodyweight_plus'
              ? Number(
                  (
                    user.bodyweightKg *
                      (slot.exercise.bodyweightFactor || 0.95) +
                    w
                  ).toFixed(1)
                )
              : slot.exercise.loadType === 'unilateral_db'
              ? Number((w * 2).toFixed(1))
              : w;
          return {
            ...s,
            completed: true,
            actualWeightKg: w,
            actualReps: r,
            actualRir: rir,
            effectiveLoadKg: eff,
          };
        }),
      }))
    );
  }, [soundEnabled, user.bodyweightKg]);

  const handleStartRestTimer = useCallback(
    (seconds: number, exerciseName: string) => {
      setRestTimerState({
        endTimeMs: Date.now() + seconds * 1000,
        totalSeconds: seconds,
        label: exerciseName,
        isExpandedPicker: false,
      });
    },
    []
  );

  const handleSwapApplied = useCallback(
    (
      slotIndex: number,
      swapResponse: VariationSwapResponse,
      scope: 'session' | 'schedule'
    ) => {
      setSlots((prev) =>
        prev.map((slot) => {
          if (slot.slotIndex !== slotIndex) return slot;
          return {
            ...slot,
            exercise: swapResponse.toExercise,
            isSwappedVariation: true,
            swappedFromExerciseName: swapResponse.fromExercise.name,
            progressionType: 'variation_equiv',
            progressionBadge: 'VARIATION EQUIV',
            progressionReason: swapResponse.explanationNote,
            slotCanonicalE1rmKg: swapResponse.slotCanonicalE1rm,
            sets: swapResponse.sets.map((s) => ({
              ...s,
              completed: false,
              actualWeightKg: s.targetWeightKg,
              actualReps: s.targetReps,
              actualRir: s.targetRir,
            })),
          };
        })
      );

      if (scope === 'schedule') {
        onRefresh();
        onShowToast(
          `Swapped default to ${swapResponse.toExercise.name} (${swapResponse.recommendedWeightKg}kg target)!`
        );
      } else {
        onShowToast(
          `Swapped to ${swapResponse.toExercise.name} for today's session!`
        );
      }
    },
    [onRefresh, onShowToast]
  );

  const handleUndoSession = useCallback(
    async (sessionId: string) => {
      playMechanicalClick(soundEnabled);
      try {
        const res = await fetch('/api/workouts/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'undo', sessionId }),
        });
        if (res.ok) {
          await onRefresh();
          onShowToast('Workout session undone & XP reverted.');
        }
      } catch {
        onShowToast('Could not undo while offline.');
      }
    },
    [onRefresh, onShowToast, soundEnabled]
  );

  // Submit Workout Session (either from Finish Workout button or 1-Tap Quick Complete)
  const submitWorkoutSession = useCallback(
    async (params: {
      notes?: string;
      durationMinutes?: number;
      forceAllSetsCompleted?: boolean;
    }) => {
      if (!precompiledSession || slots.length === 0) return;
      setIsSubmittingWorkout(true);

      const cid = generateCid();
      const compiledSets: WorkoutSet[] = [];

      const anyExplicitlyCompleted = slots.some((slot) =>
        slot.sets.some((s) => s.completed)
      );
      const includeAll =
        Boolean(params.forceAllSetsCompleted) || !anyExplicitlyCompleted;

      for (const slot of slots) {
        for (const s of slot.sets) {
          if (!includeAll && !s.completed) continue;
          const weightKg = s.actualWeightKg ?? s.targetWeightKg;
          const reps = s.actualReps ?? s.targetReps;
          const rir = s.actualRir ?? s.targetRir;
          const effectiveLoadKg =
            slot.exercise.loadType === 'bodyweight_plus'
              ? Number(
                  (
                    user.bodyweightKg *
                      (slot.exercise.bodyweightFactor || 0.95) +
                    weightKg
                  ).toFixed(1)
                )
              : slot.exercise.loadType === 'unilateral_db'
              ? Number((weightKg * 2).toFixed(1))
              : weightKg;

          compiledSets.push({
            exerciseId: slot.exercise.id,
            exerciseName: slot.exercise.name,
            movementSlot: slot.movementSlot,
            setNumber: s.setNumber,
            weightKg,
            effectiveLoadKg,
            reps,
            rir,
          });
        }
      }

      const payload = {
        cid,
        scheduleDayId: precompiledSession.scheduleDayId,
        routineLabel: precompiledSession.routineLabel,
        durationMinutes:
          params.durationMinutes ||
          precompiledSession.estimatedDurationMin ||
          50,
        userBodyweightKg: user.bodyweightKg,
        notes: params.notes || '',
        sets: compiledSets,
      };

      try {
        const res = await fetch('/api/workouts/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          saveActiveWorkoutDraft(null);
          setRestTimerState({
            endTimeMs: null,
            totalSeconds: 120,
            isExpandedPicker: false,
          });

          if (data.impact) {
            const impact = data.impact as SessionDebriefImpact;
            setDebriefImpact(impact);
            onSessionLogged(impact);
            onShowToast(
              `Logged ${impact.session.routineLabel}! +${impact.xpEarned} XP`,
              async () => {
                await handleUndoSession(impact.session.id);
              }
            );
          } else {
            playPrFanfare(soundEnabled);
            await onRefresh();
            onShowToast('Workout logged!');
          }
          setIsSubmittingWorkout(false);
          return;
        }
      } catch {
        // Offline Fallback: Enqueue in localStorage Outbox & show optimistic Debrief
      }

      enqueueOutboxOp({
        cid,
        type: 'workout_log',
        endpoint: '/api/workouts/log',
        method: 'POST',
        payload,
      });
      setPendingOutboxCount(getPendingOps().length);
      saveActiveWorkoutDraft(null);

      const totalVol = compiledSets.reduce(
        (sum, s) => sum + (s.effectiveLoadKg || s.weightKg) * s.reps,
        0
      );
      const earnedXp = 150 + compiledSets.length * 35;

      const offlineImpact: SessionDebriefImpact = {
        session: {
          id: cid,
          userId: user.id,
          scheduleDayId: precompiledSession.scheduleDayId,
          routineLabel: precompiledSession.routineLabel,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMinutes: payload.durationMinutes,
          userBodyweightKg: user.bodyweightKg,
          totalVolumeKg: Math.round(totalVol),
          totalSets: compiledSets.length,
          xpEarned: earnedXp,
          prsCount: 0,
          notes: payload.notes,
          sets: compiledSets,
          cid,
        },
        xpEarned: earnedXp,
        xpBreakdown: [
          { label: 'Session Completion Bonus', xp: 150 },
          {
            label: `${compiledSets.length} Working Sets Logged`,
            xp: compiledSets.length * 35,
          },
        ],
        previousLevel: user.level,
        newLevel: user.level,
        leveledUp: false,
        previousRank: user.rankTier,
        newRank: user.rankTier,
        streakAfter: user.currentStreak + 1,
        prsUnlocked: [],
        muscleLandmarksCrossed: [],
        beforeAfterKpis: [
          {
            label: 'Session Tonnage',
            before: '0 kg',
            after: `${Math.round(totalVol).toLocaleString()} kg`,
            deltaText: `${compiledSets.length} working sets queued`,
            direction: 'up',
            hitTarget: true,
          },
          {
            label: 'Offline Outbox',
            before: 'Local',
            after: 'Saved',
            deltaText: 'Will auto-sync on connection',
            direction: 'up',
            hitTarget: true,
          },
        ],
        coachTakeaway:
          'Saved to your offline gym outbox! Your sets and XP will sync automatically as soon as reception returns.',
      };

      setDebriefImpact(offlineImpact);
      onShowToast('Saved to offline outbox — will sync automatically!');
      setIsSubmittingWorkout(false);
    },
    [
      handleUndoSession,
      onRefresh,
      onSessionLogged,
      onShowToast,
      precompiledSession,
      slots,
      soundEnabled,
      user,
    ]
  );

  return (
    <div className="space-y-4">
      {/* Top Segmented Mode Bar + Quick Gym Utilities */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 bg-[#fbf5e4] border-[3px] border-[#1d1a16] rounded-[12px] p-1" style={{ boxShadow: '3px 3px 0 var(--ink)' }}>
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setSubView('workout');
            }}
            className={`min-h-[40px] px-3 py-1 rounded-[8px] font-marker text-sm flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'workout'
                ? 'bg-[#f2b632] border-[2px] border-[#1d1a16]'
                : 'text-[#5d5446]'
            }`}
          >
            <Dumbbell className="w-4 h-4" />
            <span>Today</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setSubView('schedule');
            }}
            className={`min-h-[40px] px-3 py-1 rounded-[8px] font-marker text-sm flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'schedule'
                ? 'bg-[#f2b632] border-[2px] border-[#1d1a16]'
                : 'text-[#5d5446]'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Split</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setSubView('history');
            }}
            className={`min-h-[40px] px-3 py-1 rounded-[8px] font-marker text-sm flex items-center gap-1.5 cursor-pointer transition-colors ${
              subView === 'history'
                ? 'bg-[#f2b632] border-[2px] border-[#1d1a16]'
                : 'text-[#5d5446]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Logs ({recentSessions.length})</span>
          </button>
        </div>

        {/* Utility Buttons: Plate Calculator, Rest Timer, Offline Outbox Sync */}
        <div className="flex items-center gap-1.5">
          {pendingOutboxCount > 0 && (
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                syncPendingOutbox();
              }}
              className="btn gold !min-h-[44px] !px-2.5 !py-1 text-sm"
              title="Sync pending offline workout logs"
            >
              <CloudUpload className="w-4 h-4" />
              <span>Sync ({pendingOutboxCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setPlateCalcState({
                isOpen: true,
                initialWeightKg:
                  slots[0]?.sets[0]?.actualWeightKg ||
                  slots[0]?.sets[0]?.targetWeightKg ||
                  100,
              });
            }}
            className="btn alt !min-h-[44px] !px-3 !py-1 text-sm"
          >
            <Disc className="w-4 h-4 text-[#d9412b]" />
            <span>Plates</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setRestTimerState((prev) => ({
                ...prev,
                isExpandedPicker: !prev.isExpandedPicker,
              }));
            }}
            className="btn alt !min-h-[44px] !px-3 !py-1 text-sm"
          >
            <Timer className="w-4 h-4 text-[#2b5fa8]" />
            <span>Timer</span>
          </button>
        </div>
      </div>

      {/* MODE 1: TODAY'S PRECOMPILED WORKOUT & ACTIVE LOGGER */}
      {subView === 'workout' && (
        <div className="space-y-5">
          <HeroTodayCard
            session={precompiledSession}
            schedule={schedule}
            userBodyweightKg={user.bodyweightKg}
            isSessionActive={isSessionStarted}
            isQuickLogging={isSubmittingWorkout}
            soundEnabled={soundEnabled}
            onSelectDay={(dow) => onSelectRoutineDay(dow)}
            onStartSession={() => {
              setIsSessionStarted(true);
              const el = document.getElementById('active-workout-logger');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            onQuickCompleteSession={() => {
              handleCheckAllRemainingSets();
              submitWorkoutSession({ forceAllSetsCompleted: true });
            }}
            onOpenSwapSheet={(slot) => setSwapTargetSlot(slot)}
            onOpenScheduleBuilder={() => setSubView('schedule')}
          />

          {precompiledSession && !precompiledSession.isRestDay && (
            <ActiveSessionSheet
              session={precompiledSession}
              slots={slots}
              allExercises={exercises}
              userBodyweightKg={user.bodyweightKg}
              soundEnabled={soundEnabled}
              isSubmitting={isSubmittingWorkout}
              onUpdateSet={handleUpdateSet}
              onAddSet={handleAddSet}
              onRemoveLastSet={handleRemoveLastSet}
              onAddAdHocExercise={handleAddAdHocExercise}
              onOpenSwapSheet={(slot) => setSwapTargetSlot(slot)}
              onOpenPlateCalculator={(initialWeightKg, onApply) =>
                setPlateCalcState({
                  isOpen: true,
                  initialWeightKg,
                  onApply,
                })
              }
              onStartRestTimer={handleStartRestTimer}
              onCheckAllRemainingSets={handleCheckAllRemainingSets}
              onFinishWorkout={(notes, durationMinutes) =>
                submitWorkoutSession({ notes, durationMinutes })
              }
            />
          )}
        </div>
      )}

      {/* MODE 2: INTERACTIVE 7-DAY WEEKLY SPLIT BUILDER */}
      {subView === 'schedule' && (
        <ScheduleBuilderSheet
          schedule={schedule}
          exercises={exercises}
          soundEnabled={soundEnabled}
          onScheduleSaved={(updated) => onScheduleUpdated(updated)}
          onShowToast={(msg) => onShowToast(msg)}
        />
      )}

      {/* MODE 3: RECENT WORKOUT LOGS & 1-TAP UNDO */}
      {subView === 'history' && (
        <div className="space-y-3">
          <div className="card space-y-1">
            <h2 className="text-2xl font-marker">
              RECENT WORKOUT NOTEBOOK ({recentSessions.length})
            </h2>
            <p className="text-sm font-bold text-[#5d5446]">
              Every session logged feeds the Smart Double-Progression & Canonical Slot e1RM Engine.
            </p>
          </div>

          {recentSessions.length === 0 ? (
            <div className="card text-center py-8 space-y-2">
              <p className="font-marker text-xl">NO SESSIONS LOGGED YET</p>
              <p className="text-base font-bold text-[#5d5446]">
                Head to the Today tab to launch your precompiled hypertrophy session!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentSessions.map((sess) => {
                const dateStr = new Date(sess.completedAt).toLocaleDateString(
                  undefined,
                  {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  }
                );
                return (
                  <div key={sess.id} className="card space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="pill gold text-xs font-marker">
                            {dateStr}
                          </span>
                          <span className="pill green text-xs">
                            ⚡ +{sess.xpEarned} XP
                          </span>
                          {sess.prsCount > 0 && (
                            <span className="pill red text-xs">
                              <Trophy className="w-3.5 h-3.5" /> {sess.prsCount} PR
                            </span>
                          )}
                          {sess.appleWatchKcal && (
                            <span className="pill blue text-xs">
                              <Watch className="w-3.5 h-3.5" />{' '}
                              {sess.appleWatchKcal} kcal •{' '}
                              {sess.appleWatchAvgHr || 128} bpm
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-marker mt-1">
                          {sess.routineLabel}
                        </h3>
                        <div className="text-sm font-bold text-[#5d5446]">
                          {sess.durationMinutes} min • {sess.totalSets} working
                          sets •{' '}
                          <strong className="text-[#1d1a16]">
                            {Math.round(sess.totalVolumeKg).toLocaleString()} kg
                          </strong>{' '}
                          tonnage • BW {sess.userBodyweightKg}kg
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleUndoSession(sess.id)}
                        className="btn alt !min-h-[40px] !px-3 !py-1 text-sm"
                        title="Undo and remove this logged session"
                      >
                        <RotateCcw className="w-4 h-4" /> Undo
                      </button>
                    </div>

                    {sess.sets && sess.sets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-dashed border-[#1d1a16]/20">
                        {sess.sets.slice(0, 8).map((st, idx) => (
                          <span
                            key={`${sess.id}-set-${idx}`}
                            className="pill text-xs py-0.5 px-2 bg-[#ece2c6]"
                          >
                            {st.exerciseName || st.exerciseId}: {st.weightKg}kg ×{' '}
                            {st.reps}
                          </span>
                        ))}
                        {sess.sets.length > 8 && (
                          <span className="pill text-xs py-0.5 px-2">
                            +{sess.sets.length - 8} more sets
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating Wall-Clock Rest Timer Pill */}
      <FloatingRestTimer
        endTimeMs={restTimerState.endTimeMs}
        totalSeconds={restTimerState.totalSeconds}
        label={restTimerState.label}
        soundEnabled={soundEnabled}
        isExpandedPicker={restTimerState.isExpandedPicker}
        onAdjustSeconds={(delta) =>
          setRestTimerState((prev) => {
            if (!prev.endTimeMs) return prev;
            return {
              ...prev,
              endTimeMs: prev.endTimeMs + delta * 1000,
              totalSeconds: Math.max(15, prev.totalSeconds + delta),
            };
          })
        }
        onStartPreset={(seconds, label) =>
          setRestTimerState({
            endTimeMs: Date.now() + seconds * 1000,
            totalSeconds: seconds,
            label,
            isExpandedPicker: false,
          })
        }
        onDismiss={() =>
          setRestTimerState({
            endTimeMs: null,
            totalSeconds: 120,
            isExpandedPicker: false,
          })
        }
      />

      {/* Biomechanical Exercise Variation Swap Bottom Sheet */}
      <VariationSwapSheet
        isOpen={Boolean(swapTargetSlot)}
        slot={swapTargetSlot}
        allExercises={exercises}
        userBodyweightKg={user.bodyweightKg}
        soundEnabled={soundEnabled}
        onClose={() => setSwapTargetSlot(null)}
        onSwapApplied={handleSwapApplied}
      />

      {/* Interactive Barbell Plate Calculator Modal */}
      <PlateCalculatorModal
        isOpen={plateCalcState.isOpen}
        initialWeightKg={plateCalcState.initialWeightKg}
        soundEnabled={soundEnabled}
        onClose={() =>
          setPlateCalcState((prev) => ({ ...prev, isOpen: false }))
        }
        onApplyWeight={plateCalcState.onApply}
      />

      {/* Celebratory Post-Workout Session Debrief Modal */}
      <SessionDebriefModal
        impact={debriefImpact}
        soundEnabled={soundEnabled}
        onClose={() => setDebriefImpact(null)}
      />
    </div>
  );
}
