'use client';

import React, { useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { ExercisePrefill, TrackingType, WeightUnit } from '@/types/domain';
import { NumberStepper } from '@/components/ui';
import { parseRestInput } from '@/lib/workouts/rest';
import {
  DEFAULT_DISTANCE_STEP_M,
  DEFAULT_REPS_STEP,
  DEFAULT_TIME_STEP_SECONDS,
} from '@/lib/workouts/stepSize';
import {
  getQualityBadgeColor,
  getQualityRowColor,
  getWeightFieldLabel,
  kgToDisplay,
  parseOptionalInt,
  parseOptionalNum,
  trackingUsesDistance,
  trackingUsesReps,
  trackingUsesTime,
  trackingUsesWeight,
  type LoggerSet,
} from './trackingFormat';

type NumericFieldKey = 'weightDisplay' | 'reps' | 'timeSeconds' | 'distanceM';

export function getFieldFallbackValue(
  setIdx: number,
  field: NumericFieldKey,
  sets: LoggerSet[],
  prefill: ExercisePrefill | null | undefined,
  unit: WeightUnit,
): number {
  for (let j = setIdx - 1; j >= 0; j -= 1) {
    const raw = sets[j]?.[field] ?? '';
    const parsed =
      field === 'reps' || field === 'timeSeconds'
        ? parseOptionalInt(raw)
        : parseOptionalNum(raw);
    if (parsed !== null) {
      return parsed;
    }
  }

  const prefillSet =
    prefill?.sets[setIdx] ??
    (prefill && prefill.sets.length > 0
      ? prefill.sets[prefill.sets.length - 1]
      : null);

  if (prefillSet) {
    if (field === 'weightDisplay') {
      const w = kgToDisplay(prefillSet.weightKg, unit);
      if (w !== null) return w;
    } else if (field === 'reps' && prefillSet.reps !== null) {
      return prefillSet.reps;
    } else if (field === 'timeSeconds' && prefillSet.timeSeconds !== null) {
      return prefillSet.timeSeconds;
    } else if (field === 'distanceM' && prefillSet.distanceM !== null) {
      return prefillSet.distanceM;
    }
  }

  return 0;
}

export interface LoggerSetRowProps {
  exIndex: number;
  setIndex: number;
  totalSets: number;
  setRow: LoggerSet;
  sets: LoggerSet[];
  trackingType: TrackingType;
  unit: WeightUnit;
  enableSetQuality: boolean;
  isEditing: boolean;
  effectiveWeightStep: number;
  prefill: ExercisePrefill | null;
  isCurrentFocusSet?: boolean;
  onUpdateSet: (
    exIndex: number,
    setIndex: number,
    patch: Partial<LoggerSet>,
  ) => void;
  onToggleSetComplete: (exIndex: number, setIndex: number) => void;
  onRemoveSet: (exIndex: number, setIndex: number) => void;
  onOpenQuality: (setIndex: number) => void;
}

export default function LoggerSetRow({
  exIndex,
  setIndex,
  totalSets,
  setRow,
  sets,
  trackingType,
  unit,
  enableSetQuality,
  isEditing,
  effectiveWeightStep,
  prefill,
  isCurrentFocusSet = false,
  onUpdateSet,
  onToggleSetComplete,
  onRemoveSet,
  onOpenQuality,
}: LoggerSetRowProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usesWeight = trackingUsesWeight(trackingType);
  const usesReps = trackingUsesReps(trackingType);
  const usesTime = trackingUsesTime(trackingType);
  const usesDist = trackingUsesDistance(trackingType);
  const fieldCount =
    (usesWeight ? 1 : 0) +
    (usesReps ? 1 : 0) +
    (usesTime ? 1 : 0) +
    (usesDist ? 1 : 0);

  const hasQualityData =
    setRow.executionQualityPct !== null || setRow.repQualities.length > 0;
  const showQualityControl = enableSetQuality || isEditing || hasQualityData;
  const rowColor = getQualityRowColor(
    setRow.isCompleted,
    enableSetQuality || hasQualityData,
    setRow.executionQualityPct,
  );
  const qualityValue = setRow.executionQualityPct ?? 100;

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.target instanceof Element &&
      e.target.closest('button, input, textarea')
    ) {
      return;
    }
    if (!showQualityControl) return;
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      onOpenQuality(setIndex);
    }, 480);
  };

  return (
    <div
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      className={`rounded-[10px] border-[2.5px] border-[var(--line)] p-2.5 shadow-[2px_2px_0_var(--shadow-color)] transition-colors motion-reduce:transition-none ${rowColor} ${
        isCurrentFocusSet && !setRow.isCompleted
          ? 'ring-2 ring-[var(--gold)] ring-offset-1 ring-offset-[var(--card)]'
          : ''
      }`}
    >
      {/* Top line: Set # + Current badge + Quality pill + Remove + Check */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="pill bg-[var(--card)] px-2.5 py-0.5 font-marker text-xs">
            Set {setIndex + 1}
          </span>
          {isCurrentFocusSet && !setRow.isCompleted && (
            <span className="pill gold px-2 py-0.5 text-[11px]">Next</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {showQualityControl && (
            <button
              type="button"
              onClick={() => onOpenQuality(setIndex)}
              aria-label={`Set ${setIndex + 1} quality`}
              className={`min-h-[44px] min-w-[54px] rounded-[8px] border-[2.5px] border-[var(--line)] px-2.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${getQualityBadgeColor(
                setRow.executionQualityPct,
              )}`}
            >
              {qualityValue}%
            </button>
          )}

          {totalSets > 1 && (
            <button
              type="button"
              onClick={() => onRemoveSet(exIndex, setIndex)}
              aria-label={`Delete set ${setIndex + 1}`}
              className="btn alt icon !h-[44px] !w-[44px]"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onToggleSetComplete(exIndex, setIndex)}
            aria-label={
              setRow.isCompleted
                ? `Uncheck set ${setIndex + 1}`
                : `Complete set ${setIndex + 1}`
            }
            className={`btn icon !h-[44px] !w-[48px] ${
              setRow.isCompleted ? 'green' : 'alt'
            }`}
          >
            <Check className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Full-width steppers at 375px, 2-col on sm+ (>=16px font, >=44px targets) */}
      <div
        className={`grid gap-2 ${
          fieldCount >= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {usesWeight && (
          <div className="space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              {getWeightFieldLabel(trackingType, unit)}
            </span>
            <NumberStepper
              value={setRow.weightDisplay}
              onChange={(next) =>
                onUpdateSet(exIndex, setIndex, { weightDisplay: next })
              }
              step={effectiveWeightStep}
              min={0}
              inputMode="decimal"
              placeholder="0"
              fallbackValue={getFieldFallbackValue(
                setIndex,
                'weightDisplay',
                sets,
                prefill,
                unit,
              )}
              ariaLabel={`Set ${setIndex + 1} weight (${unit})`}
              decrementLabel={`Decrease set ${setIndex + 1} weight by ${effectiveWeightStep} ${unit}`}
              incrementLabel={`Increase set ${setIndex + 1} weight by ${effectiveWeightStep} ${unit}`}
            />
          </div>
        )}

        {usesReps && (
          <div className="space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Reps
            </span>
            <NumberStepper
              value={setRow.reps}
              onChange={(next) =>
                onUpdateSet(exIndex, setIndex, { reps: next })
              }
              step={DEFAULT_REPS_STEP}
              min={0}
              inputMode="numeric"
              placeholder="0"
              fallbackValue={getFieldFallbackValue(
                setIndex,
                'reps',
                sets,
                prefill,
                unit,
              )}
              ariaLabel={`Set ${setIndex + 1} reps`}
              decrementLabel={`Decrease set ${setIndex + 1} reps`}
              incrementLabel={`Increase set ${setIndex + 1} reps`}
            />
          </div>
        )}

        {usesDist && (
          <div className="space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Meters
            </span>
            <NumberStepper
              value={setRow.distanceM}
              onChange={(next) =>
                onUpdateSet(exIndex, setIndex, { distanceM: next })
              }
              step={DEFAULT_DISTANCE_STEP_M}
              min={0}
              inputMode="decimal"
              placeholder="0"
              fallbackValue={getFieldFallbackValue(
                setIndex,
                'distanceM',
                sets,
                prefill,
                unit,
              )}
              ariaLabel={`Set ${setIndex + 1} distance meters`}
              decrementLabel={`Decrease set ${setIndex + 1} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
              incrementLabel={`Increase set ${setIndex + 1} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
            />
          </div>
        )}

        {usesTime && (
          <div className="space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Seconds
            </span>
            <NumberStepper
              value={setRow.timeSeconds}
              onChange={(next) =>
                onUpdateSet(exIndex, setIndex, { timeSeconds: next })
              }
              step={DEFAULT_TIME_STEP_SECONDS}
              min={0}
              inputMode="numeric"
              placeholder="0"
              fallbackValue={getFieldFallbackValue(
                setIndex,
                'timeSeconds',
                sets,
                prefill,
                unit,
              )}
              ariaLabel={`Set ${setIndex + 1} seconds`}
              decrementLabel={`Decrease set ${setIndex + 1} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
              incrementLabel={`Increase set ${setIndex + 1} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
            />
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Plan rest (s)
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={
                setRow.restSecondsDisplay ??
                (setRow.restSeconds !== null ? String(setRow.restSeconds) : '')
              }
              onChange={(e) => {
                const raw = e.target.value;
                onUpdateSet(exIndex, setIndex, {
                  restSecondsDisplay: raw,
                  restSeconds: parseRestInput(raw),
                });
              }}
              placeholder="—"
              aria-label={`Set ${setIndex + 1} planned rest seconds`}
              className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--card)] px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
            />
          </label>

          <label className="block space-y-0.5">
            <span className="flex items-center gap-1 text-xs font-bold uppercase text-[var(--muted)]">
              <span>Actual rest (s)</span>
              {setRow.restApproximate &&
                setRow.actualRestSeconds !== null &&
                setRow.actualRestSeconds !== undefined && (
                  <span className="rounded bg-[var(--gold-bg)] px-1 text-[10px] font-bold text-[var(--ink)]">
                    ~
                  </span>
                )}
            </span>
            <input
              type="text"
              inputMode="text"
              value={
                setRow.actualRestDisplay ??
                (setRow.actualRestSeconds !== null &&
                setRow.actualRestSeconds !== undefined
                  ? String(setRow.actualRestSeconds)
                  : '')
              }
              onChange={(e) => {
                const raw = e.target.value;
                onUpdateSet(exIndex, setIndex, {
                  actualRestDisplay: raw,
                  actualRestSeconds: parseRestInput(raw),
                  restApproximate: false,
                });
              }}
              placeholder="—"
              aria-label={`Set ${setIndex + 1} actual rest seconds`}
              className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--card)] px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}
