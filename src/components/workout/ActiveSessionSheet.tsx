'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type {
  ExerciseDefinition,
  PrecompiledSession,
  PrecompiledSlot,
  PrecompiledSet,
} from '@/types/domain';
import ExerciseSlotCard from './ExerciseSlotCard';
import {
  Sun,
  Trophy,
  Plus,
  CheckCheck,
  Clock,
  Dumbbell,
  Sparkles,
} from 'lucide-react';
import { playMechanicalClick } from '@/lib/audio/soundEngine';

export interface ActiveSessionSheetProps {
  session: PrecompiledSession;
  slots: PrecompiledSlot[];
  allExercises: ExerciseDefinition[];
  userBodyweightKg: number;
  soundEnabled: boolean;
  isSubmitting: boolean;
  onUpdateSet: (
    slotIndex: number,
    setNumber: number,
    patch: Partial<PrecompiledSet>
  ) => void;
  onAddSet: (slotIndex: number) => void;
  onRemoveLastSet: (slotIndex: number) => void;
  onAddAdHocExercise: (exercise: ExerciseDefinition) => void;
  onOpenSwapSheet: (slot: PrecompiledSlot) => void;
  onOpenPlateCalculator: (
    initialWeightKg: number,
    onApply: (newWeightKg: number) => void
  ) => void;
  onStartRestTimer: (seconds: number, exerciseName: string) => void;
  onCheckAllRemainingSets: () => void;
  onFinishWorkout: (notes: string, durationMinutes: number) => Promise<void>;
}

