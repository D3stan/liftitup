'use client';

import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCheck,
  Plus,
  StickyNote,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import type { ExercisePrefill, WeightUnit } from '@/types/domain';
import { Button, NumberStepper, Sheet } from '@/components/ui';
import { parseRestInput } from '@/lib/workouts/rest';
import {
  DEFAULT_DISTANCE_STEP_M,
  DEFAULT_REPS_STEP,
  DEFAULT_TIME_STEP_SECONDS,
  DEFAULT_WEIGHT_STEP_KG,
  DEFAULT_WEIGHT_STEP_LB,
  displayStepToKg,
  KG_WEIGHT_STEP_OPTIONS,
  LB_WEIGHT_STEP_OPTIONS,
  type WeightStepSource,
} from '@/lib/workouts/stepSize';
import SetQualityPopover from './SetQualityPopover';
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
  type LoggerExercise,
  type LoggerSet,
} from './trackingFormat';

export interface ExerciseLoggerCardProps {
  exercise: LoggerExercise;
  index: number;
  totalCount: number;
  unit: WeightUnit;
  enableSetQuality: boolean;
  isEditing?: boolean;
  weightStepDisplay?: number;
  weightStepSource?: WeightStepSource;
  isCustomExercise?: boolean;
  hasUserStepOverride?: boolean;
  hasCustomExerciseStep?: boolean;
  prefill?: ExercisePrefill | null;
  onChangeWeightStep?: (
    exerciseId: string,
    weightStepKg: number | null,
  ) => Promise<void>;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDeleteExercise: (index: number) => void;
  onOpenSwap: (index: number) => void;
  onChangeNotes: (index: number, notes: string) => void;
  onUpdateSet: (
    exIndex: number,
    setIndex: number,
    patch: Partial<LoggerSet>,
  ) => void;
  onToggleSetComplete: (exIndex: number, setIndex: number) => void;
  onAddSet: (exIndex: number) => void;
  onRemoveSet: (exIndex: number, setIndex: number) => void;
  onCheckAll: (exIndex: number) => void;
  onStartRestTimer: (seconds: number, label: string) => void;
}

type NumericFieldKey = 'weightDisplay' | 'reps' | 'timeSeconds' | 'distanceM';

