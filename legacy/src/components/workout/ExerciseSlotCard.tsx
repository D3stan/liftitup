'use client';

import React, { useState } from 'react';
import type { PrecompiledSlot, PrecompiledSet } from '@/types/domain';
import {
  ArrowLeftRight,
  Check,
  Plus,
  Minus,
  Disc,
  ChevronDown,
  ChevronUp,
  Trash2,
  Scale,
  CheckCheck,
} from 'lucide-react';
import { playMechanicalClick, playSetComplete } from '@/lib/audio/soundEngine';

export interface ExerciseSlotCardProps {
  slot: PrecompiledSlot;
  userBodyweightKg: number;
  soundEnabled: boolean;
  onUpdateSet: (
    slotIndex: number,
    setNumber: number,
    patch: Partial<PrecompiledSet>
  ) => void;
  onAddSet: (slotIndex: number) => void;
  onRemoveLastSet: (slotIndex: number) => void;
  onOpenSwapSheet: (slot: PrecompiledSlot) => void;
  onOpenPlateCalculator: (
    initialWeightKg: number,
    onApply: (newWeightKg: number) => void
  ) => void;
  onStartRestTimer: (seconds: number, exerciseName: string) => void;
}

function getProgressionBadgeStyle(type: PrecompiledSlot['progressionType']): {
  className: string;
  icon: string;
} {
  switch (type) {
    case 'load_up':
      return { className: 'gold', icon: '🚀' };
    case 'add_rep':
      return { className: 'green', icon: '📈' };
    case 'variation_equiv':
      return { className: 'blue', icon: '🔄' };
    case 'hold':
      return { className: '', icon: '🛡️' };
    default:
      return { className: 'gold', icon: '✨' };
  }
}

