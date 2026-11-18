'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  RotateCcw,
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

type NumericFieldKey = 'weightDisplay' | 'reps' | 'timeSeconds' | 'distanceM';

const SET_NOTE_TAGS = [
  'Paused',
  'Drop set',
  'Beltless',
  'Myo-rep',
  'Tight/Pain',
  'Form breakdown',
  'PR',
] as const;

function hasNoteTag(notes: string, tag: string): boolean {
  const lowerTag = tag.toLowerCase();
  return notes
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes(lowerTag);
}

function toggleNoteTag(notes: string, tag: string): string {
  const parts = notes
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const lowerTag = tag.toLowerCase();
  const idx = parts.findIndex((p) => p.toLowerCase() === lowerTag);
  if (idx >= 0) {
    parts.splice(idx, 1);
    return parts.join(', ').slice(0, 500);
  }
  return [...parts, tag].join(', ').slice(0, 500);
}

function getRirBadgeTint(rir: number | null): string {
  if (rir === null) return '';
  if (rir === 0) return '!bg-[var(--red-bg)]';
  if (rir <= 2) return '!bg-[var(--gold-bg)]';
  return '!bg-[var(--green-bg)]';
}

function getFieldFallbackValue(
  setIdx: number,
  field: NumericFieldKey,
  sets: LoggerSet[],
  prefill: ExercisePrefill | null | undefined,
  unit: WeightUnit,
): number {
  const target = sets[setIdx];
  if (!target) return 0;

  for (let j = setIdx - 1; j >= 0; j -= 1) {
    const candidate = sets[j];
    if (!candidate || candidate.isWarmup !== target.isWarmup) continue;
    const raw = candidate[field] ?? '';
    const parsed =
      field === 'reps' || field === 'timeSeconds'
        ? parseOptionalInt(raw)
        : parseOptionalNum(raw);
    if (parsed !== null) {
      return parsed;
    }
  }

  const kindIdx =
    sets
      .slice(0, setIdx + 1)
      .filter((s) => s.isWarmup === target.isWarmup).length - 1;

  const prefillList = target.isWarmup ? prefill?.warmupSets : prefill?.sets;
  const prefillSet =
    prefillList?.[kindIdx] ??
    (prefillList && prefillList.length > 0
      ? prefillList[prefillList.length - 1]
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
  const [openSetNotes, setOpenSetNotes] = useState<Record<string, boolean>>({});
  const [openTagSetId, setOpenTagSetId] = useState<string | null>(null);
  const [qualitySetIdx, setQualitySetIdx] = useState<number | null>(null);
  const [stepSheetOpen, setStepSheetOpen] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!openTagSetId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(`[data-tags-menu="${openTagSetId}"]`)
      ) {
        return;
      }
      setOpenTagSetId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenTagSetId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openTagSetId]);

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

  const canShowRirToggle =
    usesReps || exercise.sets.some((s) => s.rir !== null);
  const showRirRow = rirOpen && canShowRirToggle;

  const fieldCount =
    (usesWeight ? 1 : 0) +
    (usesReps ? 1 : 0) +
    (usesTime ? 1 : 0) +
    (usesDist ? 1 : 0);

  const completedWorkingCount = workingEntries.filter(
    ({ setRow }) => setRow.isCompleted,
  ).length;
  const allDone =
    workingEntries.length > 0 && completedWorkingCount === workingEntries.length;

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

  const renderSetRow = (
    { setRow, origIdx }: { setRow: LoggerSet; origIdx: number },
    kindIdx: number,
  ) => {
    const isWarmup = setRow.isWarmup;
    const setBadgeLabel = isWarmup ? `W${kindIdx + 1}` : `Set ${kindIdx + 1}`;
    const setAriaPrefix = isWarmup
      ? `Warmup ${kindIdx + 1}`
      : `Set ${kindIdx + 1}`;
    const hasQualityData =
      setRow.executionQualityPct !== null || setRow.repQualities.length > 0;
    const showQualityControl = enableSetQuality || isEditing || hasQualityData;
    const rowColor = getQualityRowColor(
      setRow.isCompleted,
      enableSetQuality || hasQualityData,
      setRow.executionQualityPct,
    );
    const qualityValue = setRow.executionQualityPct ?? 100;
    const canDeleteSet = isWarmup ? true : workingEntries.length > 1;
    const hasNote = setRow.notes.trim().length > 0;
    const isNoteBoxOpen = hasNote || Boolean(openSetNotes[setRow.localId]);
    const isTagsOpen = openTagSetId === setRow.localId;
    const showSetRirRow =
      showRirRow && (!isWarmup || setRow.rir !== null || rirManuallyOpened);
    const matchingPrefill = isWarmup
      ? prefill?.warmupSets?.[kindIdx] ?? null
      : prefill?.sets?.[kindIdx] ?? null;

    return (
      <div
        key={setRow.localId}
        onPointerDown={(e) => startLongPress(origIdx, e)}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        className={`rounded-[10px] border-[2.5px] border-[var(--line)] p-2.5 shadow-[2px_2px_0_var(--shadow-color)] transition-colors ${rowColor} ${
          isWarmup ? 'border-dashed' : ''
        }`}
      >
        {/* Top line: Set # + Note + Quality pill + Remove + Check */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span
            className={`pill px-2.5 py-0.5 font-marker text-xs ${
              isWarmup ? 'bg-[var(--paper)] text-[var(--muted)]' : 'bg-[var(--card)]'
            }`}
          >
            {setBadgeLabel}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (hasNote) return;
                setOpenSetNotes((prev) => ({
                  ...prev,
                  [setRow.localId]: !prev[setRow.localId],
                }));
              }}
              aria-label={`${setAriaPrefix} note`}
              aria-expanded={isNoteBoxOpen}
              className={`btn alt icon !h-[44px] !w-[44px] ${
                hasNote ? '!bg-[var(--gold-bg)]' : ''
              }`}
            >
              <StickyNote className="h-4 w-4" />
            </button>

            {showQualityControl && (
              <button
                type="button"
                onClick={() => setQualitySetIdx(origIdx)}
                aria-label={`${setAriaPrefix} quality`}
                className={`min-h-[44px] min-w-[54px] rounded-[8px] border-[2.5px] border-[var(--line)] px-2.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${getQualityBadgeColor(
                  setRow.executionQualityPct,
                )}`}
              >
                {qualityValue}%
              </button>
            )}

            {canDeleteSet && (
              <button
                type="button"
                onClick={() => onRemoveSet(index, origIdx)}
                aria-label={`Delete ${setAriaPrefix.toLowerCase()}`}
                className="btn alt icon !h-[44px] !w-[44px]"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                handleToggleSetWithAutoCollapse(
                  origIdx,
                  isWarmup,
                  setRow.isCompleted,
                )
              }
              aria-label={
                setRow.isCompleted
                  ? `Uncheck ${setAriaPrefix.toLowerCase()}`
                  : `Complete ${setAriaPrefix.toLowerCase()}`
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
                  onUpdateSet(index, origIdx, { weightDisplay: next })
                }
                step={effectiveWeightStep}
                min={0}
                inputMode="decimal"
                placeholder="0"
                fallbackValue={getFieldFallbackValue(
                  origIdx,
                  'weightDisplay',
                  exercise.sets,
                  prefill,
                  unit,
                )}
                ariaLabel={`${setAriaPrefix} weight (${unit})`}
                decrementLabel={`Decrease ${setAriaPrefix.toLowerCase()} weight by ${effectiveWeightStep} ${unit}`}
                incrementLabel={`Increase ${setAriaPrefix.toLowerCase()} weight by ${effectiveWeightStep} ${unit}`}
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
                onChange={(next) => onUpdateSet(index, origIdx, { reps: next })}
                step={DEFAULT_REPS_STEP}
                min={0}
                inputMode="numeric"
                placeholder="0"
                fallbackValue={getFieldFallbackValue(
                  origIdx,
                  'reps',
                  exercise.sets,
                  prefill,
                  unit,
                )}
                ariaLabel={`${setAriaPrefix} reps`}
                decrementLabel={`Decrease ${setAriaPrefix.toLowerCase()} reps`}
                incrementLabel={`Increase ${setAriaPrefix.toLowerCase()} reps`}
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
                  onUpdateSet(index, origIdx, { distanceM: next })
                }
                step={DEFAULT_DISTANCE_STEP_M}
                min={0}
                inputMode="decimal"
                placeholder="0"
                fallbackValue={getFieldFallbackValue(
                  origIdx,
                  'distanceM',
                  exercise.sets,
                  prefill,
                  unit,
                )}
                ariaLabel={`${setAriaPrefix} distance meters`}
                decrementLabel={`Decrease ${setAriaPrefix.toLowerCase()} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
                incrementLabel={`Increase ${setAriaPrefix.toLowerCase()} distance by ${DEFAULT_DISTANCE_STEP_M}m`}
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
                  onUpdateSet(index, origIdx, { timeSeconds: next })
                }
                step={DEFAULT_TIME_STEP_SECONDS}
                min={0}
                inputMode="numeric"
                placeholder="0"
                fallbackValue={getFieldFallbackValue(
                  origIdx,
                  'timeSeconds',
                  exercise.sets,
                  prefill,
                  unit,
                )}
                ariaLabel={`${setAriaPrefix} seconds`}
                decrementLabel={`Decrease ${setAriaPrefix.toLowerCase()} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
                incrementLabel={`Increase ${setAriaPrefix.toLowerCase()} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
              />
            </div>
          )}
        </div>

        {/* RIR Counter */}
        {showSetRirRow && (
          <div
            className={`mt-2 space-y-1.5 rounded-[8px] border border-[var(--line)]/30 p-2 ${
              setRow.rir === null
                ? 'bg-[var(--paper)]/50'
                : setRow.rir === 0
                  ? 'bg-[var(--red-bg)]/60'
                  : setRow.rir <= 2
                    ? 'bg-[var(--gold-bg)]/65'
                    : 'bg-[var(--green-bg)]/65'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-xs font-bold uppercase text-[var(--muted)]">
                RIR
              </span>
              {matchingPrefill?.rir !== null &&
                matchingPrefill?.rir !== undefined && (
                  <span className="text-xs font-bold text-[var(--muted)]">
                    Last: RIR {matchingPrefill.rir}
                  </span>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[0, 1, 2, 3, 4].map((val) => {
                const active = setRow.rir === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() =>
                      onUpdateSet(index, origIdx, {
                        rir: active ? null : val,
                      })
                    }
                    aria-pressed={active}
                    aria-label={`${setAriaPrefix} RIR ${val}`}
                    className={`btn alt !min-h-[44px] !min-w-[44px] !px-2.5 text-sm ${
                      active
                        ? `${getRirBadgeTint(val)} ring-2 ring-[var(--line)]`
                        : ''
                    }`}
                  >
                    {val}
                  </button>
                );
              })}

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  disabled={setRow.rir === null || setRow.rir <= 0}
                  onClick={() => {
                    const cur = setRow.rir ?? 0;
                    const next = Math.max(0, Math.round((cur - 0.5) * 2) / 2);
                    onUpdateSet(index, origIdx, { rir: next });
                  }}
                  aria-label={`Decrease ${setAriaPrefix} RIR by 0.5`}
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={setRow.rir === null}
                  onClick={() => onUpdateSet(index, origIdx, { rir: null })}
                  aria-label={
                    setRow.rir !== null
                      ? `Clear ${setAriaPrefix} RIR (${setRow.rir})`
                      : `${setAriaPrefix} RIR unset`
                  }
                  className={`btn alt !min-h-[44px] !min-w-[54px] !px-2 text-sm ${
                    setRow.rir === null
                      ? 'opacity-65'
                      : `${getRirBadgeTint(setRow.rir)} ring-2 ring-[var(--line)]`
                  }`}
                >
                  {setRow.rir !== null ? (
                    <span className="inline-flex items-center gap-1">
                      <span>{setRow.rir}</span>
                      <X className="h-3 w-3 opacity-60" aria-hidden="true" />
                    </span>
                  ) : (
                    '—'
                  )}
                </button>
                <button
                  type="button"
                  disabled={setRow.rir !== null && setRow.rir >= 10}
                  onClick={() => {
                    const next =
                      setRow.rir === null
                        ? 0
                        : Math.min(10, Math.round((setRow.rir + 0.5) * 2) / 2);
                    onUpdateSet(index, origIdx, { rir: next });
                  }}
                  aria-label={`Increase ${setAriaPrefix} RIR by 0.5`}
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Per-Set Note Box */}
        {isNoteBoxOpen && (
          <div className="mt-2 space-y-1.5 rounded-[8px] border border-[var(--line)]/30 bg-[var(--paper)]/70 p-2">
            {enableSetNoteHint && matchingPrefill?.notes?.trim() && (
              <p className="text-xs font-bold text-[var(--muted)]">
                Last: &ldquo;{matchingPrefill.notes.trim()}&rdquo;
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={setRow.notes}
                maxLength={500}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  if (nextVal.trim().length === 0) {
                    setOpenSetNotes((prev) => ({
                      ...prev,
                      [setRow.localId]: true,
                    }));
                  }
                  onUpdateSet(index, origIdx, { notes: nextVal });
                }}
                placeholder="Set note..."
                aria-label={`${setAriaPrefix} note text`}
                className="min-h-[44px] min-w-[160px] flex-1 rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-base font-bold outline-none"
              />
              {enableSetNoteTags && (
                <div className="relative" data-tags-menu={setRow.localId}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenTagSetId((prev) =>
                        prev === setRow.localId ? null : setRow.localId,
                      )
                    }
                    aria-haspopup="menu"
                    aria-expanded={isTagsOpen}
                    className={`btn alt !min-h-[44px] !px-2.5 text-xs ${
                      isTagsOpen ? '!bg-[var(--gold-bg)]' : ''
                    }`}
                  >
                    <span>Tags</span>
                    {isTagsOpen ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isTagsOpen && (
                    <div
                      role="menu"
                      aria-label={`${setAriaPrefix} note tags`}
                      className="absolute right-0 top-full z-30 mt-1 w-52 rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--card)] p-1.5 shadow-[4px_4px_0_var(--shadow-color)]"
                    >
                      <div className="space-y-1">
                        {SET_NOTE_TAGS.map((tag) => {
                          const active = hasNoteTag(setRow.notes, tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={active}
                              onClick={() => {
                                const nextNotes = toggleNoteTag(
                                  setRow.notes,
                                  tag,
                                );
                                if (nextNotes.trim().length === 0) {
                                  setOpenSetNotes((prev) => ({
                                    ...prev,
                                    [setRow.localId]: true,
                                  }));
                                }
                                onUpdateSet(index, origIdx, {
                                  notes: nextNotes,
                                });
                              }}
                              className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[6px] px-2.5 text-left text-sm font-bold transition-colors ${
                                active
                                  ? 'bg-[var(--gold-bg)] text-[var(--ink)]'
                                  : 'text-[var(--ink)] hover:bg-[var(--paper)]'
                              }`}
                            >
                              <span>{tag}</span>
                              {active && (
                                <Check className="h-4 w-4 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!hasNote && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenSetNotes((prev) => ({
                      ...prev,
                      [setRow.localId]: false,
                    }));
                    setOpenTagSetId((prev) =>
                      prev === setRow.localId ? null : prev,
                    );
                  }}
                  aria-label={`Close empty ${setAriaPrefix.toLowerCase()} note`}
                  className="btn alt icon !h-[44px] !w-[44px]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {isEditing && !isWarmup && (
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
                  onUpdateSet(index, origIdx, {
                    restSecondsDisplay: raw,
                    restSeconds: parseRestInput(raw),
                  });
                }}
                placeholder="—"
                aria-label={`${setAriaPrefix} planned rest seconds`}
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
                  onUpdateSet(index, origIdx, {
                    actualRestDisplay: raw,
                    actualRestSeconds: parseRestInput(raw),
                    restApproximate: false,
                  });
                }}
                placeholder="—"
                aria-label={`${setAriaPrefix} actual rest seconds`}
                className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--card)] px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
              />
            </label>
          </div>
        )}
      </div>
    );
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
            {warmupEntries.map((entry, wIdx) => renderSetRow(entry, wIdx))}
          </div>
        </div>
      )}

      {/* Stacked Mobile Working Set Rows */}
      <div className="space-y-2.5">
        {workingEntries.map((entry, workIdx) => renderSetRow(entry, workIdx))}
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