function getFieldFallbackValue(
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

const STEP_SOURCE_LABEL: Record<WeightStepSource, string> = {
  override: 'Personal override for this exercise',
  exercise: 'Exercise default step',
  global: 'Your Training default step',
  default: 'App default step',
};

export default function ExerciseLoggerCard({
  exercise,
  index,
  totalCount,
  unit,
  enableSetQuality,
  isEditing = false,
  weightStepDisplay,
  weightStepSource = 'default',
  isCustomExercise = false,
  hasUserStepOverride = false,
  hasCustomExerciseStep = false,
  prefill = null,
  onChangeWeightStep,
  onMoveUp,
  onMoveDown,
  onDeleteExercise,
  onOpenSwap,
  onChangeNotes,
  onUpdateSet,
  onToggleSetComplete,
  onAddSet,
  onRemoveSet,
  onCheckAll,
  onStartRestTimer,
}: ExerciseLoggerCardProps) {
  const [noteOpen, setNoteOpen] = useState(exercise.notes.trim().length > 0);
  const [qualitySetIdx, setQualitySetIdx] = useState<number | null>(null);
  const [stepSheetOpen, setStepSheetOpen] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveWeightStep =
    weightStepDisplay ??
    (unit === 'lb' ? DEFAULT_WEIGHT_STEP_LB : DEFAULT_WEIGHT_STEP_KG);
  const weightStepOptions =
    unit === 'lb' ? LB_WEIGHT_STEP_OPTIONS : KG_WEIGHT_STEP_OPTIONS;
  const canResetStep = isCustomExercise
    ? hasCustomExerciseStep
    : hasUserStepOverride;

  const t = exercise.trackingType;
  const usesWeight = trackingUsesWeight(t);
  const usesReps = trackingUsesReps(t);
  const usesTime = trackingUsesTime(t);
  const usesDist = trackingUsesDistance(t);

  const fieldCount =
    (usesWeight ? 1 : 0) +
    (usesReps ? 1 : 0) +
    (usesTime ? 1 : 0) +
    (usesDist ? 1 : 0);

  const completedCount = exercise.sets.filter((s) => s.isCompleted).length;
  const allDone =
    exercise.sets.length > 0 && completedCount === exercise.sets.length;

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (
    setIdx: number,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      e.target instanceof Element &&
      e.target.closest('button, input, textarea')
    ) {
      return;
    }
    const targetSet = exercise.sets[setIdx];
    const allowQuality =
      enableSetQuality ||
      isEditing ||
      (targetSet?.executionQualityPct !== null &&
        targetSet?.executionQualityPct !== undefined) ||
      (targetSet?.repQualities?.length ?? 0) > 0;
    if (!allowQuality) return;
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      setQualitySetIdx(setIdx);
    }, 480);
  };

  const handleSelectWeightStep = async (nextStepKg: number | null) => {
    if (!onChangeWeightStep || savingStep) return;
    setSavingStep(true);
    try {
      await onChangeWeightStep(exercise.exerciseId, nextStepKg);
      setStepSheetOpen(false);
    } finally {
      setSavingStep(false);
    }
  };

  const activeQualitySet =
    qualitySetIdx !== null ? exercise.sets[qualitySetIdx] ?? null : null;

  return (
    <div
      className={`card space-y-3 transition-colors duration-150 ${
        allDone ? 'bg-[color-mix(in_srgb,var(--green-bg)_55%,var(--card))]' : ''
      }`}
    >
      {/* Header: Order + Name + Controls */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="pill shrink-0 !bg-[var(--ink)] px-2.5 py-0.5 font-marker text-xs !text-[var(--card)]">
              #{index + 1}
            </span>
            <h3 className="min-w-0 flex-1 font-marker text-xl leading-tight text-[var(--ink)]">
              {exercise.exerciseName}
            </h3>
          </div>
          {usesWeight && onChangeWeightStep && (
            <button
              type="button"
              onClick={() => setStepSheetOpen(true)}
              aria-label={`Weight step for ${exercise.exerciseName}: plus or minus ${effectiveWeightStep} ${unit}`}
              className={`btn alt !min-h-[44px] shrink-0 !px-2.5 text-xs ${
                canResetStep ? '!bg-[var(--gold-bg)]' : ''
              }`}
            >
              <span>
                ±{effectiveWeightStep}
                {unit}
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMoveUp(index)}
            aria-label={`Move ${exercise.exerciseName} up`}
            className="btn alt icon !h-[44px] !w-[44px]"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={index === totalCount - 1}
            onClick={() => onMoveDown(index)}
            aria-label={`Move ${exercise.exerciseName} down`}
            className="btn alt icon !h-[44px] !w-[44px]"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onOpenSwap(index)}
            className="btn blue !min-h-[44px] !px-3 text-sm"
          >
            <ArrowLeftRight className="h-4 w-4" />
            <span>Swap</span>
          </button>
          {!noteOpen && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="btn alt !min-h-[44px] !px-3 text-sm"
            >
              <StickyNote className="h-4 w-4" />
              <span>Note</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteExercise(index)}
            aria-label={`Remove ${exercise.exerciseName}`}
            className="btn red icon ml-auto !h-[44px] !w-[44px]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Optional Exercise Note (hidden when empty unless opened) */}
      {(noteOpen || exercise.notes.trim().length > 0) && (
        <div className="note space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-[var(--muted)]">
              Exercise Note
            </span>
            {exercise.notes.trim().length === 0 && (
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                aria-label="Close empty note"
                className="flex h-7 w-7 items-center justify-center rounded border border-[var(--line)]/40 bg-[var(--card)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={exercise.notes}
            onChange={(e) => onChangeNotes(index, e.target.value)}
            placeholder="Note..."
            className="w-full resize-none rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-base font-bold outline-none"
          />
        </div>
      )}

      {/* Stacked Mobile Set Rows */}
      <div className="space-y-2.5">
        {exercise.sets.map((setRow, setIdx) => {
          const hasQualityData =
            setRow.executionQualityPct !== null ||
            setRow.repQualities.length > 0;
          const showQualityControl =
            enableSetQuality || isEditing || hasQualityData;
          const rowColor = getQualityRowColor(
            setRow.isCompleted,
            enableSetQuality || hasQualityData,
            setRow.executionQualityPct,
          );
          const qualityValue = setRow.executionQualityPct ?? 100;

          return (
            <div
              key={setRow.localId}
              onPointerDown={(e) => startLongPress(setIdx, e)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              className={`rounded-[10px] border-[2.5px] border-[var(--line)] p-2.5 shadow-[2px_2px_0_var(--shadow-color)] transition-colors ${rowColor}`}
            >
              {/* Top line: Set # + Quality pill + Check + Remove */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="pill bg-[var(--card)] px-2.5 py-0.5 font-marker text-xs">
                  Set {setIdx + 1}
                </span>

                <div className="flex items-center gap-1.5">
                  {showQualityControl && (
                    <button
                      type="button"
                      onClick={() => setQualitySetIdx(setIdx)}
                      aria-label={`Set ${setIdx + 1} quality`}
                      className={`min-h-[44px] min-w-[54px] rounded-[8px] border-[2.5px] border-[var(--line)] px-2.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${getQualityBadgeColor(
                        setRow.executionQualityPct,
                      )}`}
                    >
                      {qualityValue}%
                    </button>
                  )}

                  {exercise.sets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveSet(index, setIdx)}
                      aria-label={`Delete set ${setIdx + 1}`}
                      className="btn alt icon !h-[44px] !w-[44px]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onToggleSetComplete(index, setIdx)}
                    aria-label={
                      setRow.isCompleted
                        ? `Uncheck set ${setIdx + 1}`
                        : `Complete set ${setIdx + 1}`
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
                      {getWeightFieldLabel(t, unit)}
                    </span>
                    <NumberStepper
                      value={setRow.weightDisplay}
                      onChange={(next) =>
                        onUpdateSet(index, setIdx, { weightDisplay: next })
                      }
                      step={effectiveWeightStep}
                      min={0}
                      inputMode="decimal"
                      placeholder="0"
                      fallbackValue={getFieldFallbackValue(
                        setIdx,
                        'weightDisplay',
                        exercise.sets,
                        prefill,
                        unit,
                      )}
                      ariaLabel={`Set ${setIdx + 1} weight (${unit})`}
                      decrementLabel={`Decrease set ${setIdx + 1} weight by ${effectiveWeightStep} ${unit}`}
                      incrementLabel={`Increase set ${setIdx + 1} weight by ${effectiveWeightStep} ${unit}`}
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
                        onUpdateSet(index, setIdx, { reps: next })
                      }
                      step={DEFAULT_REPS_STEP}
                      min={0}
                      inputMode="numeric"
                      placeholder="0"
                      fallbackValue={getFieldFallbackValue(
                        setIdx,
                        'reps',
                        exercise.sets,
                        prefill,
                        unit,
                      )}
                      ariaLabel={`Set ${setIdx + 1} reps`}
                      decrementLabel={`Decrease set ${setIdx + 1} reps`}
                      incrementLabel={`Increase set ${setIdx + 1} reps`}
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
                        onUpdateSet(index, setIdx, { distanceM: next })
                      }
                      step={DEFAULT_DISTANCE_STEP_M}
                      min={0}
                      inputMode="decimal"
                      placeholder="0"
                      fallbackValue={getFieldFallbackValue(
                        setIdx,
                        'distanceM',
                        exercise.sets,
                        prefill,
                        unit,
                      )}
                      ariaLabel={`Set ${setIdx + 1} distance meters`}
                      decrementLabel={`Decrease set ${setIdx + 1} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
                      incrementLabel={`Increase set ${setIdx + 1} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
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
                        onUpdateSet(index, setIdx, { timeSeconds: next })
                      }
                      step={DEFAULT_TIME_STEP_SECONDS}
                      min={0}
                      inputMode="numeric"
                      placeholder="0"
                      fallbackValue={getFieldFallbackValue(
                        setIdx,
                        'timeSeconds',
                        exercise.sets,
                        prefill,
                        unit,
                      )}
                      ariaLabel={`Set ${setIdx + 1} seconds`}
                      decrementLabel={`Decrease set ${setIdx + 1} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
                      incrementLabel={`Increase set ${setIdx + 1} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
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
                        (setRow.restSeconds !== null
                          ? String(setRow.restSeconds)
                          : '')
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSet(index, setIdx, {
                          restSecondsDisplay: raw,
                          restSeconds: parseRestInput(raw),
                        });
                      }}
                      placeholder="—"
                      aria-label={`Set ${setIdx + 1} planned rest seconds`}
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
                        onUpdateSet(index, setIdx, {
                          actualRestDisplay: raw,
                          actualRestSeconds: parseRestInput(raw),
                          restApproximate: false,
                        });
                      }}
                      placeholder="—"
                      aria-label={`Set ${setIdx + 1} actual rest seconds`}
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--card)] px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onAddSet(index)}
          className="btn alt !min-h-[44px] flex-1 text-base"
        >
          <Plus className="h-4 w-4" />
          <span>Add set</span>
        </button>

        {!allDone && (
          <button
            type="button"
            onClick={() => onCheckAll(index)}
            className="btn green !min-h-[44px] text-base"
          >
            <CheckCheck className="h-4 w-4" />
            <span>Check all</span>
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            onStartRestTimer(exercise.defaultRestSeconds, exercise.exerciseName)
          }
          className="btn alt !min-h-[44px] !px-3 text-sm"
          aria-label="Start rest timer"
        >
          <Timer className="h-4 w-4" />
          <span>{exercise.defaultRestSeconds}s</span>
        </button>
      </div>

      {(enableSetQuality ||
        isEditing ||
        (activeQualitySet &&
          (activeQualitySet.executionQualityPct !== null ||
            activeQualitySet.repQualities.length > 0))) &&
        activeQualitySet &&
        qualitySetIdx !== null && (
        <SetQualityPopover
          open={true}
          onClose={() => setQualitySetIdx(null)}
          setNumber={qualitySetIdx + 1}
          reps={parseOptionalInt(activeQualitySet.reps)}
          qualityPct={activeQualitySet.executionQualityPct}
          repQualities={activeQualitySet.repQualities}
          onApply={(pct, repQualities) =>
            onUpdateSet(index, qualitySetIdx, {
              executionQualityPct: pct,
              repQualities,
            })
          }
        />
      )}

      {usesWeight && onChangeWeightStep && (
        <Sheet
          open={stepSheetOpen}
          onClose={() => setStepSheetOpen(false)}
          title="Weight Step"
        >
          <div className="space-y-3">
            <div>
              <p className="font-bold text-[var(--ink)]">
                {exercise.exerciseName}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {isCustomExercise && weightStepSource === 'exercise'
                  ? 'Custom exercise step'
                  : STEP_SOURCE_LABEL[weightStepSource]}
                : <strong>±{effectiveWeightStep} {unit}</strong>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {weightStepOptions.map((option) => {
                const selected = effectiveWeightStep === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={savingStep}
                    onClick={() =>
                      void handleSelectWeightStep(displayStepToKg(option, unit))
                    }
                    className={`min-h-[44px] min-w-[72px] rounded-xl border-[2.5px] border-[var(--line)] px-3 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${
                      selected
                        ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                        : 'bg-[var(--card)] text-[var(--ink)]'
                    }`}
                  >
                    ±{option} {unit}
                  </button>
                );
              })}
            </div>

            {canResetStep && (
              <Button
                variant="alt"
                loading={savingStep}
                onClick={() => void handleSelectWeightStep(null)}
                className="w-full"
              >
                Reset to default
              </Button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