export default function ActiveSessionSheet({
  session,
  slots,
  allExercises,
  userBodyweightKg,
  soundEnabled,
  isSubmitting,
  onUpdateSet,
  onAddSet,
  onRemoveLastSet,
  onAddAdHocExercise,
  onOpenSwapSheet,
  onOpenPlateCalculator,
  onStartRestTimer,
  onCheckAllRemainingSets,
  onFinishWorkout,
}: ActiveSessionSheetProps) {
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [startedAtMs] = useState<number>(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [showAddExercisePicker, setShowAddExercisePicker] =
    useState<boolean>(false);
  const [selectedAdHocId, setSelectedAdHocId] = useState<string>(
    allExercises[0]?.id || ''
  );

  // Request Screen Wake Lock while workout logger is active
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquireWakeLock() {
      if (
        typeof navigator !== 'undefined' &&
        'wakeLock' in navigator &&
        navigator.wakeLock
      ) {
        try {
          sentinel = await navigator.wakeLock.request('screen');
          if (!cancelled) {
            setWakeLockActive(true);
          }
          sentinel.addEventListener('release', () => {
            if (!cancelled) setWakeLockActive(false);
          });
        } catch {
          if (!cancelled) setWakeLockActive(false);
        }
      }
    }

    acquireWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (sentinel) {
        sentinel.release().catch(() => {});
      }
    };
  }, []);

  // Elapsed workout duration timer
  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtMs) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  const stats = useMemo(() => {
    let totalSets = 0;
    let completedSets = 0;
    let totalTonnageKg = 0;

    for (const slot of slots) {
      for (const s of slot.sets) {
        totalSets += 1;
        const w = s.actualWeightKg ?? s.targetWeightKg;
        const r = s.actualReps ?? s.targetReps;
        const eff =
          slot.exercise.loadType === 'bodyweight_plus'
            ? userBodyweightKg * (slot.exercise.bodyweightFactor || 0.95) + w
            : slot.exercise.loadType === 'unilateral_db'
            ? w * 2
            : w;

        if (s.completed) {
          completedSets += 1;
          totalTonnageKg += eff * r;
        }
      }
    }

    const progressPct =
      totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
    const estimatedXp =
      150 + completedSets * 35 + (completedSets === totalSets && totalSets > 0 ? 50 : 0);

    return {
      totalSets,
      completedSets,
      totalTonnageKg: Math.round(totalTonnageKg),
      progressPct,
      estimatedXp,
    };
  }, [slots, userBodyweightKg]);

  const elapsedMinutes = Math.max(
    1,
    Math.round(elapsedSec / 60) || session.estimatedDurationMin || 45
  );
  const formattedClock = `${String(Math.floor(elapsedSec / 60)).padStart(
    2,
    '0'
  )}:${String(elapsedSec % 60).padStart(2, '0')}`;

  return (
    <div id="active-workout-logger" className="space-y-4">
      {/* Sticky Live Session HUD Card */}
      <div className="card bg-[#fbf5e4] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-marker text-xl">
              LIVE SESSION TRACKER
            </span>
            <span
              className={`pill text-xs py-0.5 px-2.5 ${
                wakeLockActive ? 'gold' : ''
              }`}
              title="Screen Wake Lock prevents your iPhone from locking between sets"
            >
              <Sun className="w-3.5 h-3.5 text-[#d9412b]" />
              {wakeLockActive ? 'Screen Awake' : 'Keep-Awake Ready'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="pill text-xs py-0.5 px-2.5">
              <Clock className="w-3.5 h-3.5" /> {formattedClock}
            </span>
            <span className="pill green text-xs py-0.5 px-2.5">
              <Sparkles className="w-3.5 h-3.5" /> ~+{stats.estimatedXp} XP
            </span>
          </div>
        </div>

        {/* 12-Segment Candy-Striped Session Progress Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm font-bold">
            <span>
              Sets Logged: <strong>{stats.completedSets}</strong> /{' '}
              {stats.totalSets} ({stats.progressPct}%)
            </span>
            <span>
              Live Tonnage:{' '}
              <strong>{stats.totalTonnageKg.toLocaleString()} kg</strong>
            </span>
          </div>
          <div className="bar">
            <div
              className="bar-fill green"
              style={{ width: `${stats.progressPct}%` }}
            />
          </div>
        </div>

        {stats.completedSets < stats.totalSets && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-xs font-bold text-[#5d5446]">
              Tap ✔ on each set row as you lift, or check all remaining sets at once:
            </span>
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onCheckAllRemainingSets();
              }}
              className="btn alt !min-h-[38px] !px-3 !py-1 text-sm shrink-0"
            >
              <CheckCheck className="w-4 h-4 text-[#2e7d3a]" /> Check All Sets
            </button>
          </div>
        )}
      </div>

      {/* Exercise Slot Cards */}
      <div className="space-y-4">
        {slots.map((slot) => (
          <ExerciseSlotCard
            key={`${slot.scheduleSlotId}-${slot.slotIndex}-${slot.exercise.id}`}
            slot={slot}
            userBodyweightKg={userBodyweightKg}
            soundEnabled={soundEnabled}
            onUpdateSet={onUpdateSet}
            onAddSet={onAddSet}
            onRemoveLastSet={onRemoveLastSet}
            onOpenSwapSheet={onOpenSwapSheet}
            onOpenPlateCalculator={onOpenPlateCalculator}
            onStartRestTimer={onStartRestTimer}
          />
        ))}
      </div>

      {/* Add Ad-Hoc Exercise & Session Notes */}
      <div className="card-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-marker text-base">
            + ADD EXTRA EXERCISE OR PUMP FINISHER
          </span>
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              setShowAddExercisePicker((v) => !v);
            }}
            className="btn alt !min-h-[44px] !px-3 !py-1 text-base"
          >
            <Plus className="w-4 h-4" />
            {showAddExercisePicker ? 'Hide Picker' : 'Add Exercise'}
          </button>
        </div>

        {showAddExercisePicker && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <select
              value={selectedAdHocId}
              onChange={(e) => setSelectedAdHocId(e.target.value)}
              aria-label="Select exercise to add to today's session"
              className="nb-input flex-1"
            >
              {allExercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} ({ex.primaryMuscle.replace(/_/g, ' ').toUpperCase()})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                const found = allExercises.find(
                  (ex) => ex.id === selectedAdHocId
                );
                if (found) {
                  onAddAdHocExercise(found);
                  setShowAddExercisePicker(false);
                }
              }}
              className="btn !min-h-[44px] shrink-0"
            >
              <Dumbbell className="w-4 h-4" /> Append Slot
            </button>
          </div>
        )}

        <div className="space-y-1">
          <label
            htmlFor="workout-session-notes"
            className="text-sm font-bold text-[#5d5446]"
          >
            Workout Notebook Entry / Pump & Joint Notes (Optional):
          </label>
          <input
            id="workout-session-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Lat pulldown cables felt smooth; great bicep pump on chin-ups..."
            className="nb-input"
          />
        </div>
      </div>

      {/* Prominent Finish Workout & Claim XP Card */}
      <div className="hero-card space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-marker text-xl">
              READY TO LOG THIS SESSION?
            </div>
            <p className="text-sm font-bold">
              {stats.completedSets > 0
                ? `Logging ${stats.completedSets} completed sets (${stats.totalTonnageKg.toLocaleString()} kg tonnage).`
                : `Tap below to log all ${stats.totalSets} precompiled sets and claim your XP!`}
            </p>
          </div>
          <span className="pill green font-marker text-base">
            +{stats.estimatedXp} XP
          </span>
        </div>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            playMechanicalClick(soundEnabled);
            onFinishWorkout(notes, elapsedMinutes);
          }}
          className="btn red big w-full"
        >
          <Trophy className="w-5 h-5" />
          {isSubmitting
            ? 'SAVING SESSION & CALCULATING PRs...'
            : 'FINISH WORKOUT & CLAIM XP'}
        </button>
      </div>
    </div>
  );
}