export default function ExerciseSlotCard({
  slot,
  userBodyweightKg,
  soundEnabled,
  onUpdateSet,
  onAddSet,
  onRemoveLastSet,
  onOpenSwapSheet,
  onOpenPlateCalculator,
  onStartRestTimer,
}: ExerciseSlotCardProps) {
  const [showCues, setShowCues] = useState<boolean>(false);

  const { exercise } = slot;
  const badgeStyle = getProgressionBadgeStyle(slot.progressionType);
  const completedCount = slot.sets.filter((s) => s.completed).length;
  const allCompleted =
    slot.sets.length > 0 && completedCount === slot.sets.length;

  const stepKg = exercise.defaultStepKg || 2.5;
  const isBodyweightPlus = exercise.loadType === 'bodyweight_plus';
  const isUnilateralDb = exercise.loadType === 'unilateral_db';
  const baseBodyweightEffectiveKg = isBodyweightPlus
    ? Number((userBodyweightKg * (exercise.bodyweightFactor || 0.95)).toFixed(1))
    : 0;

  const computeEffective = (enteredWeightKg: number): number => {
    if (isBodyweightPlus) {
      return Number((baseBodyweightEffectiveKg + enteredWeightKg).toFixed(1));
    }
    if (isUnilateralDb) {
      return Number((enteredWeightKg * 2).toFixed(1));
    }
    return enteredWeightKg;
  };

  const handleCompleteAllSets = () => {
    playSetComplete(soundEnabled);
    slot.sets.forEach((s) => {
      if (!s.completed) {
        const w = s.actualWeightKg ?? s.targetWeightKg;
        const r = s.actualReps ?? s.targetReps;
        const rir = s.actualRir ?? s.targetRir;
        onUpdateSet(slot.slotIndex, s.setNumber, {
          completed: true,
          actualWeightKg: w,
          actualReps: r,
          actualRir: rir,
          effectiveLoadKg: computeEffective(w),
        });
      }
    });
    onStartRestTimer(slot.restSeconds, exercise.name);
  };

  return (
    <div
      className={`card space-y-3.5 transition-colors duration-150 ${
        allCompleted ? 'bg-[#eef7e8]' : ''
      }`}
    >
      {/* Top Row: Slot Index, Title, Muscle Tags & 1-Tap Variation Swap */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pill bg-[#1d1a16] text-[#fbf5e4] text-xs py-0.5 px-2.5 font-marker">
              #{slot.slotIndex + 1}
            </span>
            <span className={`pill ${badgeStyle.className} text-xs py-0.5 px-2.5`}>
              {badgeStyle.icon} {slot.progressionBadge}
            </span>
            <span className="pill text-xs py-0.5 px-2 uppercase">
              {exercise.primaryMuscle.replace(/_/g, ' ')}
            </span>
            {exercise.secondaryMuscles.map((sec) => (
              <span
                key={sec.muscle}
                className="pill text-xs py-0.5 px-2 text-[#5d5446] bg-[#ece2c6]"
              >
                +{sec.muscle.replace(/_/g, ' ')} ({sec.factor}x)
              </span>
            ))}
          </div>

          <h3 className="text-2xl font-marker leading-tight pt-0.5">
            {exercise.name}
          </h3>

          <div className="text-sm font-bold text-[#5d5446] flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Target: {slot.targetSets} sets × {slot.repRangeMin}–
              {slot.repRangeMax} reps @ RIR {slot.targetRir}
            </span>
            <span>• Rest {slot.restSeconds}s</span>
            {slot.exerciseE1rmKg > 0 && (
              <span>• Est. 1RM: {Math.round(slot.exerciseE1rmKg)}kg</span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            playMechanicalClick(soundEnabled);
            onOpenSwapSheet(slot);
          }}
          className="btn blue !min-h-[44px] !px-3 !py-1.5 text-base shrink-0"
          title="Swap variation within movement slot"
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Swap</span>
        </button>
      </div>

      {/* Bodyweight + Belt Equivalence Banner (for Weighted Chin-ups / Pull-ups / Dips) */}
      {isBodyweightPlus && (
        <div className="bg-[#fbedba] border-[2.5px] border-[#1d1a16] rounded-[8px] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
          <div className="flex items-center gap-1.5">
            <Scale className="w-4 h-4 text-[#d9412b] shrink-0" />
            <span>
              Bodyweight Anchor: <strong>{userBodyweightKg}kg BW</strong> ×{' '}
              {Math.round((exercise.bodyweightFactor || 0.95) * 100)}% ={' '}
              <strong>{baseBodyweightEffectiveKg}kg</strong> base pull
            </span>
          </div>
          <span className="pill gold text-xs py-0.5 px-2">
            Enter Added Belt Weight Below
          </span>
        </div>
      )}

      {/* Sticky Note: Smart Double-Progression Reason + Previous Performance */}
      <div className="note space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs font-bold uppercase text-[#5d5446]">
          <span>{slot.previousSummary}</span>
          {exercise.formCues && exercise.formCues.length > 0 && (
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                setShowCues((v) => !v);
              }}
              className="inline-flex items-center gap-1 text-[#1d1a16] underline cursor-pointer"
            >
              Form Cues
              {showCues ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
        <p className="text-base font-bold leading-snug">
          {slot.progressionReason}
        </p>

        {showCues && exercise.formCues.length > 0 && (
          <ul className="pt-1.5 mt-1.5 border-t border-dashed border-[#1d1a16]/30 text-sm font-bold space-y-1 list-disc list-inside">
            {exercise.formCues.map((cue, idx) => (
              <li key={idx}>{cue}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Precompiled Set Rows */}
      <div className="space-y-2.5">
        {slot.sets.map((setRow) => {
          const currentWeight =
            setRow.actualWeightKg !== undefined
              ? setRow.actualWeightKg
              : setRow.targetWeightKg;
          const currentReps =
            setRow.actualReps !== undefined
              ? setRow.actualReps
              : setRow.targetReps;
          const currentRir =
            setRow.actualRir !== undefined
              ? setRow.actualRir
              : setRow.targetRir;
          const isDone = Boolean(setRow.completed);
          const effectiveKg = computeEffective(currentWeight);

          const updateWeight = (nextWeight: number) => {
            const clamped = Math.max(0, Number(nextWeight.toFixed(2)));
            onUpdateSet(slot.slotIndex, setRow.setNumber, {
              actualWeightKg: clamped,
              effectiveLoadKg: computeEffective(clamped),
            });
          };

          const updateReps = (nextReps: number) => {
            const clamped = Math.max(1, Math.round(nextReps));
            onUpdateSet(slot.slotIndex, setRow.setNumber, {
              actualReps: clamped,
            });
          };

          const updateRir = (nextRir: number) => {
            const clamped = Math.max(0, Math.min(5, Math.round(nextRir)));
            onUpdateSet(slot.slotIndex, setRow.setNumber, {
              actualRir: clamped,
            });
          };

          const toggleComplete = () => {
            const nextDone = !isDone;
            if (nextDone) {
              playSetComplete(soundEnabled);
              onStartRestTimer(slot.restSeconds, exercise.name);
            } else {
              playMechanicalClick(soundEnabled);
            }
            onUpdateSet(slot.slotIndex, setRow.setNumber, {
              completed: nextDone,
              actualWeightKg: currentWeight,
              actualReps: currentReps,
              actualRir: currentRir,
              effectiveLoadKg: effectiveKg,
            });
          };

          return (
            <div
              key={setRow.setNumber}
              className={`border-[3px] border-[#1d1a16] rounded-[10px] p-2.5 transition-colors duration-120 ${
                isDone ? 'bg-[#cde6c0]' : 'bg-[#fbf5e4]'
              }`}
              style={{ boxShadow: '3px 3px 0 var(--ink)' }}
            >
              {/* Set Header Line */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-marker text-base px-2 py-0.5 bg-[#1d1a16] text-[#fbf5e4] rounded-[5px]">
                    SET {setRow.setNumber}
                  </span>
                  {isBodyweightPlus ? (
                    <span className="text-sm font-bold text-[#1d1a16]">
                      BW ({baseBodyweightEffectiveKg}kg) +{' '}
                      <strong>{currentWeight}kg</strong> ={' '}
                      <span className="underline">{effectiveKg}kg total</span>
                    </span>
                  ) : isUnilateralDb ? (
                    <span className="text-sm font-bold text-[#5d5446]">
                      {currentWeight}kg / hand ({effectiveKg}kg combined)
                    </span>
                  ) : (
                    setRow.previousWeightKg != null &&
                    setRow.previousReps != null && (
                      <span className="text-xs font-bold text-[#5d5446]">
                        Prev: {setRow.previousWeightKg}kg ×{' '}
                        {setRow.previousReps}
                      </span>
                    )
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      playMechanicalClick(soundEnabled);
                      onOpenPlateCalculator(currentWeight, (newW) =>
                        updateWeight(newW)
                      );
                    }}
                    className="pill text-xs py-1 px-2.5 cursor-pointer min-h-[34px]"
                    title="Open barbell plate calculator"
                  >
                    <Disc className="w-3.5 h-3.5 text-[#d9412b]" /> Plates
                  </button>
                </div>
              </div>

              {/* Controls Grid: Weight | Reps | RIR | Check Button */}
              <div className="grid grid-cols-12 gap-2 items-center">
                {/* Weight Stepper (5 cols) */}
                <div className="col-span-5 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                    {isBodyweightPlus
                      ? 'Added kg'
                      : isUnilateralDb
                      ? 'DB kg'
                      : 'Weight (kg)'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        playMechanicalClick(soundEnabled);
                        updateWeight(currentWeight - stepKg);
                      }}
                      aria-label={`Decrease weight for set ${setRow.setNumber}`}
                      className="stepper-btn !w-[44px] !h-[44px] shrink-0"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={currentWeight}
                      onChange={(e) => {
                        const raw = e.target.value.replace(',', '.');
                        const val = parseFloat(raw);
                        if (!Number.isNaN(val)) {
                          updateWeight(val);
                        } else if (raw === '') {
                          updateWeight(0);
                        }
                      }}
                      aria-label={`Weight in kg for set ${setRow.setNumber}`}
                      className="nb-input !px-1 !py-1 text-center font-marker !text-lg min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        playMechanicalClick(soundEnabled);
                        updateWeight(currentWeight + stepKg);
                      }}
                      aria-label={`Increase weight for set ${setRow.setNumber}`}
                      className="stepper-btn !w-[44px] !h-[44px] shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Reps Stepper (4 cols) */}
                <div className="col-span-4 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                    Reps ({slot.repRangeMin}–{slot.repRangeMax})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        playMechanicalClick(soundEnabled);
                        updateReps(currentReps - 1);
                      }}
                      aria-label={`Decrease reps for set ${setRow.setNumber}`}
                      className="stepper-btn !w-[44px] !h-[44px] shrink-0"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={currentReps}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!Number.isNaN(val)) {
                          updateReps(val);
                        }
                      }}
                      aria-label={`Reps for set ${setRow.setNumber}`}
                      className="nb-input !px-1 !py-1 text-center font-marker !text-lg min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        playMechanicalClick(soundEnabled);
                        updateReps(currentReps + 1);
                      }}
                      aria-label={`Increase reps for set ${setRow.setNumber}`}
                      className="stepper-btn !w-[44px] !h-[44px] shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* RIR Selector + 1-Tap Log Set Checkoff (3 cols) */}
                <div className="col-span-3 flex items-end justify-end gap-1.5">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                      RIR
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        playMechanicalClick(soundEnabled);
                        updateRir((currentRir + 1) % 5);
                      }}
                      title="Tap to cycle Reps In Reserve (0..4)"
                      className="btn alt !min-h-[44px] !min-w-[44px] !px-2 !py-1 font-marker text-base"
                    >
                      {currentRir}
                    </button>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                      {isDone ? 'Done' : 'Log'}
                    </span>
                    <button
                      type="button"
                      onClick={toggleComplete}
                      aria-label={`Complete set ${setRow.setNumber}`}
                      className={`btn !min-h-[44px] !min-w-[48px] !px-2.5 !py-1 ${
                        isDone ? 'green' : ''
                      }`}
                    >
                      <Check className="w-5 h-5 stroke-[3]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Slot Footer: + Add Set, Remove Set, Complete All */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              onAddSet(slot.slotIndex);
            }}
            className="btn alt !min-h-[44px] !px-3 !py-1 text-base"
          >
            <Plus className="w-4 h-4" /> Add Set
          </button>

          {slot.sets.length > 1 && (
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onRemoveLastSet(slot.slotIndex);
              }}
              aria-label="Remove last set"
              className="btn alt !min-h-[44px] !px-3 !py-1 text-base"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {!allCompleted && (
          <button
            type="button"
            onClick={handleCompleteAllSets}
            className="btn green !min-h-[44px] !px-3.5 !py-1 text-base"
          >
            <CheckCheck className="w-4 h-4" /> Check All {slot.sets.length} Sets
          </button>
        )}
      </div>
    </div>
  );
}
