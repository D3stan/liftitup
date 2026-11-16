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
import type { WeightUnit } from '@/types/domain';
import SetQualityPopover from './SetQualityPopover';
import {
  getQualityBadgeColor,
  getQualityRowColor,
  getWeightFieldLabel,
  parseOptionalInt,
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
  onMoveUp,
  onMoveDown,
  onDeleteExercise,
  onOpenSwap,
  onChangeNotes,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onCheckAll,
  onStartRestTimer,
}: ExerciseLoggerCardProps) {
  const [noteOpen, setNoteOpen] = useState(exercise.notes.trim().length > 0);
  const [qualitySetIdx, setQualitySetIdx] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const startLongPress = (setIdx: number) => {
    if (!enableSetQuality) return;
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      setQualitySetIdx(setIdx);
    }, 480);
  };

  const activeQualitySet =
    qualitySetIdx !== null ? exercise.sets[qualitySetIdx] ?? null : null;

  return (
    <div
      className={`card space-y-3 transition-colors duration-150 ${
        allDone ? 'bg-[#eef7e8]' : ''
      }`}
    >
      {/* Header: Order + Name + Controls */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="pill shrink-0 !bg-[#1d1a16] px-2.5 py-0.5 font-marker text-xs !text-[#fbf5e4]">
              #{index + 1}
            </span>
            <h3 className="min-w-0 flex-1 font-marker text-xl leading-tight text-[#1d1a16]">
              {exercise.exerciseName}
            </h3>
          </div>
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
            <span className="text-xs font-bold uppercase text-[#5d5446]">
              Exercise Note
            </span>
            {exercise.notes.trim().length === 0 && (
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                aria-label="Close empty note"
                className="flex h-7 w-7 items-center justify-center rounded border border-[#1d1a16]/40 bg-[#fbf5e4]"
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
            className="w-full resize-none rounded-[6px] border-2 border-[#1d1a16] bg-[#fbf5e4] px-2.5 py-1.5 text-base font-bold outline-none"
          />
        </div>
      )}

      {/* Stacked Mobile Set Rows */}
      <div className="space-y-2.5">
        {exercise.sets.map((setRow, setIdx) => {
          const rowColor = getQualityRowColor(
            setRow.isCompleted,
            enableSetQuality,
            setRow.executionQualityPct,
          );
          const qualityValue = setRow.executionQualityPct ?? 100;

          return (
            <div
              key={setRow.localId}
              onPointerDown={() => startLongPress(setIdx)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              className={`rounded-[10px] border-[2.5px] border-[#1d1a16] p-2.5 shadow-[2px_2px_0_#1d1a16] transition-colors ${rowColor}`}
            >
              {/* Top line: Set # + Quality pill + Check + Remove */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="pill bg-[#fbf5e4] px-2.5 py-0.5 font-marker text-xs">
                  Set {setIdx + 1}
                </span>

                <div className="flex items-center gap-1.5">
                  {enableSetQuality && (
                    <button
                      type="button"
                      onClick={() => setQualitySetIdx(setIdx)}
                      aria-label={`Set ${setIdx + 1} quality`}
                      className={`min-h-[44px] min-w-[54px] rounded-[8px] border-[2.5px] border-[#1d1a16] px-2.5 text-sm font-bold shadow-[2px_2px_0_#1d1a16] ${getQualityBadgeColor(
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
                    onClick={() => {
                      const nextDone = !setRow.isCompleted;
                      onUpdateSet(index, setIdx, { isCompleted: nextDone });
                      if (nextDone) {
                        onStartRestTimer(
                          setRow.restSeconds ?? exercise.defaultRestSeconds,
                          exercise.exerciseName,
                        );
                      }
                    }}
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

              {/* Stacked/2-col wide inputs (>=16px font, zero overlap) */}
              <div
                className={`grid gap-2 ${
                  fieldCount >= 2 ? 'grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {usesWeight && (
                  <label className="block space-y-0.5">
                    <span className="block text-xs font-bold uppercase text-[#5d5446]">
                      {getWeightFieldLabel(t, unit)}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={setRow.weightDisplay}
                      onChange={(e) =>
                        onUpdateSet(index, setIdx, {
                          weightDisplay: e.target.value,
                        })
                      }
                      placeholder="0"
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] px-3 text-base font-bold outline-none focus:bg-white"
                    />
                  </label>
                )}

                {usesReps && (
                  <label className="block space-y-0.5">
                    <span className="block text-xs font-bold uppercase text-[#5d5446]">
                      Reps
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={setRow.reps}
                      onChange={(e) =>
                        onUpdateSet(index, setIdx, { reps: e.target.value })
                      }
                      placeholder="0"
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] px-3 text-base font-bold outline-none focus:bg-white"
                    />
                  </label>
                )}

                {usesDist && (
                  <label className="block space-y-0.5">
                    <span className="block text-xs font-bold uppercase text-[#5d5446]">
                      Meters
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={setRow.distanceM}
                      onChange={(e) =>
                        onUpdateSet(index, setIdx, {
                          distanceM: e.target.value,
                        })
                      }
                      placeholder="0"
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] px-3 text-base font-bold outline-none focus:bg-white"
                    />
                  </label>
                )}

                {usesTime && (
                  <label className="block space-y-0.5">
                    <span className="block text-xs font-bold uppercase text-[#5d5446]">
                      Seconds
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={setRow.timeSeconds}
                      onChange={(e) =>
                        onUpdateSet(index, setIdx, {
                          timeSeconds: e.target.value,
                        })
                      }
                      placeholder="0"
                      className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#fbf5e4] px-3 text-base font-bold outline-none focus:bg-white"
                    />
                  </label>
                )}
              </div>
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

      {enableSetQuality && activeQualitySet && qualitySetIdx !== null && (
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
    </div>
  );
}
