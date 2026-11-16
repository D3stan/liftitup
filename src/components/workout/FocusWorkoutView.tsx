'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  ListOrdered,
  Play,
  Plus,
  Sparkles,
  StickyNote,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Exercise,
  ExercisePrefill,
  RestClockMode,
  WeightUnit,
} from '@/types/domain';
import type { ExerciseStepMeta } from '@/lib/exercises/repository';
import { Button, Sheet } from '@/components/ui';
import {
  computeSessionElapsedSeconds,
  formatClockSeconds,
} from '@/lib/workouts/clock';
import {
  clampFocusIndex,
  computeFocusSummaryStats,
  evaluateFocusSwipe,
  formatExercisePeekTarget,
} from '@/lib/workouts/focus';
import {
  formatRestSeconds,
  getLastTimeRestForCompletedSet,
  type LastTimeRestMatch,
} from '@/lib/workouts/rest';
import {
  DEFAULT_WEIGHT_STEP_KG,
  DEFAULT_WEIGHT_STEP_LB,
  resolveDisplayWeightStep,
} from '@/lib/workouts/stepSize';
import LoggerSetRow from './LoggerSetRow';
import SetQualityPopover from './SetQualityPopover';
import WeightStepSheet from './WeightStepSheet';
import {
  getTrackingShortLabel,
  parseOptionalInt,
  trackingUsesWeight,
  type LoggerSet,
  type WorkoutDraft,
} from './trackingFormat';
import { useRestClockState } from './useRestClockState';

export interface FocusWorkoutViewProps {
  draft: WorkoutDraft;
  date: string;
  isEditing: boolean;
  saving: boolean;
  deleting: boolean;
  unit: WeightUnit;
  enableSetQuality: boolean;
  preferredRestMode: RestClockMode;
  defaultWeightStepKg: number | null;
  sessionNowMs: number;
  completedSetsTotal: number;
  canOfferInstead: boolean;
  plannedDayLabel: string | null;
  plannedTargetByScheduleDayExerciseId: Record<string, string>;
  prefillsByExerciseId: Record<string, ExercisePrefill>;
  exerciseMetaById: Map<string, Exercise>;
  exerciseStepsById?: Record<string, ExerciseStepMeta>;
  lastTimeRest: LastTimeRestMatch | null;
  timerPickerOpen: boolean;
  onCloseTimerPicker: () => void;
  noteOpen: boolean;
  onToggleNoteOpen: (open: boolean) => void;
  startTimeInput: string;
  onChangeFocusIndex: (nextIndex: number) => void;
  onReorderExercise: (fromIndex: number, toIndex: number) => void;
  onStartSession: () => void;
  onUpdateTitle: (title: string) => void;
  onUpdateWorkoutNotes: (notes: string) => void;
  onUpdateJollyMode: (mode: 'extra' | 'instead') => void;
  onUpdateSessionDate: (date: string) => void;
  onUpdateStartedAt: (hhmm: string) => void;
  onUpdateDurationMinutes: (val: string) => void;
  onDeleteExercise: (index: number) => void;
  onOpenSwap: (index: number) => void;
  onOpenPicker: () => void;
  onChangeExNotes: (index: number, notes: string) => void;
  onUpdateSet: (
    exIndex: number,
    setIndex: number,
    patch: Partial<LoggerSet>,
  ) => void;
  onToggleSetComplete: (exIndex: number, setIndex: number) => void;
  onAddSet: (exIndex: number) => void;
  onRemoveSet: (exIndex: number, setIndex: number) => void;
  onCheckAll: (exIndex: number) => void;
  onChangeWeightStep: (
    exerciseId: string,
    weightStepKg: number | null,
  ) => Promise<void>;
  onStartRestTimer: (seconds: number, label?: string) => void;
  onAdjustRestTarget: (deltaSeconds: number) => void;
  onStopRestForNextSet: () => void;
  onDismissRestClock: () => void;
  onRestAlertFired: (startedAt: string) => void;
  onSave: () => void;
  onRequestDeleteSession: () => void;
}

const AUTO_ADVANCE_DELAY_MS = 2000;

