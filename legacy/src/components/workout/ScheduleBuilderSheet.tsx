'use client';

import React, { useState, useEffect } from 'react';
import type {
  ExerciseDefinition,
  Schedule,
  ScheduleDay,
  ScheduleSlot,
  MuscleGroup,
} from '@/types/domain';
import {
  Calendar,
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Save,
  Sparkles,
  Minus,
  X,
} from 'lucide-react';
import { playMechanicalClick, playSetComplete } from '@/lib/audio/soundEngine';
import { enqueueOutboxOp } from '@/lib/offline/outbox';

export interface ScheduleBuilderSheetProps {
  schedule: Schedule | null;
  exercises: ExerciseDefinition[];
  soundEnabled: boolean;
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onScheduleSaved: (updated: Schedule) => void;
  onShowToast: (message: string) => void;
}

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRESET_OPTIONS: {
  id: string;
  label: string;
  splitType: Schedule['splitType'];
  subtitle: string;
}[] = [
  {
    id: 'upper_lower_ppl_5d',
    label: 'Upper/Lower + PPL (5-Day)',
    splitType: 'upper_lower',
    subtitle: '2x/wk frequency across all 13 muscle groups (Default Pro Split)',
  },
  {
    id: 'upper_lower_4d',
    label: 'Upper / Lower (4-Day)',
    splitType: 'upper_lower',
    subtitle: 'Mon/Tue & Thu/Fri — high recovery, joint-friendly hypertrophy',
  },
  {
    id: 'ppl_6d',
    label: 'Push / Pull / Legs (6-Day)',
    splitType: 'ppl',
    subtitle: 'Classic 6-day volume specialization for MAV sweet-spot',
  },
  {
    id: 'minimal_fullbody_3d',
    label: 'Minimalist Full-Body (3-Day)',
    splitType: 'full_body',
    subtitle: 'Mon/Wed/Fri high-efficiency compound & cable hypertrophy',
  },
];

function deriveFocusMuscles(
  slots: ScheduleSlot[],
  exercises: ExerciseDefinition[]
): MuscleGroup[] {
  const seen = new Set<MuscleGroup>();
  for (const s of slots) {
    const ex = exercises.find((e) => e.id === s.exerciseId);
    if (ex) {
      seen.add(ex.primaryMuscle);
    }
  }
  return Array.from(seen).slice(0, 4);
}

