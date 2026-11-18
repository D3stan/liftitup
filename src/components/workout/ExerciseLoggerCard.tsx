'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
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
  trackingUsesReps,
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
  alwaysShowRir: boolean;
  enableSetNoteTags: boolean;
  enableSetNoteHint: boolean;
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
  onAddWarmupSet?: (exIndex: number) => void;
  onRepeatLastWarmups?: (exIndex: number) => void;
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
  alwaysShowRir,
  enableSetNoteTags,
  enableSetNoteHint,
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
  onAddWarmupSet,
  onRepeatLastWarmups,
  onRemoveSet,
  onCheckAll,
  onStartRestTimer,
}: ExerciseLoggerCardProps) {
  const [noteOpen, setNoteOpen] = useState(exercise.notes.trim().length > 0);
  const [rirOpen, setRirOpen] = useState(
    () => alwaysShowRir || exercise.sets.some((s) => s.rir !== null),
  );
  const [rirManuallyOpened, setRirManuallyOpened] = useState(false);
  const [qualitySetIdx, setQualitySetIdx] = useState<number | null>(null);
  const [stepSheetOpen, setStepSheetOpen] = useState(false);

  const warmupEntries = exercise.sets
    .map((setRow, origIdx) => ({ setRow, origIdx }))
    .filter(({ setRow }) => setRow.isWarmup);
  const workingEntries = exercise.sets
    .map((setRow, origIdx) => ({ setRow, origIdx }))
    .filter(({ setRow }) => !setRow.isWarmup);

  const completedWarmupCount = warmupEntries.filter(
    ({ setRow }) => setRow.isCompleted,
  ).length;
  const allWarmupsDone =
    warmupEntries.length > 0 && completedWarmupCount === warmupEntries.length;
  const [warmupExpanded, setWarmupExpanded] = useState(() => !allWarmupsDone);

  const prevExerciseIdRef = useRef(exercise.exerciseId);
  useEffect(() => {
    if (prevExerciseIdRef.current !== exercise.exerciseId) {
      prevExerciseIdRef.current = exercise.exerciseId;
      setWarmupExpanded(!allWarmupsDone);
    }
  }, [exercise.exerciseId, allWarmupsDone]);

  const effectiveWeightStep =
    weightStepDisplay ??
    (unit === 'lb' ? DEFAULT_WEIGHT_STEP_LB : DEFAULT_WEIGHT_STEP_KG);
  const canResetStep = isCustomExercise
    ? hasCustomExerciseStep
    : hasUserStepOverride;

  const usesWeight = trackingUsesWeight(exercise.trackingType);
  const usesReps = trackingUsesReps(exercise.trackingType);

  const canShowRirToggle =
    usesReps || exercise.sets.some((s) => s.rir !== null);
  const showRirRow = rirOpen && canShowRirToggle;

  const completedWorkingCount = workingEntries.filter(
    ({ setRow }) => setRow.isCompleted,
  ).length;
  const allDone =
    workingEntries.length > 0 && completedWorkingCount === workingEntries.length;

  const activeQualitySet =
    qualitySetIdx !== null ? exercise.sets[qualitySetIdx] ?? null : null;
  const activeQualityIsWarmup = Boolean(activeQualitySet?.isWarmup);
  const activeQualityNumber =
    qualitySetIdx !== null
      ? exercise.sets
          .slice(0, qualitySetIdx + 1)
          .filter((s) => s.isWarmup === activeQualityIsWarmup).length
      : 1;
  const activeQualityLabel = activeQualityIsWarmup
    ? `Warmup #${activeQualityNumber}`
    : `Set #${activeQualityNumber}`;

  const handleToggleSetWithAutoCollapse = (
    origIdx: number,
    isWarmup: boolean,
    currentlyCompleted: boolean,
  ) => {
    if (
      isWarmup &&
      !currentlyCompleted &&
      warmupEntries.filter(({ setRow }) => !setRow.isCompleted).length === 1
    ) {
      setWarmupExpanded(false);
    }
    onToggleSetComplete(index, origIdx);
  };

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
          {canShowRirToggle && (
            <button
              type="button"
              onClick={() => {
                const next = !rirOpen;
                setRirOpen(next);
                setRirManuallyOpened(next);
              }}
              aria-pressed={rirOpen}
              className={`btn alt !min-h-[44px] !px-3 text-sm ${
                rirOpen ? '!bg-[var(--gold-bg)]' : ''
              }`}
            >
              <span>RIR</span>
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

      {/* Warmup Sets Drawer & Quick Actions */}
      {warmupEntries.length === 0 ? (
        (onAddWarmupSet || onRepeatLastWarmups) && (
          <div className="flex flex-wrap items-center gap-2">
            {onAddWarmupSet && (
              <button
                type="button"
                onClick={() => {
                  onAddWarmupSet(index);
                  setWarmupExpanded(true);
                }}
                className="btn alt !min-h-[44px] border-dashed !px-3 text-sm"
              >
                <Plus className="h-4 w-4" />
                <span>Warmup</span>
              </button>
            )}
            {onRepeatLastWarmups && (prefill?.warmupSets?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  onRepeatLastWarmups(index);
                  setWarmupExpanded(true);
                }}
                className="btn alt !min-h-[44px] !px-3 text-sm"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Repeat last warmups ({prefill!.warmupSets!.length})</span>
              </button>
            )}
          </div>
        )
      ) : !warmupExpanded ? (
        <button
          type="button"
          onClick={() => setWarmupExpanded(true)}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[10px] border-2 border-dashed border-[var(--line)]/60 bg-[var(--paper)]/70 px-3 py-2 text-sm font-bold text-[var(--ink)]"
        >
          <span>
            Warmup · {completedWarmupCount}/{warmupEntries.length}
            {allWarmupsDone ? ' ✓' : ''}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
        </button>
      ) : (
        <div className="space-y-2.5 rounded-[10px] border-2 border-dashed border-[var(--line)]/60 bg-[var(--paper)]/60 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setWarmupExpanded(false)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-[8px] px-2 text-sm font-bold text-[var(--muted)]"
            >
              <ChevronUp className="h-4 w-4" />
              <span>
                Warmup · {completedWarmupCount}/{warmupEntries.length}
                {allWarmupsDone ? ' ✓' : ''}
              </span>
            </button>
            {onAddWarmupSet && (
              <button
                type="button"
                onClick={() => onAddWarmupSet(index)}
                className="btn alt !min-h-[44px] !px-3 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Warmup</span>
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {warmupEntries.map(({ setRow, origIdx }, wIdx) => (
              <LoggerSetRow
                key={setRow.localId}
                exIndex={index}
                setIndex={origIdx}
                kindIndex={wIdx}
                totalSets={workingEntries.length}
                canDelete={true}
                setRow={setRow}
                sets={exercise.sets}
                trackingType={exercise.trackingType}
                unit={unit}
                enableSetQuality={enableSetQuality}
                showRir={
                  showRirRow && (setRow.rir !== null || rirManuallyOpened)
                }
                enableSetNoteTags={enableSetNoteTags}
                enableSetNoteHint={enableSetNoteHint}
                isEditing={isEditing}
                effectiveWeightStep={effectiveWeightStep}
                prefill={prefill}
                onUpdateSet={onUpdateSet}
                onToggleSetComplete={(exIdx, setIdx) =>
                  handleToggleSetWithAutoCollapse(
                    setIdx,
                    true,
                    setRow.isCompleted,
                  )
                }
                onRemoveSet={onRemoveSet}
                onOpenQuality={(idx) => setQualitySetIdx(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stacked Mobile Working Set Rows */}
      <div className="space-y-2.5">
        {workingEntries.map(({ setRow, origIdx }, workIdx) => (
          <LoggerSetRow
            key={setRow.localId}
            exIndex={index}
            setIndex={origIdx}
            kindIndex={workIdx}
            totalSets={workingEntries.length}
            canDelete={workingEntries.length > 1}
            setRow={setRow}
            sets={exercise.sets}
            trackingType={exercise.trackingType}
            unit={unit}
            enableSetQuality={enableSetQuality}
            showRir={showRirRow}
            enableSetNoteTags={enableSetNoteTags}
            enableSetNoteHint={enableSetNoteHint}
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
          setNumber={activeQualityNumber}
          setLabel={activeQualityLabel}
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
