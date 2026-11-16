'use client';

import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCheck,
  Plus,
  StickyNote,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import type { ExercisePrefill, WeightUnit } from '@/types/domain';
import {
  DEFAULT_WEIGHT_STEP_KG,
  DEFAULT_WEIGHT_STEP_LB,
  type WeightStepSource,
} from '@/lib/workouts/stepSize';
import LoggerSetRow from './LoggerSetRow';
import SetQualityPopover from './SetQualityPopover';
import WeightStepSheet from './WeightStepSheet';
import {
  parseOptionalInt,
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

  const effectiveWeightStep =
    weightStepDisplay ??
    (unit === 'lb' ? DEFAULT_WEIGHT_STEP_LB : DEFAULT_WEIGHT_STEP_KG);
  const canResetStep = isCustomExercise
    ? hasCustomExerciseStep
    : hasUserStepOverride;

  const usesWeight = trackingUsesWeight(exercise.trackingType);

  const completedCount = exercise.sets.filter((s) => s.isCompleted).length;
  const allDone =
    exercise.sets.length > 0 && completedCount === exercise.sets.length;

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
        {exercise.sets.map((setRow, setIdx) => (
          <LoggerSetRow
            key={setRow.localId}
            exIndex={index}
            setIndex={setIdx}
            totalSets={exercise.sets.length}
            setRow={setRow}
            sets={exercise.sets}
            trackingType={exercise.trackingType}
            unit={unit}
            enableSetQuality={enableSetQuality}
            isEditing={isEditing}
            effectiveWeightStep={effectiveWeightStep}
            prefill={prefill}
            onUpdateSet={onUpdateSet}
            onToggleSetComplete={onToggleSetComplete}
            onRemoveSet={onRemoveSet}
            onOpenQuality={(idx) => setQualitySetIdx(idx)}
          />
        ))}
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
        <WeightStepSheet
          open={stepSheetOpen}
          onClose={() => setStepSheetOpen(false)}
          exerciseId={exercise.exerciseId}
          exerciseName={exercise.exerciseName}
          unit={unit}
          effectiveWeightStep={effectiveWeightStep}
          weightStepSource={weightStepSource}
          isCustomExercise={isCustomExercise}
          canResetStep={canResetStep}
          onChangeWeightStep={onChangeWeightStep}
        />
      )}
    </div>
  );
}