export default function ScheduleBuilderSheet({
  schedule,
  exercises,
  soundEnabled,
  isModal = false,
  isOpen = true,
  onClose,
  onScheduleSaved,
  onShowToast,
}: ScheduleBuilderSheetProps) {
  const [draft, setDraft] = useState<Schedule | null>(schedule);
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(0);
  const [saving, setSaving] = useState<boolean>(false);
  const [newExerciseId, setNewExerciseId] = useState<string>(
    exercises[0]?.id || 'lat-pulldown-pulley'
  );

  useEffect(() => {
    if (schedule) {
      setDraft(JSON.parse(JSON.stringify(schedule)) as Schedule);
    }
  }, [schedule]);

  useEffect(() => {
    if (exercises.length > 0 && !newExerciseId) {
      setNewExerciseId(exercises[0].id);
    }
  }, [exercises, newExerciseId]);

  if (isModal && !isOpen) return null;

  if (!draft) {
    return (
      <div className="card space-y-2">
        <h3 className="font-marker text-xl">LOADING WEEKLY SPLIT...</h3>
      </div>
    );
  }

  const currentDay: ScheduleDay = draft.days.find(
    (d) => d.dayOfWeek === selectedDayIdx
  ) || {
    id: `day-${selectedDayIdx}`,
    dayOfWeek: selectedDayIdx,
    dayName: DAY_NAMES[selectedDayIdx],
    routineLabel: 'Rest Day',
    isRestDay: true,
    focusMuscles: [],
    slots: [],
  };

  const updateCurrentDay = (updater: (day: ScheduleDay) => ScheduleDay) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextDays = prev.days.map((d) =>
        d.dayOfWeek === selectedDayIdx ? updater(d) : d
      );
      return {
        ...prev,
        days: nextDays,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleShiftSplit = async (deltaDays: number) => {
    playMechanicalClick(soundEnabled);
    const shiftedDays: ScheduleDay[] = draft.days
      .map((d) => {
        const newDow = (d.dayOfWeek + deltaDays + 7) % 7;
        return {
          ...d,
          dayOfWeek: newDow,
          dayName: DAY_NAMES[newDow],
        };
      })
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    const nextSchedule: Schedule = {
      ...draft,
      days: shiftedDays,
      updatedAt: new Date().toISOString(),
    };
    setDraft(nextSchedule);

    try {
      const res = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'shift', shiftBy: deltaDays, deltaDays }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) {
          onScheduleSaved(data.schedule);
          onShowToast(
            `Shifted weekly split by ${deltaDays > 0 ? `+${deltaDays}` : deltaDays} day!`
          );
          return;
        }
      }
    } catch {
      enqueueOutboxOp({
        type: 'schedule_update',
        endpoint: '/api/schedule',
        method: 'PUT',
        payload: { schedule: nextSchedule },
      });
    }

    onScheduleSaved(nextSchedule);
    onShowToast(
      `Shifted weekly split by ${deltaDays > 0 ? `+${deltaDays}` : deltaDays} day!`
    );
  };

  const handleApplyPreset = async (presetId: string) => {
    playMechanicalClick(soundEnabled);
    setSaving(true);
    try {
      const res = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetKey: presetId, action: 'apply_preset', presetId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) {
          playSetComplete(soundEnabled);
          setDraft(data.schedule);
          onScheduleSaved(data.schedule);
          onShowToast(`Applied ${data.schedule.name} split!`);
          return;
        }
      }
    } catch {
      // Ignore network error, handled below
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSchedule = async () => {
    playMechanicalClick(soundEnabled);
    setSaving(true);

    try {
      const res = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: draft }),
      });
      if (res.ok) {
        const data = await res.json();
        const saved: Schedule = data.schedule || draft;
        playSetComplete(soundEnabled);
        onScheduleSaved(saved);
        onShowToast('Weekly hypertrophy split saved!');
        if (onClose) onClose();
        return;
      }
    } catch {
      enqueueOutboxOp({
        type: 'schedule_update',
        endpoint: '/api/schedule',
        method: 'PUT',
        payload: { schedule: draft },
      });
    } finally {
      setSaving(false);
    }

    playSetComplete(soundEnabled);
    onScheduleSaved(draft);
    onShowToast('Weekly split saved to notebook (queued for sync)!');
    if (onClose) onClose();
  };

  const content = (
    <div className="space-y-4">
      {/* Header & Shift Split Utility */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="pill gold text-xs uppercase font-marker">
              <Calendar className="w-3.5 h-3.5" /> 7-DAY HYPERTROPHY SPLIT BUILDER
            </span>
            <h2 className="text-2xl font-marker mt-1">{draft.name}</h2>
            <p className="text-sm font-bold text-[#5d5446]">
              Customize training days, swap default exercises (e.g. Pulley ↔ Weighted Chin-ups), or shift your split when life happens.
            </p>
          </div>
          {isModal && onClose && (
            <button
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                onClose();
              }}
              aria-label="Close schedule builder"
              className="btn icon alt"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Life Happened: Shift Split ±1 Day */}
        <div className="bg-[#ece2c6] border-[2.5px] border-[#1d1a16] rounded-[10px] p-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">
            <span className="font-marker">LIFE HAPPENED?</span> Shift entire 7-day cycle without breaking your streak:
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleShiftSplit(-1)}
              className="btn alt !min-h-[44px] !px-3 !py-1 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Shift −1 Day
            </button>
            <button
              type="button"
              onClick={() => handleShiftSplit(1)}
              className="btn alt !min-h-[44px] !px-3 !py-1 text-sm"
            >
              Shift +1 Day <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 1-Tap Preset Split Templates */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold uppercase text-[#5d5446] flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-[#d9412b]" /> 1-Tap Pro Hypertrophy Split Presets:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESET_OPTIONS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={saving}
                onClick={() => handleApplyPreset(preset.id)}
                className="card-sm text-left flex flex-col justify-between gap-1 cursor-pointer hover:bg-[#fbedba] transition-colors"
              >
                <span className="font-marker text-base text-[#1d1a16]">
                  {preset.label}
                </span>
                <span className="text-xs font-bold text-[#5d5446]">
                  {preset.subtitle}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Day-of-Week Selector Tabs (Mon..Sun) */}
      <div className="grid grid-cols-7 gap-1.5">
        {SHORT_DAYS.map((label, idx) => {
          const d = draft.days.find((day) => day.dayOfWeek === idx);
          const isSelected = selectedDayIdx === idx;
          const isRest = d ? d.isRestDay : true;

          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                playMechanicalClick(soundEnabled);
                setSelectedDayIdx(idx);
              }}
              className={`min-h-[50px] rounded-[8px] border-[2.5px] border-[#1d1a16] flex flex-col items-center justify-center p-1 cursor-pointer ${
                isSelected
                  ? 'bg-[#f2b632]'
                  : isRest
                  ? 'bg-[#ece2c6] text-[#5d5446]'
                  : 'bg-[#fbf5e4]'
              }`}
              style={{
                boxShadow: isSelected ? '3px 3px 0 var(--ink)' : '2px 2px 0 var(--ink)',
              }}
            >
              <span className="font-marker text-xs">{label}</span>
              <span className="text-[11px] font-bold truncate w-full text-center">
                {isRest ? 'Rest' : `${d?.slots.length || 0} ex`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Day Editor Card */}
      <div className="card space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-2xl font-marker">
            {DAY_NAMES[selectedDayIdx].toUpperCase()}CONFIGURATION
          </h3>

          <button
            type="button"
            onClick={() => {
              playMechanicalClick(soundEnabled);
              updateCurrentDay((day) => {
                const nextRest = !day.isRestDay;
                return {
                  ...day,
                  isRestDay: nextRest,
                  routineLabel: nextRest
                    ? 'Rest & Growth Day'
                    : day.routineLabel === 'Rest Day' ||
                      day.routineLabel === 'Rest & Growth Day'
                    ? 'Custom Hypertrophy Session'
                    : day.routineLabel,
                };
              });
            }}
            className={`btn !min-h-[44px] !px-3.5 !py-1 text-base ${
              currentDay.isRestDay ? 'alt' : 'green'
            }`}
          >
            {currentDay.isRestDay
              ? '🛋️ Rest Day (Tap to Make Training Day)'
              : '🏋️ Training Day (Tap to Make Rest Day)'}
          </button>
        </div>

        {/* Routine Label Input */}
        <div className="space-y-1">
          <label className="text-sm font-bold text-[#5d5446]">
            Routine Day Title:
          </label>
          <input
            type="text"
            value={currentDay.routineLabel}
            onChange={(e) =>
              updateCurrentDay((day) => ({
                ...day,
                routineLabel: e.target.value,
              }))
            }
            placeholder="e.g. Pull A — Lats & Biceps"
            className="nb-input font-bold"
          />
        </div>

        {/* Exercise Slots List */}
        {!currentDay.isRestDay && (
          <div className="space-y-3">
            <div className="text-sm font-bold uppercase text-[#5d5446]">
              Scheduled Exercise Slots ({currentDay.slots.length}):
            </div>

            {currentDay.slots.length === 0 ? (
              <div className="note text-base font-bold">
                No exercises scheduled on {DAY_NAMES[selectedDayIdx]} yet. Add one below!
              </div>
            ) : (
              <div className="space-y-2.5">
                {currentDay.slots.map((slot, sIdx) => {
                  return (
                    <div
                      key={`${slot.id}-${sIdx}`}
                      className="card-sm space-y-2.5 bg-[#fbf5e4]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="pill bg-[#1d1a16] text-[#fbf5e4] text-xs font-marker">
                          SLOT #{sIdx + 1} •{' '}
                          {slot.movementSlot.replace(/_/g, ' ').toUpperCase()}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            playMechanicalClick(soundEnabled);
                            updateCurrentDay((day) => {
                              const nextSlots = day.slots
                                .filter((_, i) => i !== sIdx)
                                .map((s, idx) => ({ ...s, slotIndex: idx }));
                              return {
                                ...day,
                                slots: nextSlots,
                                focusMuscles: deriveFocusMuscles(
                                  nextSlots,
                                  exercises
                                ),
                              };
                            });
                          }}
                          aria-label={`Remove slot ${sIdx + 1}`}
                          className="btn icon alt !w-[44px] !h-[44px]"
                        >
                          <Trash2 className="w-4 h-4 text-[#d9412b]" />
                        </button>
                      </div>

                      {/* Default Exercise Picker */}
                      <select
                        value={slot.exerciseId}
                        onChange={(e) => {
                          const nextEx = exercises.find(
                            (ex) => ex.id === e.target.value
                          );
                          if (!nextEx) return;
                          updateCurrentDay((day) => {
                            const nextSlots = day.slots.map((s, i) =>
                              i === sIdx
                                ? {
                                    ...s,
                                    exerciseId: nextEx.id,
                                    exerciseName: nextEx.name,
                                    movementSlot: nextEx.movementSlot,
                                  }
                                : s
                            );
                            return {
                              ...day,
                              slots: nextSlots,
                              focusMuscles: deriveFocusMuscles(
                                nextSlots,
                                exercises
                              ),
                            };
                          });
                        }}
                        aria-label={`Select exercise for slot ${sIdx + 1}`}
                        className="nb-input font-bold"
                      >
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name} [{ex.movementSlot.replace(/_/g, ' ')}]
                          </option>
                        ))}
                      </select>

                      {/* Sets, Rep Range, and Target RIR Steppers */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {/* Target Sets */}
                        <div className="flex flex-col items-center bg-[#ece2c6] border-[2px] border-[#1d1a16] rounded-[8px] p-1.5">
                          <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                            Sets
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                playMechanicalClick(soundEnabled);
                                updateCurrentDay((day) => ({
                                  ...day,
                                  slots: day.slots.map((s, i) =>
                                    i === sIdx
                                      ? {
                                          ...s,
                                          targetSets: Math.max(
                                            1,
                                            s.targetSets - 1
                                          ),
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className="stepper-btn !w-[38px] !h-[38px]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-marker text-lg w-5 text-center">
                              {slot.targetSets}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                playMechanicalClick(soundEnabled);
                                updateCurrentDay((day) => ({
                                  ...day,
                                  slots: day.slots.map((s, i) =>
                                    i === sIdx
                                      ? {
                                          ...s,
                                          targetSets: Math.min(
                                            8,
                                            s.targetSets + 1
                                          ),
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className="stepper-btn !w-[38px] !h-[38px]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Rep Range Max */}
                        <div className="flex flex-col items-center bg-[#ece2c6] border-[2px] border-[#1d1a16] rounded-[8px] p-1.5">
                          <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                            Rep Range
                          </span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                playMechanicalClick(soundEnabled);
                                updateCurrentDay((day) => ({
                                  ...day,
                                  slots: day.slots.map((s, i) =>
                                    i === sIdx
                                      ? {
                                          ...s,
                                          repRangeMin: Math.max(
                                            4,
                                            s.repRangeMin - 2
                                          ),
                                          repRangeMax: Math.max(
                                            6,
                                            s.repRangeMax - 2
                                          ),
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className="stepper-btn !w-[38px] !h-[38px]"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-marker text-sm px-1">
                              {slot.repRangeMin}-{slot.repRangeMax}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                playMechanicalClick(soundEnabled);
                                updateCurrentDay((day) => ({
                                  ...day,
                                  slots: day.slots.map((s, i) =>
                                    i === sIdx
                                      ? {
                                          ...s,
                                          repRangeMin: Math.min(
                                            16,
                                            s.repRangeMin + 2
                                          ),
                                          repRangeMax: Math.min(
                                            20,
                                            s.repRangeMax + 2
                                          ),
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className="stepper-btn !w-[38px] !h-[38px]"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Target RIR */}
                        <div className="flex flex-col items-center bg-[#ece2c6] border-[2px] border-[#1d1a16] rounded-[8px] p-1.5">
                          <span className="text-[11px] font-bold uppercase text-[#5d5446]">
                            Target RIR
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                playMechanicalClick(soundEnabled);
                                updateCurrentDay((day) => ({
                                  ...day,
                                  slots: day.slots.map((s, i) =>
                                    i === sIdx
                                      ? {
                                          ...s,
                                          targetRir: (s.targetRir + 1) % 4,
                                        }
                                      : s
                                  ),
                                }));
                              }}
                              className="btn alt !min-h-[38px] !px-3 !py-0.5 font-marker text-base"
                            >
                              RIR {slot.targetRir}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add New Exercise Slot to Current Day */}
            <div className="bg-[#ece2c6] border-[2.5px] border-[#1d1a16] rounded-[10px] p-2.5 space-y-2">
              <div className="text-xs font-bold uppercase text-[#5d5446]">
                + Add Exercise Slot to {DAY_NAMES[selectedDayIdx]}:
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={newExerciseId}
                  onChange={(e) => setNewExerciseId(e.target.value)}
                  aria-label="Select exercise to add to schedule day"
                  className="nb-input flex-1"
                >
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.name} ({ex.primaryMuscle.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    playMechanicalClick(soundEnabled);
                    const found =
                      exercises.find((e) => e.id === newExerciseId) ||
                      exercises[0];
                    if (!found) return;

                    updateCurrentDay((day) => {
                      const nextSlot: ScheduleSlot = {
                        id: `slot-${day.dayOfWeek}-${Date.now()}`,
                        slotIndex: day.slots.length,
                        movementSlot: found.movementSlot,
                        exerciseId: found.id,
                        exerciseName: found.name,
                        targetSets: 3,
                        repRangeMin: found.defaultRepMin || 8,
                        repRangeMax: found.defaultRepMax || 12,
                        targetRir: 2,
                        restSeconds: found.defaultRestSeconds || 120,
                      };
                      const nextSlots = [...day.slots, nextSlot];
                      return {
                        ...day,
                        isRestDay: false,
                        slots: nextSlots,
                        focusMuscles: deriveFocusMuscles(nextSlots, exercises),
                      };
                    });
                  }}
                  className="btn !min-h-[44px] shrink-0"
                >
                  <Plus className="w-4 h-4" /> Add Slot
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save Schedule Button */}
        <button
          type="button"
          disabled={saving}
          onClick={handleSaveSchedule}
          className="btn big w-full"
        >
          <Save className="w-5 h-5" />
          {saving ? 'SAVING WEEKLY SPLIT...' : 'SAVE WEEKLY SCHEDULE'}
        </button>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div className="sheet-backdrop flex items-end justify-center" onClick={onClose}>
        <div
          className="sheet-panel max-w-xl mx-auto w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      </div>
    );
  }

  return content;
}
