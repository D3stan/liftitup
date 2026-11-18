'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  StickyNote,
  X,
} from 'lucide-react';
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

export function getFieldFallbackValue(
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

export interface LoggerSetRowProps {
  exIndex: number;
  setIndex: number;
  kindIndex?: number;
  totalSets: number;
  canDelete?: boolean;
  setRow: LoggerSet;
  sets: LoggerSet[];
  trackingType: TrackingType;
  unit: WeightUnit;
  enableSetQuality: boolean;
  showRir?: boolean;
  enableSetNoteTags?: boolean;
  enableSetNoteHint?: boolean;
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
  kindIndex,
  totalSets,
  canDelete,
  setRow,
  sets,
  trackingType,
  unit,
  enableSetQuality,
  showRir = false,
  enableSetNoteTags = true,
  enableSetNoteHint = true,
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
  const [noteOpen, setNoteOpen] = useState(
    () => setRow.notes.trim().length > 0,
  );
  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    if (!tagsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(`[data-tags-menu="${setRow.localId}"]`)
      ) {
        return;
      }
      setTagsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTagsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tagsOpen, setRow.localId]);

  const isWarmup = setRow.isWarmup;
  const displayIdx = kindIndex ?? setIndex;
  const setBadgeLabel = isWarmup
    ? `W${displayIdx + 1}`
    : `Set ${displayIdx + 1}`;
  const setAriaPrefix = isWarmup
    ? `Warmup ${displayIdx + 1}`
    : `Set ${displayIdx + 1}`;

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
  const allowDelete = canDelete ?? (isWarmup ? true : totalSets > 1);

  const hasNote = setRow.notes.trim().length > 0;
  const isNoteBoxOpen = hasNote || noteOpen;
  const matchingPrefill = isWarmup
    ? prefill?.warmupSets?.[displayIdx] ?? null
    : prefill?.sets?.[displayIdx] ?? null;

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
        isWarmup ? 'border-dashed' : ''
      } ${
        isCurrentFocusSet && !setRow.isCompleted
          ? 'ring-2 ring-[var(--gold)] ring-offset-1 ring-offset-[var(--card)]'
          : ''
      }`}
    >
      {/* Top line: Set # + Current badge + Note + Quality pill + Remove + Check */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`pill px-2.5 py-0.5 font-marker text-xs ${
              isWarmup
                ? 'bg-[var(--paper)] text-[var(--muted)]'
                : 'bg-[var(--card)]'
            }`}
          >
            {setBadgeLabel}
          </span>
          {isCurrentFocusSet && !setRow.isCompleted && (
            <span className="pill gold px-2 py-0.5 text-[11px]">Next</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (hasNote) return;
              setNoteOpen((prev) => !prev);
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
              onClick={() => onOpenQuality(setIndex)}
              aria-label={`${setAriaPrefix} quality`}
              className={`min-h-[44px] min-w-[54px] rounded-[8px] border-[2.5px] border-[var(--line)] px-2.5 text-sm font-bold shadow-[2px_2px_0_var(--shadow-color)] ${getQualityBadgeColor(
                setRow.executionQualityPct,
              )}`}
            >
              {qualityValue}%
            </button>
          )}

          {allowDelete && (
            <button
              type="button"
              onClick={() => onRemoveSet(exIndex, setIndex)}
              aria-label={`Delete ${setAriaPrefix.toLowerCase()}`}
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
              onChange={(next) => onUpdateSet(exIndex, setIndex, { reps: next })}
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
              ariaLabel={`${setAriaPrefix} seconds`}
              decrementLabel={`Decrease ${setAriaPrefix.toLowerCase()} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
              incrementLabel={`Increase ${setAriaPrefix.toLowerCase()} time by ${DEFAULT_TIME_STEP_SECONDS}s`}
            />
          </div>
        )}
      </div>

      {/* RIR Counter */}
      {showRir && (
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
                    onUpdateSet(exIndex, setIndex, {
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
                  onUpdateSet(exIndex, setIndex, { rir: next });
                }}
                aria-label={`Decrease ${setAriaPrefix} RIR by 0.5`}
                className="btn alt icon !h-[44px] !w-[44px]"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={setRow.rir === null}
                onClick={() => onUpdateSet(exIndex, setIndex, { rir: null })}
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
                  onUpdateSet(exIndex, setIndex, { rir: next });
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
                  setNoteOpen(true);
                }
                onUpdateSet(exIndex, setIndex, { notes: nextVal });
              }}
              placeholder="Set note..."
              aria-label={`${setAriaPrefix} note text`}
              className="min-h-[44px] min-w-[160px] flex-1 rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-base font-bold outline-none"
            />
            {enableSetNoteTags && (
              <div className="relative" data-tags-menu={setRow.localId}>
                <button
                  type="button"
                  onClick={() => setTagsOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={tagsOpen}
                  className={`btn alt !min-h-[44px] !px-2.5 text-xs ${
                    tagsOpen ? '!bg-[var(--gold-bg)]' : ''
                  }`}
                >
                  <span>Tags</span>
                  {tagsOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {tagsOpen && (
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
                              const nextNotes = toggleNoteTag(setRow.notes, tag);
                              if (nextNotes.trim().length === 0) {
                                setNoteOpen(true);
                              }
                              onUpdateSet(exIndex, setIndex, {
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
                            {active && <Check className="h-4 w-4 shrink-0" />}
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
                  setNoteOpen(false);
                  setTagsOpen(false);
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
                onUpdateSet(exIndex, setIndex, {
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
}