export default function FocusWorkoutView({
  draft,
  date,
  isEditing,
  saving,
  deleting,
  unit,
  enableSetQuality,
  preferredRestMode,
  defaultWeightStepKg,
  sessionNowMs,
  completedSetsTotal,
  canOfferInstead,
  plannedDayLabel,
  plannedTargetByScheduleDayExerciseId,
  prefillsByExerciseId,
  exerciseMetaById,
  exerciseStepsById,
  lastTimeRest,
  timerPickerOpen,
  onCloseTimerPicker,
  noteOpen,
  onToggleNoteOpen,
  startTimeInput,
  onChangeFocusIndex,
  onReorderExercise,
  onStartSession,
  onUpdateTitle,
  onUpdateWorkoutNotes,
  onUpdateJollyMode,
  onUpdateSessionDate,
  onUpdateStartedAt,
  onUpdateDurationMinutes,
  onDeleteExercise,
  onOpenSwap,
  onOpenPicker,
  onChangeExNotes,
  onUpdateSet,
  onToggleSetComplete,
  onAddSet,
  onRemoveSet,
  onCheckAll,
  onChangeWeightStep,
  onStartRestTimer,
  onAdjustRestTarget,
  onStopRestForNextSet,
  onDismissRestClock,
  onRestAlertFired,
  onSave,
  onRequestDeleteSession,
}: FocusWorkoutViewProps) {
  const exerciseCount = draft.exercises.length;
  const activeIndex = clampFocusIndex(
    draft.focusExerciseIndex ?? 0,
    exerciseCount,
  );
  const isSummaryStep = activeIndex >= exerciseCount;
  const activeExercise = !isSummaryStep
    ? draft.exercises[activeIndex] ?? null
    : null;
  const nextExercise =
    !isSummaryStep && activeIndex + 1 < exerciseCount
      ? draft.exercises[activeIndex + 1] ?? null
      : null;

  const [jumpSheetOpen, setJumpSheetOpen] = useState(false);
  const [stepSheetOpen, setStepSheetOpen] = useState(false);
  const [qualitySetIdx, setQualitySetIdx] = useState<number | null>(null);
  const [openNotesByExId, setOpenNotesByExId] = useState<
    Record<string, boolean>
  >({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [autoAdvanceBanner, setAutoAdvanceBanner] = useState<{
    fromLocalId: string;
    toIndex: number;
    label: string;
  } | null>(null);

  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const swipeStartRef = useRef<{
    startX: number;
    startY: number;
    viewportWidth: number;
    isInteractiveTarget: boolean;
  } | null>(null);

  const { state: restState, isClockActive } = useRestClockState({
    restClock: draft.restClock,
    onAlertFired: onRestAlertFired,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvanceBanner(null);
  }, []);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Cancel pending auto-advance if active exercise changes or disappears.
  const activeLocalId = activeExercise?.localId ?? null;
  useEffect(() => {
    setQualitySetIdx(null);
    setStepSheetOpen(false);
    if (autoAdvanceBanner && autoAdvanceBanner.fromLocalId !== activeLocalId) {
      cancelAutoAdvance();
    }
  }, [activeLocalId, autoAdvanceBanner, cancelAutoAdvance]);

  const goToIndex = useCallback(
    (nextIndex: number) => {
      cancelAutoAdvance();
      onChangeFocusIndex(clampFocusIndex(nextIndex, exerciseCount));
    },
    [cancelAutoAdvance, exerciseCount, onChangeFocusIndex],
  );

  const handleSetToggleWithAutoAdvance = useCallback(
    (exIdx: number, setIdx: number) => {
      const targetEx = draft.exercises[exIdx];
      const targetSet = targetEx?.sets[setIdx];
      if (!targetEx || !targetSet) return;

      const completingThisSet = !targetSet.isCompleted;
      const otherAllCompleted = targetEx.sets.every((s, idx) =>
        idx === setIdx ? true : s.isCompleted,
      );
      const shouldScheduleAdvance =
        completingThisSet &&
        otherAllCompleted &&
        exIdx === activeIndex &&
        activeIndex < exerciseCount;

      cancelAutoAdvance();
      onToggleSetComplete(exIdx, setIdx);

      if (shouldScheduleAdvance) {
        const nextIndex = activeIndex + 1;
        const nextLabel =
          nextIndex < exerciseCount
            ? draft.exercises[nextIndex]?.exerciseName ?? 'Next exercise'
            : 'Workout Summary';

        setAutoAdvanceBanner({
          fromLocalId: targetEx.localId,
          toIndex: nextIndex,
          label: nextLabel,
        });
        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          setAutoAdvanceBanner(null);
          onChangeFocusIndex(nextIndex);
        }, AUTO_ADVANCE_DELAY_MS);
      }
    },
    [
      activeIndex,
      cancelAutoAdvance,
      draft.exercises,
      exerciseCount,
      onChangeFocusIndex,
      onToggleSetComplete,
    ],
  );

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    const targetEl = e.target instanceof Element ? e.target : null;
    const isInteractiveTarget = Boolean(
      targetEl?.closest(
        'input, textarea, select, button, a, [role="button"], [role="slider"]',
      ),
    );
    swipeStartRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 375,
      isInteractiveTarget,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || e.changedTouches.length === 0) return;

    const touch = e.changedTouches[0];
    const dir = evaluateFocusSwipe({
      startX: start.startX,
      startY: start.startY,
      endX: touch.clientX,
      endY: touch.clientY,
      viewportWidth: start.viewportWidth,
      isInteractiveTarget: start.isInteractiveTarget,
    });

    if (dir === 'next' && activeIndex < exerciseCount) {
      goToIndex(activeIndex + 1);
    } else if (dir === 'prev' && activeIndex > 0) {
      goToIndex(activeIndex - 1);
    }
  };

  const summaryStats = useMemo(
    () =>
      computeFocusSummaryStats({
        exercises: draft.exercises,
        unit,
        startedAt: draft.startedAt,
        durationMinutesInput: draft.durationMinutes ?? null,
        isEditing,
        nowMs: sessionNowMs,
      }),
    [draft.durationMinutes, draft.exercises, draft.startedAt, isEditing, sessionNowMs, unit],
  );

  // Active exercise metadata
  const catalogEx = activeExercise
    ? exerciseMetaById.get(activeExercise.exerciseId)
    : undefined;
  const stepMeta = activeExercise
    ? exerciseStepsById?.[activeExercise.exerciseId]
    : undefined;
  const isCustomExercise = catalogEx?.isCustom ?? stepMeta?.isCustom ?? false;
  const exerciseDefaultKg =
    catalogEx?.weightStepKg ?? stepMeta?.weightStepKg ?? null;
  const userOverrideKg =
    catalogEx?.userWeightStepKg ?? stepMeta?.userWeightStepKg ?? null;
  const resolvedStep = activeExercise
    ? resolveDisplayWeightStep({
        userOverrideKg,
        exerciseDefaultKg,
        userGlobalDefaultKg: defaultWeightStepKg,
        unit,
      })
    : null;
  const effectiveWeightStep =
    resolvedStep?.displayStep ??
    (unit === 'lb' ? DEFAULT_WEIGHT_STEP_LB : DEFAULT_WEIGHT_STEP_KG);
  const canResetStep = isCustomExercise
    ? exerciseDefaultKg !== null
    : userOverrideKg !== null;

  const activePrefill = activeExercise
    ? prefillsByExerciseId[activeExercise.exerciseId] ?? null
    : null;

  const activeCompletedCount = activeExercise
    ? activeExercise.sets.filter((s) => s.isCompleted).length
    : 0;
  const activeTotalSets = activeExercise ? activeExercise.sets.length : 0;
  const activeRemainingCount = Math.max(
    0,
    activeTotalSets - activeCompletedCount,
  );
  const activeAllDone =
    activeTotalSets > 0 && activeCompletedCount === activeTotalSets;
  const nextIncompleteIdx = activeExercise
    ? activeExercise.sets.findIndex((s) => !s.isCompleted)
    : -1;

  const activeNoteOpen = activeExercise
    ? Boolean(
        openNotesByExId[activeExercise.localId] ||
          activeExercise.notes.trim().length > 0,
      )
    : false;

  const plannedTargetText =
    activeExercise?.scheduleDayExerciseId
      ? plannedTargetByScheduleDayExerciseId[
          activeExercise.scheduleDayExerciseId
        ] ?? null
      : null;

  const fallbackLastRest =
    !isClockActive && activeExercise && activeCompletedCount > 0
      ? getLastTimeRestForCompletedSet(
          activePrefill,
          Math.max(0, activeCompletedCount - 1),
        )
      : null;
  const inlineLastTimeRest = lastTimeRest ?? fallbackLastRest;

  const activeQualitySet =
    activeExercise && qualitySetIdx !== null
      ? activeExercise.sets[qualitySetIdx] ?? null
      : null;

  const isStopwatch = restState.mode === 'stopwatch';
  const restPrimaryReadout = isStopwatch
    ? formatClockSeconds(restState.elapsedSeconds)
    : restState.targetReached
      ? 'GO!'
      : formatClockSeconds(Math.ceil(restState.remainingSeconds));

  return (
    <div className="space-y-3">
      {/* Top Focus Progress & Session Clock Strip */}
      <section
        aria-label="Focus progress"
        className="card-sm flex flex-wrap items-center justify-between gap-2"
      >
        <button
          type="button"
          onClick={() => {
            cancelAutoAdvance();
            setJumpSheetOpen(true);
          }}
          className="btn alt !min-h-[44px] min-w-0 flex-1 justify-between !px-3 text-left text-sm"
          aria-label="Open exercise jump and reorder list"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ListOrdered className="h-4 w-4 shrink-0" />
            <span className="truncate font-marker text-base">
              {exerciseCount === 0
                ? 'No exercises'
                : isSummaryStep
                  ? `Summary (${exerciseCount} exercises)`
                  : `Exercise ${activeIndex + 1} of ${exerciseCount}`}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </button>

        {!isEditing && (
          <div className="flex items-center gap-1.5">
            {draft.startedAt ? (
              <span
                aria-label="Session elapsed time"
                className="pill green inline-flex min-h-[44px] items-center gap-1.5 px-3 font-marker text-sm tracking-wider"
              >
                <Clock className="h-3.5 w-3.5 shrink-0" />
                {formatClockSeconds(
                  computeSessionElapsedSeconds(draft.startedAt, sessionNowMs),
                )}
              </span>
            ) : (
              <button
                type="button"
                onClick={onStartSession}
                className="btn green !min-h-[44px] !px-3 text-sm"
              >
                <Play className="h-3.5 w-3.5 shrink-0" />
                <span>Start</span>
              </button>
            )}
          </div>
        )}

        {!isSummaryStep && (
          <button
            type="button"
            onClick={() => goToIndex(exerciseCount)}
            className="btn alt !min-h-[44px] !px-3 text-sm"
          >
            Summary
          </button>
        )}
      </section>

      {/* Inline Phase 2 Rest Clock / Preset Picker (FloatingRestTimer is hidden in Focus mode) */}
      {(isClockActive || timerPickerOpen) && (
        <section
          aria-label="Inline rest clock"
          className={`card-sm border-[3px] border-[var(--line)] ${
            prefersReducedMotion ? '' : 'transition-colors duration-150'
          } ${
            isClockActive && restState.targetReached
              ? 'bg-[var(--green-bg)]'
              : 'bg-[var(--card)]'
          }`}
        >
          {!isClockActive && timerPickerOpen ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {preferredRestMode === 'stopwatch' ? (
                    <Clock className="h-5 w-5 shrink-0 text-[var(--red)]" />
                  ) : (
                    <Timer className="h-5 w-5 shrink-0 text-[var(--red)]" />
                  )}
                  <span className="font-marker text-lg">
                    {preferredRestMode === 'stopwatch'
                      ? 'Rest Stopwatch'
                      : 'Rest Timer'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onCloseTimerPicker}
                  aria-label="Close rest timer"
                  className="btn icon alt !h-[44px] !w-[44px] shrink-0"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[60, 90, 120, 180].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() =>
                      onStartRestTimer(
                        sec,
                        activeExercise?.exerciseName ?? 'Rest',
                      )
                    }
                    className="btn !min-h-[44px] !px-2 text-base"
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[var(--line)] ${
                      restState.targetReached
                        ? `${prefersReducedMotion ? '' : 'animate-pulse '}bg-[var(--green)] text-[var(--btn-red-fg)]`
                        : 'bg-[var(--gold)] text-[var(--btn-gold-fg)]'
                    }`}
                  >
                    {restState.targetReached ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : isStopwatch ? (
                      <Clock className="h-5 w-5" />
                    ) : (
                      <Timer className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-marker text-2xl tracking-wider">
                        {restPrimaryReadout}
                      </span>
                      <span className="pill px-2 py-0.5 text-xs">
                        {isStopwatch
                          ? restState.targetReached
                            ? `Target ${formatClockSeconds(restState.targetSeconds)} ✓`
                            : `Target ${formatClockSeconds(restState.targetSeconds)}`
                          : restState.targetReached
                            ? 'Ready'
                            : `${restState.targetSeconds}s`}
                      </span>
                      {inlineLastTimeRest && (
                        <span className="pill px-2 py-0.5 text-xs">
                          last time:{' '}
                          {formatRestSeconds(
                            inlineLastTimeRest.actualRestSeconds,
                            inlineLastTimeRest.restApproximate,
                          )}
                        </span>
                      )}
                    </div>
                    {draft.restClock?.label && (
                      <p className="truncate text-xs font-bold text-[var(--muted)]">
                        {draft.restClock.label}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onDismissRestClock}
                  aria-label="Dismiss rest clock"
                  className="btn alt icon !h-[44px] !w-[44px] shrink-0"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAdjustRestTarget(-15)}
                  aria-label="Decrease target rest by 15 seconds"
                  className="btn alt !min-h-[44px] !min-w-[56px] !px-2.5 !py-1 text-sm"
                >
                  −15s
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustRestTarget(30)}
                  aria-label="Increase target rest by 30 seconds"
                  className="btn alt !min-h-[44px] !min-w-[56px] !px-2.5 !py-1 text-sm"
                >
                  +30s
                </button>
                <button
                  type="button"
                  onClick={onStopRestForNextSet}
                  aria-label="I'm starting my next set now"
                  className={`btn !min-h-[44px] flex-1 !px-3 !py-1 text-base ${
                    restState.targetReached ? 'green' : ''
                  }`}
                >
                  <Play className="h-4 w-4 shrink-0" />
                  <span>Next set</span>
                </button>
              </div>

              <div className="bar !h-2.5">
                <div
                  className={`bar-fill ${restState.targetReached ? 'green' : 'gold'}`}
                  style={{
                    width: `${restState.targetReached ? 100 : restState.progressPct}%`,
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Main Swipeable Area */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={
          prefersReducedMotion ? '' : 'transition-opacity duration-150'
        }
      >
        {!isSummaryStep && activeExercise ? (
          <div className="space-y-3">
            {/* Auto-advance cancellable banner */}
            {autoAdvanceBanner && (
              <div
                role="status"
                aria-live="polite"
                className="card-sm flex items-center justify-between gap-2 bg-[var(--green-bg)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--ink)]">
                    Sets done! Next: {autoAdvanceBanner.label} in 2s
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelAutoAdvance}
                  className="btn alt !min-h-[44px] shrink-0 !px-3 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Active Exercise Card */}
            <section
              aria-label={`Focus exercise ${activeExercise.exerciseName}`}
              className={`card space-y-3 ${
                activeAllDone
                  ? 'bg-[color-mix(in_srgb,var(--green-bg)_45%,var(--card))]'
                  : ''
              }`}
            >
              {/* Title + Target + Done/Remaining */}
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="pill !bg-[var(--ink)] px-2.5 py-0.5 font-marker text-xs !text-[var(--card)]">
                        #{activeIndex + 1}
                      </span>
                      <span className="pill px-2 py-0.5 text-xs">
                        {getTrackingShortLabel(activeExercise.trackingType)}
                      </span>
                      <span
                        className={`pill px-2 py-0.5 text-xs ${
                          activeAllDone ? 'green' : 'gold'
                        }`}
                      >
                        {activeCompletedCount} done · {activeRemainingCount}{' '}
                        left
                      </span>
                    </div>
                    <h2 className="font-marker text-2xl leading-tight text-[var(--ink)]">
                      {activeExercise.exerciseName}
                    </h2>
                  </div>

                  {trackingUsesWeight(activeExercise.trackingType) && (
                    <button
                      type="button"
                      onClick={() => setStepSheetOpen(true)}
                      aria-label={`Weight step for ${activeExercise.exerciseName}: plus or minus ${effectiveWeightStep} ${unit}`}
                      className={`btn alt !min-h-[44px] shrink-0 !px-2.5 text-xs ${
                        canResetStep ? '!bg-[var(--gold-bg)]' : ''
                      }`}
                    >
                      ±{effectiveWeightStep}
                      {unit}
                    </button>
                  )}
                </div>

                {(plannedTargetText || (!isClockActive && fallbackLastRest)) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--muted)]">
                    {plannedTargetText && (
                      <span>Target: {plannedTargetText}</span>
                    )}
                    {!isClockActive && fallbackLastRest && (
                      <span>
                        Last rest:{' '}
                        {formatRestSeconds(
                          fallbackLastRest.actualRestSeconds,
                          fallbackLastRest.restApproximate,
                        )}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Exercise Action Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenSwap(activeIndex)}
                  className="btn blue !min-h-[44px] !px-3 text-sm"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  <span>Swap</span>
                </button>

                {!activeNoteOpen && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenNotesByExId((prev) => ({
                        ...prev,
                        [activeExercise.localId]: true,
                      }))
                    }
                    className="btn alt !min-h-[44px] !px-3 text-sm"
                  >
                    <StickyNote className="h-4 w-4" />
                    <span>Note</span>
                  </button>
                )}

                {!activeAllDone && (
                  <button
                    type="button"
                    onClick={() => {
                      cancelAutoAdvance();
                      onCheckAll(activeIndex);
                    }}
                    className="btn green !min-h-[44px] !px-3 text-sm"
                  >
                    <CheckCheck className="h-4 w-4" />
                    <span>Check all</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onStartRestTimer(
                      activeExercise.defaultRestSeconds,
                      activeExercise.exerciseName,
                    )
                  }
                  aria-label="Start rest timer"
                  className="btn alt !min-h-[44px] !px-3 text-sm"
                >
                  <Timer className="h-4 w-4" />
                  <span>{activeExercise.defaultRestSeconds}s</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    cancelAutoAdvance();
                    onDeleteExercise(activeIndex);
                  }}
                  aria-label={`Remove ${activeExercise.exerciseName}`}
                  className="btn red icon ml-auto !h-[44px] !w-[44px]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Exercise Notes */}
              {activeNoteOpen && (
                <div className="note space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase text-[var(--muted)]">
                      Exercise Note
                    </span>
                    {activeExercise.notes.trim().length === 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenNotesByExId((prev) => ({
                            ...prev,
                            [activeExercise.localId]: false,
                          }))
                        }
                        aria-label="Close empty note"
                        className="flex h-7 w-7 items-center justify-center rounded border border-[var(--line)]/40 bg-[var(--card)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={activeExercise.notes}
                    onChange={(e) => onChangeExNotes(activeIndex, e.target.value)}
                    placeholder="Note..."
                    className="w-full resize-none rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-base font-bold outline-none"
                  />
                </div>
              )}

              {/* Set Rows (shared with List view) */}
              <div className="space-y-2.5">
                {activeExercise.sets.map((setRow, setIdx) => (
                  <LoggerSetRow
                    key={setRow.localId}
                    exIndex={activeIndex}
                    setIndex={setIdx}
                    totalSets={activeExercise.sets.length}
                    setRow={setRow}
                    sets={activeExercise.sets}
                    trackingType={activeExercise.trackingType}
                    unit={unit}
                    enableSetQuality={enableSetQuality}
                    isEditing={isEditing}
                    effectiveWeightStep={effectiveWeightStep}
                    prefill={activePrefill}
                    isCurrentFocusSet={setIdx === nextIncompleteIdx}
                    onUpdateSet={(exIdx, sIdx, patch) => {
                      cancelAutoAdvance();
                      onUpdateSet(exIdx, sIdx, patch);
                    }}
                    onToggleSetComplete={handleSetToggleWithAutoAdvance}
                    onRemoveSet={(exIdx, sIdx) => {
                      cancelAutoAdvance();
                      onRemoveSet(exIdx, sIdx);
                    }}
                    onOpenQuality={(idx) => setQualitySetIdx(idx)}
                  />
                ))}
              </div>

              {/* Primary Action + Add Set */}
              <div className="space-y-2 pt-1">
                {nextIncompleteIdx >= 0 ? (
                  <Button
                    variant="primary"
                    size="big"
                    className="w-full"
                    onClick={() =>
                      handleSetToggleWithAutoAdvance(
                        activeIndex,
                        nextIncompleteIdx,
                      )
                    }
                  >
                    <Check className="h-5 w-5" />
                    <span>Complete Set {nextIncompleteIdx + 1}</span>
                  </Button>
                ) : (
                  <Button
                    variant="green"
                    size="big"
                    className="w-full"
                    onClick={() => goToIndex(activeIndex + 1)}
                  >
                    <span>
                      {nextExercise
                        ? `Next: ${nextExercise.exerciseName}`
                        : 'Review Summary'}
                    </span>
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                )}

                <div className="flex items-center gap-2">
                  {activeIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => goToIndex(activeIndex - 1)}
                      aria-label="Previous exercise"
                      className="btn alt !min-h-[44px] !px-3 text-sm"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span>Prev</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      cancelAutoAdvance();
                      onAddSet(activeIndex);
                    }}
                    className="btn alt !min-h-[44px] flex-1 text-base"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add set</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Peek at Next Exercise Strip */}
            <button
              type="button"
              onClick={() => goToIndex(activeIndex + 1)}
              className="card-sm flex w-full min-h-[52px] items-center justify-between gap-2 text-left transition-colors motion-reduce:transition-none hover:bg-[var(--gold-bg)]/40"
              aria-label={
                nextExercise
                  ? `Up next: ${nextExercise.exerciseName}`
                  : 'Up next: Workout Summary'
              }
            >
              <div className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  Up next · tap or swipe left
                </span>
                {nextExercise ? (
                  <p className="truncate font-bold text-[var(--ink)]">
                    {nextExercise.exerciseName} ·{' '}
                    <span className="text-[var(--muted)]">
                      {formatExercisePeekTarget(nextExercise, unit)}
                    </span>
                  </p>
                ) : (
                  <p className="truncate font-bold text-[var(--ink)]">
                    Workout Summary ·{' '}
                    <span className="text-[var(--muted)]">
                      {completedSetsTotal} sets completed
                    </span>
                  </p>
                )}
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-[var(--ink)]" />
            </button>
          </div>
        ) : (
          /* Summary Screen (after last exercise, or when workout has 0 exercises) */
          <div className="space-y-3">
            <section aria-label="Workout summary" className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-marker text-2xl text-[var(--ink)]">
                    Workout Summary
                  </h2>
                  <p className="text-xs font-bold text-[var(--muted)]">
                    Review totals, adjust details, and save
                  </p>
                </div>
                {exerciseCount > 0 && (
                  <button
                    type="button"
                    onClick={() => goToIndex(exerciseCount - 1)}
                    className="btn alt !min-h-[44px] !px-3 text-sm"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Exercises</span>
                  </button>
                )}
              </div>

              {/* 2x2 Stats Breakdown */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-alt)]/60 p-2.5">
                  <span className="block text-[11px] font-bold uppercase text-[var(--muted)]">
                    Total Time
                  </span>
                  <span className="font-marker text-xl text-[var(--ink)]">
                    {isEditing
                      ? parseOptionalInt(draft.durationMinutes ?? '') !== null
                        ? `${parseOptionalInt(draft.durationMinutes ?? '')}m`
                        : '—'
                      : draft.startedAt
                        ? formatClockSeconds(summaryStats.elapsedSeconds)
                        : '00:00'}
                  </span>
                </div>

                <div className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-alt)]/60 p-2.5">
                  <span className="block text-[11px] font-bold uppercase text-[var(--muted)]">
                    Volume
                  </span>
                  <span className="font-marker text-xl text-[var(--ink)]">
                    {summaryStats.totalVolumeDisplay.toLocaleString()} {unit}
                  </span>
                </div>

                <div className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-alt)]/60 p-2.5">
                  <span className="block text-[11px] font-bold uppercase text-[var(--muted)]">
                    Working Time
                  </span>
                  <span className="font-marker text-xl text-[var(--ink)]">
                    {summaryStats.workingTimeSeconds !== null
                      ? `${summaryStats.hasAnyApproximate ? '~' : ''}${formatClockSeconds(summaryStats.workingTimeSeconds)}`
                      : '—'}
                  </span>
                </div>

                <div className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-alt)]/60 p-2.5">
                  <span className="block text-[11px] font-bold uppercase text-[var(--muted)]">
                    Rest Time
                  </span>
                  <span className="font-marker text-xl text-[var(--ink)]">
                    {summaryStats.totalRestSeconds > 0
                      ? `${summaryStats.hasAnyApproximate ? '~' : ''}${formatClockSeconds(summaryStats.totalRestSeconds)}`
                      : '00:00'}
                  </span>
                  {summaryStats.nonFinalSetCount > 0 &&
                    !summaryStats.allRestsMeasured && (
                      <span className="block text-[11px] font-bold text-[var(--muted)]">
                        {summaryStats.measuredRestCount}/
                        {summaryStats.nonFinalSetCount} transitions
                      </span>
                    )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-2 border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm font-bold">
                <span>
                  {summaryStats.completedSetsCount} /{' '}
                  {summaryStats.totalSetsCount} sets completed
                </span>
                <span className="text-[var(--muted)]">
                  {summaryStats.completedExercisesCount}/
                  {summaryStats.totalExercisesCount} exercises done
                </span>
              </div>

              {/* Exercise Breakdown (tap any to jump & edit) */}
              {draft.exercises.length > 0 ? (
                <div className="space-y-1.5">
                  {draft.exercises.map((ex, idx) => {
                    const done = ex.sets.filter((s) => s.isCompleted).length;
                    const total = ex.sets.length;
                    return (
                      <button
                        key={ex.localId}
                        type="button"
                        onClick={() => goToIndex(idx)}
                        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate font-bold text-[var(--ink)]">
                          {idx + 1}. {ex.exerciseName}
                        </span>
                        <span
                          className={`pill shrink-0 px-2 py-0.5 text-xs ${
                            total > 0 && done === total ? 'green' : ''
                          }`}
                        >
                          {done}/{total}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[10px] border-2 border-dashed border-[var(--line)] py-5 text-center font-bold text-[var(--muted)]">
                  No exercises yet
                </div>
              )}

              <Button
                variant="alt"
                className="w-full"
                onClick={() => {
                  cancelAutoAdvance();
                  onOpenPicker();
                }}
              >
                <Plus className="h-5 w-5" />
                <span>Add exercise</span>
              </Button>
            </section>

            {/* Session Title, Jolly, Notes, and Edit Details */}
            <section className="card space-y-3">
              {isEditing && (
                <div className="space-y-2.5">
                  <label className="block space-y-0.5">
                    <span className="block text-xs font-bold uppercase text-[var(--muted)]">
                      Date
                    </span>
                    <input
                      type="date"
                      value={draft.sessionDate ?? date}
                      onChange={(e) => onUpdateSessionDate(e.target.value)}
                      aria-label="Workout date"
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-0.5">
                      <span className="block text-xs font-bold uppercase text-[var(--muted)]">
                        Start time
                      </span>
                      <input
                        type="time"
                        value={startTimeInput}
                        onChange={(e) => onUpdateStartedAt(e.target.value)}
                        aria-label="Start time"
                        className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
                      />
                    </label>
                    <label className="block space-y-0.5">
                      <span className="block text-xs font-bold uppercase text-[var(--muted)]">
                        Duration (min)
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.durationMinutes ?? ''}
                        onChange={(e) =>
                          onUpdateDurationMinutes(e.target.value)
                        }
                        placeholder="—"
                        aria-label="Duration minutes"
                        className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => onUpdateTitle(e.target.value)}
                  placeholder="Workout title"
                  aria-label="Workout title"
                  className="min-h-[44px] flex-1 rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 font-marker text-xl outline-none focus:bg-[var(--surface)]"
                />
                {!noteOpen && (
                  <button
                    type="button"
                    onClick={() => onToggleNoteOpen(true)}
                    className="btn alt !min-h-[44px] !px-3 text-sm"
                  >
                    <StickyNote className="h-4 w-4" />
                    <span>Note</span>
                  </button>
                )}
              </div>

              {draft.isJolly && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill gold text-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    Jolly
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateJollyMode('extra')}
                    className={`pill min-h-[36px] cursor-pointer text-xs ${
                      draft.jollyMode !== 'instead' ? 'gold' : ''
                    }`}
                  >
                    Extra
                  </button>
                  {canOfferInstead && (
                    <button
                      type="button"
                      onClick={() => onUpdateJollyMode('instead')}
                      className={`pill min-h-[36px] cursor-pointer text-xs ${
                        draft.jollyMode === 'instead' ? 'gold' : ''
                      }`}
                    >
                      Instead of {plannedDayLabel}
                    </button>
                  )}
                </div>
              )}

              {(noteOpen || draft.notes.trim().length > 0) && (
                <div className="note space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase text-[var(--muted)]">
                      Workout Note
                    </span>
                    {draft.notes.trim().length === 0 && (
                      <button
                        type="button"
                        onClick={() => onToggleNoteOpen(false)}
                        aria-label="Close empty workout note"
                        className="flex h-7 w-7 items-center justify-center rounded border border-[var(--line)]/40 bg-[var(--card)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={draft.notes}
                    onChange={(e) => onUpdateWorkoutNotes(e.target.value)}
                    placeholder="Workout note..."
                    className="w-full resize-none rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-base font-bold outline-none"
                  />
                </div>
              )}
            </section>

            {/* Primary Save / Delete Actions */}
            <div className="space-y-2 pt-1">
              <Button
                variant="primary"
                size="big"
                loading={saving}
                onClick={onSave}
                className="w-full"
              >
                <Check className="h-5 w-5" />
                <span>
                  {isEditing
                    ? 'Save changes'
                    : `Finish workout (${completedSetsTotal} sets)`}
                </span>
              </Button>

              {isEditing && (
                <Button
                  variant="red"
                  disabled={deleting}
                  onClick={onRequestDeleteSession}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete workout</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Jump & Reorder Sheet */}
      <Sheet
        open={jumpSheetOpen}
        onClose={() => setJumpSheetOpen(false)}
        title="Exercises & Order"
      >
        <div className="space-y-2.5">
          {draft.exercises.length === 0 ? (
            <p className="py-3 text-center text-sm font-bold text-[var(--muted)]">
              No exercises yet. Add one below.
            </p>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-0.5">
              {draft.exercises.map((ex, idx) => {
                const done = ex.sets.filter((s) => s.isCompleted).length;
                const total = ex.sets.length;
                const isCurrent = !isSummaryStep && idx === activeIndex;
                return (
                  <div
                    key={ex.localId}
                    className={`flex items-center gap-1.5 rounded-[10px] border-2 border-[var(--line)] p-2 ${
                      isCurrent ? 'bg-[var(--gold-bg)]' : 'bg-[var(--card)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        goToIndex(idx);
                        setJumpSheetOpen(false);
                      }}
                      className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate font-bold text-[var(--ink)]">
                        {idx + 1}. {ex.exerciseName}
                      </span>
                      <span
                        className={`pill shrink-0 px-2 py-0.5 text-xs ${
                          total > 0 && done === total ? 'green' : ''
                        }`}
                      >
                        {done}/{total}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onReorderExercise(idx, idx - 1)}
                      aria-label={`Move ${ex.exerciseName} up`}
                      className="btn alt icon !h-[44px] !w-[44px] shrink-0"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      disabled={idx === draft.exercises.length - 1}
                      onClick={() => onReorderExercise(idx, idx + 1)}
                      aria-label={`Move ${ex.exerciseName} down`}
                      className="btn alt icon !h-[44px] !w-[44px] shrink-0"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteExercise(idx)}
                      aria-label={`Remove ${ex.exerciseName}`}
                      className="btn red icon !h-[44px] !w-[44px] shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="alt"
              onClick={() => {
                setJumpSheetOpen(false);
                onOpenPicker();
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Add exercise</span>
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                goToIndex(exerciseCount);
                setJumpSheetOpen(false);
              }}
            >
              <Check className="h-4 w-4" />
              <span>Summary</span>
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Set Quality Popover for active exercise */}
      {activeExercise &&
        activeQualitySet &&
        qualitySetIdx !== null &&
        (enableSetQuality ||
          isEditing ||
          activeQualitySet.executionQualityPct !== null ||
          activeQualitySet.repQualities.length > 0) && (
          <SetQualityPopover
            open={true}
            onClose={() => setQualitySetIdx(null)}
            setNumber={qualitySetIdx + 1}
            reps={parseOptionalInt(activeQualitySet.reps)}
            qualityPct={activeQualitySet.executionQualityPct}
            repQualities={activeQualitySet.repQualities}
            onApply={(pct, repQualities) =>
              onUpdateSet(activeIndex, qualitySetIdx, {
                executionQualityPct: pct,
                repQualities,
              })
            }
          />
        )}

      {/* Weight Step Sheet for active exercise */}
      {activeExercise &&
        resolvedStep &&
        trackingUsesWeight(activeExercise.trackingType) && (
          <WeightStepSheet
            open={stepSheetOpen}
            onClose={() => setStepSheetOpen(false)}
            exerciseId={activeExercise.exerciseId}
            exerciseName={activeExercise.exerciseName}
            unit={unit}
            effectiveWeightStep={effectiveWeightStep}
            weightStepSource={resolvedStep.source}
            isCustomExercise={isCustomExercise}
            canResetStep={canResetStep}
            onChangeWeightStep={onChangeWeightStep}
          />
        )}
    </div>
  );
}
