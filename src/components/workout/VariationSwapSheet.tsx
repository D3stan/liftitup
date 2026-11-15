'use client';

import React, { useState, useMemo, useEffect } from 'react';
import type {
  ExerciseDefinition,
  PrecompiledSlot,
  PrecompiledSet,
  VariationSwapResponse,
} from '@/types/domain';
import { ArrowLeftRight, Check, X, Sparkles, Scale } from 'lucide-react';
import { playMechanicalClick, playSetComplete } from '@/lib/audio/soundEngine';
import { enqueueOutboxOp } from '@/lib/offline/outbox';

export interface VariationSwapSheetProps {
  isOpen: boolean;
  slot: PrecompiledSlot | null;
  allExercises: ExerciseDefinition[];
  userBodyweightKg: number;
  soundEnabled: boolean;
  onClose: () => void;
  onSwapApplied: (
    slotIndex: number,
    response: VariationSwapResponse,
    scope: 'session' | 'schedule'
  ) => void;
}

function roundToStep(value: number, step: number): number {
  const safeStep = step > 0 ? step : 2.5;
  return Number((Math.round(value / safeStep) * safeStep).toFixed(2));
}

function computeClientEquivalencePreview(params: {
  slot: PrecompiledSlot;
  toExercise: ExerciseDefinition;
  userBodyweightKg: number;
  scope: 'session' | 'schedule';
}): VariationSwapResponse {
  const { slot, toExercise, userBodyweightKg, scope } = params;
  const fromExercise = slot.exercise;

  const firstSet = slot.sets[0];
  const targetReps =
    firstSet?.targetReps ||
    Math.round((slot.repRangeMin + slot.repRangeMax) / 2);
  const targetRir = firstSet?.targetRir ?? slot.targetRir ?? 2;

  // Derive canonical slot e1RM from current slot
  const fromWeight = firstSet?.targetWeightKg ?? 60;
  const fromEffectiveLoad =
    fromExercise.loadType === 'bodyweight_plus'
      ? userBodyweightKg * fromExercise.bodyweightFactor + fromWeight
      : fromExercise.loadType === 'unilateral_db'
      ? fromWeight * 2
      : fromWeight;

  const computedFromE1rm =
    fromEffectiveLoad * (1 + Math.min(targetReps + targetRir, 15) / 30);
  const slotCanonicalE1rm =
    slot.slotCanonicalE1rmKg > 0
      ? slot.slotCanonicalE1rmKg
      : computedFromE1rm / (fromExercise.canonicalEquivalenceRatio || 1);

  const targetExerciseE1rm =
    slotCanonicalE1rm * (toExercise.canonicalEquivalenceRatio || 1);
  const rawTargetEffectiveLoad =
    targetExerciseE1rm / (1 + Math.min(targetReps + targetRir, 15) / 30);

  let recommendedWeightKg = 0;
  let effectiveLoadKg = 0;

  if (toExercise.loadType === 'bodyweight_plus') {
    const bwComponent = userBodyweightKg * (toExercise.bodyweightFactor || 0.95);
    const rawAdded = Math.max(0, rawTargetEffectiveLoad - bwComponent);
    recommendedWeightKg = roundToStep(rawAdded, toExercise.defaultStepKg || 1.25);
    effectiveLoadKg = Number((bwComponent + recommendedWeightKg).toFixed(1));
  } else if (toExercise.loadType === 'unilateral_db') {
    const perDb = rawTargetEffectiveLoad / 2;
    recommendedWeightKg = roundToStep(
      Math.max(2.5, perDb),
      toExercise.defaultStepKg || 2
    );
    effectiveLoadKg = Number((recommendedWeightKg * 2).toFixed(1));
  } else {
    recommendedWeightKg = roundToStep(
      Math.max(5, rawTargetEffectiveLoad),
      toExercise.defaultStepKg || 2.5
    );
    effectiveLoadKg = recommendedWeightKg;
  }

  let explanationNote = '';
  if (toExercise.loadType === 'bodyweight_plus') {
    const bwContribution = Number(
      (userBodyweightKg * (toExercise.bodyweightFactor || 0.95)).toFixed(1)
    );
    explanationNote = `Swapped from ${fromExercise.name} (${fromWeight}kg × ${targetReps}). At ${userBodyweightKg}kg BW (${Math.round(
      (toExercise.bodyweightFactor || 0.95) * 100
    )}% = ${bwContribution}kg), equivalent load is BW + ${recommendedWeightKg}kg × ${targetReps} (${effectiveLoadKg}kg total effective load).`;
  } else if (fromExercise.loadType === 'bodyweight_plus') {
    explanationNote = `Swapped from ${fromExercise.name} (BW + ${fromWeight}kg = ${Math.round(
      fromEffectiveLoad
    )}kg effective) → ${toExercise.name} at ${recommendedWeightKg}kg × ${targetReps} @ RIR ${targetRir}.`;
  } else if (toExercise.loadType === 'unilateral_db') {
    explanationNote = `Swapped from ${fromExercise.name} → ${toExercise.name}: ${recommendedWeightKg}kg per dumbbell (${effectiveLoadKg}kg combined load) × ${targetReps} @ RIR ${targetRir}.`;
  } else {
    explanationNote = `Swapped from ${fromExercise.name} (${fromWeight}kg) → ${toExercise.name} (${recommendedWeightKg}kg × ${targetReps} @ RIR ${targetRir}) via biomechanical slot equivalence.`;
  }

  const sets: PrecompiledSet[] = Array.from(
    { length: slot.targetSets },
    (_, i) => ({
      setNumber: i + 1,
      targetWeightKg: recommendedWeightKg,
      targetReps,
      targetRir,
      effectiveLoadKg,
      previousWeightKg: null,
      previousReps: null,
      previousRir: null,
      completed: false,
      actualWeightKg: recommendedWeightKg,
      actualReps: targetReps,
      actualRir: targetRir,
    })
  );

  return {
    fromExercise,
    toExercise,
    recommendedWeightKg,
    effectiveLoadKg,
    slotCanonicalE1rm: Number(slotCanonicalE1rm.toFixed(1)),
    targetReps,
    targetRir,
    scope,
    explanationNote,
    sets,
  };
}

export default function VariationSwapSheet({
  isOpen,
  slot,
  allExercises,
  userBodyweightKg,
  soundEnabled,
  onClose,
  onSwapApplied,
}: VariationSwapSheetProps) {
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [submittingScope, setSubmittingScope] = useState<
    'session' | 'schedule' | null
  >(null);

  const siblings = useMemo(() => {
    if (!slot) return [];
    if (slot.siblingsInSlot && slot.siblingsInSlot.length > 0) {
      return slot.siblingsInSlot;
    }
    return allExercises.filter((ex) => ex.movementSlot === slot.movementSlot);
  }, [slot, allExercises]);

  useEffect(() => {
    if (!slot || !isOpen) return;
    const alternative = siblings.find((ex) => ex.id !== slot.exercise.id);
    setSelectedExerciseId(alternative ? alternative.id : slot.exercise.id);
  }, [slot, isOpen, siblings]);

  const selectedExercise = useMemo(() => {
    return (
      siblings.find((ex) => ex.id === selectedExerciseId) ||
      slot?.exercise ||
      null
    );
  }, [siblings, selectedExerciseId, slot]);

  const preview = useMemo(() => {
    if (!slot || !selectedExercise) return null;
    return computeClientEquivalencePreview({
      slot,
      toExercise: selectedExercise,
      userBodyweightKg,
      scope: 'session',
    });
  }, [slot, selectedExercise, userBodyweightKg]);

  if (!isOpen || !slot || !selectedExercise || !preview) return null;

  const handleConfirmSwap = async (scope: 'session' | 'schedule') => {
    playMechanicalClick(soundEnabled);
    setSubmittingScope(scope);

    const requestBody = {
      fromExerciseId: slot.exercise.id,
      toExerciseId: selectedExercise.id,
      scheduleSlotId: slot.scheduleSlotId,
      currentWeightKg: slot.sets[0]?.targetWeightKg ?? 60,
      targetReps: preview.targetReps,
      targetRir: preview.targetRir,
      targetSets: slot.targetSets,
      scope,
    };

    try {
      const res = await fetch('/api/workouts/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        const data = await res.json();
        const swapResponse: VariationSwapResponse = data.swap || {
          ...preview,
          scope,
        };
        playSetComplete(soundEnabled);
        onSwapApplied(slot.slotIndex, swapResponse, scope);
        onClose();
        return;
      }
    } catch {
      if (scope === 'schedule') {
        enqueueOutboxOp({
          type: 'variation_swap',
          endpoint: '/api/workouts/swap',
          method: 'POST',
          payload: requestBody,
        });
      }
    } finally {
      setSubmittingScope(null);
    }

    // Fallback to client-computed preview so swap works 100% offline
    playSetComplete(soundEnabled);
    onSwapApplied(slot.slotIndex, { ...preview, scope }, scope);
    onClose();
  };

  return (
    <div className="sheet-backdrop flex items-end justify-center" onClick={onClose}>
      <div
        className="sheet-panel max-w-xl mx-auto w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="pill blue text-xs uppercase">
                <ArrowLeftRight className="w-3.5 h-3.5" /> MOVEMENT SLOT:{' '}
                {slot.movementSlot.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
            <h2 className="text-2xl font-marker mt-1">
              SWAP EXERCISE VARIATION
            </h2>
            <p className="text-sm font-bold text-[#5d5446]">
              Currently scheduled: <span className="text-[#1d1a16]">{slot.exercise.name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              onClose();
            }}
            aria-label="Close variation swap sheet"
            className="btn icon alt"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sibling Variation Cards */}
        <div className="space-y-2">
          <div className="text-sm font-bold uppercase text-[#5d5446]">
            Choose Biomechanical Equivalent ({siblings.length} options in slot):
          </div>

          <div className="space-y-2 max-h-[34dvh] overflow-y-auto pr-1">
            {siblings.map((candidate) => {
              const isSelected = candidate.id === selectedExercise.id;
              const isCurrent = candidate.id === slot.exercise.id;
              const candidatePreview = computeClientEquivalencePreview({
                slot,
                toExercise: candidate,
                userBodyweightKg,
                scope: 'session',
              });

              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    setSelectedExerciseId(candidate.id);
                  }}
                  className={`w-full text-left card-sm transition-transform duration-100 flex items-center justify-between gap-3 ${
                    isSelected
                      ? '!bg-[#fbedba] !border-[#1d1a16]'
                      : 'bg-[#fbf5e4]'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-marker text-lg">
                        {candidate.name}
                      </span>
                      {isCurrent && (
                        <span className="pill text-xs py-0 px-2">Current</span>
                      )}
                      {candidate.loadType === 'bodyweight_plus' && (
                        <span className="pill gold text-xs py-0 px-2">
                          <Scale className="w-3 h-3" /> BW + Belt
                        </span>
                      )}
                      {candidate.loadType === 'unilateral_db' && (
                        <span className="pill blue text-xs py-0 px-2">
                          Per Dumbbell
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-[#5d5446] font-bold">
                      {candidate.loadType === 'bodyweight_plus' ? (
                        <>
                          Target:{' '}
                          <span className="text-[#1d1a16]">
                            BW ({userBodyweightKg}kg) +{' '}
                            {candidatePreview.recommendedWeightKg}kg
                          </span>{' '}
                          × {candidatePreview.targetReps} (
                          {candidatePreview.effectiveLoadKg}kg effective)
                        </>
                      ) : candidate.loadType === 'unilateral_db' ? (
                        <>
                          Target:{' '}
                          <span className="text-[#1d1a16]">
                            {candidatePreview.recommendedWeightKg}kg / DB
                          </span>{' '}
                          × {candidatePreview.targetReps} (
                          {candidatePreview.effectiveLoadKg}kg total)
                        </>
                      ) : (
                        <>
                          Target:{' '}
                          <span className="text-[#1d1a16]">
                            {candidatePreview.recommendedWeightKg}kg
                          </span>{' '}
                          × {candidatePreview.targetReps} @ RIR{' '}
                          {candidatePreview.targetRir}
                        </>
                      )}
                    </div>
                  </div>

                  <div
                    className={`w-8 h-8 rounded-full border-[2.5px] border-[#1d1a16] flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-[#2e7d3a] text-white' : 'bg-[#fbf5e4]'
                    }`}
                  >
                    {isSelected && <Check className="w-4 h-4" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Equivalence Math Sticky Note */}
        <div className="note space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-marker text-sm uppercase flex items-center gap-1">
              <Sparkles className="w-4 h-4 text-[#d9412b]" /> BIOMECHANICAL EQUIVALENCE MATH
            </span>
            <span className="pill text-xs py-0 px-2">
              Slot e1RM: {preview.slotCanonicalE1rm}kg
            </span>
          </div>
          <p className="text-base font-bold leading-snug">
            {preview.explanationNote}
          </p>
        </div>

        {/* Action Buttons: Today Only vs Permanent Weekly Split */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            disabled={submittingScope !== null}
            onClick={() => handleConfirmSwap('session')}
            className="btn big w-full"
          >
            {submittingScope === 'session'
              ? 'SWAPPING...'
              : '🔄 SWAP FOR TODAY ONLY'}
          </button>

          <button
            type="button"
            disabled={submittingScope !== null}
            onClick={() => handleConfirmSwap('schedule')}
            className="btn alt !min-h-[52px] font-marker text-base w-full"
          >
            {submittingScope === 'schedule'
              ? 'SAVING SPLIT...'
              : '📅 SAVE AS DEFAULT IN SPLIT'}
          </button>
        </div>
      </div>
    </div>
  );
}
