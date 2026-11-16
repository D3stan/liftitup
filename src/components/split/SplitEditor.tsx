'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { ApiClientError, Button, apiFetch, toast } from '@/components/ui';
import type {
  Exercise,
  RotationSchedule,
  ScheduleDayExercise,
  TrackingType,
  UserProfile,
  WeightUnit,
} from '@/types/domain';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import {
  TRACKING_TYPE_LABEL,
  getLocalTodayIso,
  kgToUnit,
  unitToKg,
} from './formatTarget';

interface DraftExercise {
  localKey: string;
  id?: string;
  exerciseId: string;
  exerciseName: string;
  trackingType: TrackingType;
  targetSets: string;
  repsMin: string;
  repsMax: string;
  timeSeconds: string;
  weight: string;
  distanceM: string;
  restSeconds: string;
  notes: string;
}

interface DraftDay {
  localKey: string;
  id?: string;
  label: string;
  isRestDay: boolean;
  exercises: DraftExercise[];
}

function makeKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toDraftExercise(
  ex: ScheduleDayExercise,
  unit: WeightUnit,
): DraftExercise {
  const hasRange = ex.targetRepsMin !== null || ex.targetRepsMax !== null;
  return {
    localKey: makeKey('ex'),
    id: ex.id,
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName ?? 'Exercise',
    trackingType: ex.trackingType ?? 'weight_reps',
    targetSets: String(ex.targetSets),
    repsMin: hasRange
      ? ex.targetRepsMin !== null
        ? String(ex.targetRepsMin)
        : ''
      : ex.targetReps !== null
        ? String(ex.targetReps)
        : '',
    repsMax:
      hasRange && ex.targetRepsMax !== null ? String(ex.targetRepsMax) : '',
    timeSeconds:
      ex.targetTimeSeconds !== null ? String(ex.targetTimeSeconds) : '',
    weight:
      ex.targetWeightKg !== null
        ? String(kgToUnit(ex.targetWeightKg, unit))
        : '',
    distanceM: ex.targetDistanceM !== null ? String(ex.targetDistanceM) : '',
    restSeconds: String(ex.restSeconds),
    notes: ex.notes ?? '',
  };
}

function createDraftFromExercise(ex: Exercise): DraftExercise {
  const type = ex.trackingType;
  const usesReps =
    type === 'weight_reps' ||
    type === 'bodyweight_reps' ||
    type === 'weighted_bodyweight' ||
    type === 'assisted_bodyweight';
  const usesTime =
    type === 'time' || type === 'weight_time' || type === 'distance_time';
  const usesDist = type === 'distance' || type === 'distance_time';

  return {
    localKey: makeKey('ex'),
    exerciseId: ex.id,
    exerciseName: ex.name,
    trackingType: type,
    targetSets: '3',
    repsMin: usesReps ? '8' : '',
    repsMax: usesReps ? '12' : '',
    timeSeconds: usesTime ? '30' : '',
    weight: '',
    distanceM: usesDist ? '100' : '',
    restSeconds: String(ex.defaultRestSeconds ?? 120),
    notes: '',
  };
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function parseOptionalNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const INPUT_CLS =
  'w-full min-h-[44px] rounded-[8px_10px_8px_10px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-[16px] text-[var(--ink)] outline-none focus:bg-[var(--surface)]';

export function SplitEditor() {
  const router = useRouter();
  const [name, setName] = useState('My Split');
  const [days, setDays] = useState<DraftDay[]>([]);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerDayKey, setPickerDayKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, meRes] = await Promise.all([
        apiFetch<{ schedule: RotationSchedule | null }>('/api/schedule'),
        apiFetch<{ user: UserProfile }>('/api/auth/me'),
      ]);
      const userUnit = meRes.user.unit;
      setUnit(userUnit);

      if (schedRes.schedule && schedRes.schedule.days.length > 0) {
        setName(schedRes.schedule.name || 'My Split');
        setDays(
          schedRes.schedule.days.map((d) => ({
            localKey: makeKey('day'),
            id: d.id,
            label: d.label,
            isRestDay: d.isRestDay,
            exercises: d.exercises.map((ex) => toDraftExercise(ex, userUnit)),
          })),
        );
      } else {
        setName('My Split');
        setDays([
          {
            localKey: makeKey('day'),
            label: 'Day 1',
            isRestDay: false,
            exercises: [],
          },
        ]);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      toast.error(
        err instanceof Error ? err.message : 'Failed to load split',
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const addDay = () => {
    setDays((prev) => [
      ...prev,
      {
        localKey: makeKey('day'),
        label: `Day ${prev.length + 1}`,
        isRestDay: false,
        exercises: [],
      },
    ]);
  };

  const removeDay = (dayKey: string) => {
    setDays((prev) => {
      if (prev.length <= 1) {
        toast.error('Keep at least 1 day');
        return prev;
      }
      return prev.filter((d) => d.localKey !== dayKey);
    });
  };

  const moveDay = (idx: number, delta: -1 | 1) => {
    setDays((prev) => moveItem(prev, idx, idx + delta));
  };

  const updateDay = (dayKey: string, patch: Partial<DraftDay>) => {
    setDays((prev) =>
      prev.map((d) => (d.localKey === dayKey ? { ...d, ...patch } : d)),
    );
  };

  const addExerciseToDay = (dayKey: string, exercise: Exercise) => {
    const draft = createDraftFromExercise(exercise);
    setDays((prev) =>
      prev.map((d) =>
        d.localKey === dayKey
          ? { ...d, isRestDay: false, exercises: [...d.exercises, draft] }
          : d,
      ),
    );
  };

  const removeExercise = (dayKey: string, exKey: string) => {
    setDays((prev) =>
      prev.map((d) =>
        d.localKey === dayKey
          ? {
              ...d,
              exercises: d.exercises.filter((e) => e.localKey !== exKey),
            }
          : d,
      ),
    );
  };

  const moveExercise = (dayKey: string, exIdx: number, delta: -1 | 1) => {
    setDays((prev) =>
      prev.map((d) =>
        d.localKey === dayKey
          ? { ...d, exercises: moveItem(d.exercises, exIdx, exIdx + delta) }
          : d,
      ),
    );
  };

  const updateExercise = (
    dayKey: string,
    exKey: string,
    patch: Partial<DraftExercise>,
  ) => {
    setDays((prev) =>
      prev.map((d) =>
        d.localKey === dayKey
          ? {
              ...d,
              exercises: d.exercises.map((e) =>
                e.localKey === exKey ? { ...e, ...patch } : e,
              ),
            }
          : d,
      ),
    );
  };

  const handleSave = async () => {
    if (saving) return;

    const payloadDays = days.map((d) => ({
      ...(d.id ? { id: d.id } : {}),
      label: d.label.trim(),
      isRestDay: d.isRestDay,
      exercises: d.isRestDay
        ? []
        : d.exercises.map((ex) => {
            const minVal = parseOptionalNum(ex.repsMin);
            const maxVal = parseOptionalNum(ex.repsMax);
            let targetReps: number | null = null;
            let targetRepsMin: number | null = null;
            let targetRepsMax: number | null = null;

            if (minVal !== null && maxVal !== null) {
              if (minVal === maxVal) {
                targetReps = minVal;
              } else {
                targetRepsMin = minVal;
                targetRepsMax = maxVal;
              }
            } else if (minVal !== null) {
              targetReps = minVal;
            } else if (maxVal !== null) {
              targetReps = maxVal;
            }

            const rawWeight = parseOptionalNum(ex.weight);
            const targetWeightKg =
              rawWeight !== null ? unitToKg(rawWeight, unit) : null;

            return {
              ...(ex.id ? { id: ex.id } : {}),
              exerciseId: ex.exerciseId,
              targetSets: parseOptionalNum(ex.targetSets) ?? 3,
              targetReps,
              targetRepsMin,
              targetRepsMax,
              targetTimeSeconds: parseOptionalNum(ex.timeSeconds),
              targetWeightKg,
              targetDistanceM: parseOptionalNum(ex.distanceM),
              restSeconds: parseOptionalNum(ex.restSeconds) ?? 120,
              notes: ex.notes.trim(),
            };
          }),
    }));

    setSaving(true);
    try {
      await apiFetch('/api/schedule', {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim() || 'My Split',
          today: getLocalTodayIso(),
          days: payloadDays,
        }),
      });
      toast.success('Split saved');
      router.push('/split');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save split');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="card text-center text-[var(--muted)]">Loading…</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/split" className="btn alt">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>

      <div className="card space-y-2">
        <label className="block text-sm font-bold text-[var(--muted)]">
          Split name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Split"
            className={`${INPUT_CLS} mt-1 font-marker text-lg`}
          />
        </label>
      </div>

      <div className="space-y-4">
        {days.map((day, dayIdx) => (
          <section key={day.localKey} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-[6px_8px_6px_8px] border-2 border-[var(--line)] bg-[var(--gold)] px-1.5 font-marker text-sm text-[var(--btn-gold-fg)]">
                {dayIdx + 1}
              </span>
              <input
                type="text"
                value={day.label}
                onChange={(e) =>
                  updateDay(day.localKey, { label: e.target.value })
                }
                placeholder={`Day ${dayIdx + 1}`}
                aria-label={`Day ${dayIdx + 1} label`}
                className={`${INPUT_CLS} min-w-[140px] flex-1 font-bold`}
              />
              <Button
                variant={day.isRestDay ? 'blue' : 'alt'}
                onClick={() =>
                  updateDay(day.localKey, { isRestDay: !day.isRestDay })
                }
              >
                {day.isRestDay ? 'Rest day' : 'Train'}
              </Button>
              <Button
                variant="alt"
                size="icon"
                aria-label="Move day up"
                disabled={dayIdx === 0}
                onClick={() => moveDay(dayIdx, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="alt"
                size="icon"
                aria-label="Move day down"
                disabled={dayIdx === days.length - 1}
                onClick={() => moveDay(dayIdx, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="red"
                size="icon"
                aria-label="Remove day"
                onClick={() => removeDay(day.localKey)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {!day.isRestDay && (
              <div className="space-y-3 pt-1">
                {day.exercises.map((ex, exIdx) => {
                  const type = ex.trackingType;
                  const showReps =
                    type === 'weight_reps' ||
                    type === 'bodyweight_reps' ||
                    type === 'weighted_bodyweight' ||
                    type === 'assisted_bodyweight';
                  const showWeight =
                    type === 'weight_reps' ||
                    type === 'weighted_bodyweight' ||
                    type === 'assisted_bodyweight' ||
                    type === 'weight_time';
                  const showTime =
                    type === 'time' ||
                    type === 'weight_time' ||
                    type === 'distance_time';
                  const showDist =
                    type === 'distance' || type === 'distance_time';

                  const weightLabel =
                    type === 'weighted_bodyweight'
                      ? `+Weight (${unit})`
                      : type === 'assisted_bodyweight'
                        ? `−Assist (${unit})`
                        : `Weight (${unit})`;

                  return (
                    <div
                      key={ex.localKey}
                      className="space-y-2.5 rounded-[10px_12px_10px_12px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold leading-snug text-[var(--ink)]">
                            {ex.exerciseName}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {TRACKING_TYPE_LABEL[type]}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="alt"
                            size="icon"
                            aria-label="Move exercise up"
                            disabled={exIdx === 0}
                            onClick={() => moveExercise(day.localKey, exIdx, -1)}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="alt"
                            size="icon"
                            aria-label="Move exercise down"
                            disabled={exIdx === day.exercises.length - 1}
                            onClick={() => moveExercise(day.localKey, exIdx, 1)}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="red"
                            size="icon"
                            aria-label="Remove exercise"
                            onClick={() => removeExercise(day.localKey, ex.localKey)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <label className="block text-xs font-bold text-[var(--muted)]">
                          Sets
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            value={ex.targetSets}
                            onChange={(e) =>
                              updateExercise(day.localKey, ex.localKey, {
                                targetSets: e.target.value,
                              })
                            }
                            className={`${INPUT_CLS} mt-0.5`}
                          />
                        </label>

                        {showReps && (
                          <>
                            <label className="block text-xs font-bold text-[var(--muted)]">
                              Reps / Min
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={1000}
                                placeholder="8"
                                value={ex.repsMin}
                                onChange={(e) =>
                                  updateExercise(day.localKey, ex.localKey, {
                                    repsMin: e.target.value,
                                  })
                                }
                                className={`${INPUT_CLS} mt-0.5`}
                              />
                            </label>
                            <label className="block text-xs font-bold text-[var(--muted)]">
                              Max reps
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={1000}
                                placeholder="—"
                                value={ex.repsMax}
                                onChange={(e) =>
                                  updateExercise(day.localKey, ex.localKey, {
                                    repsMax: e.target.value,
                                  })
                                }
                                className={`${INPUT_CLS} mt-0.5`}
                              />
                            </label>
                          </>
                        )}

                        {showWeight && (
                          <label className="block text-xs font-bold text-[var(--muted)]">
                            {weightLabel}
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              min={0}
                              max={2000}
                              placeholder="—"
                              value={ex.weight}
                              onChange={(e) =>
                                updateExercise(day.localKey, ex.localKey, {
                                  weight: e.target.value,
                                })
                              }
                              className={`${INPUT_CLS} mt-0.5`}
                            />
                          </label>
                        )}

                        {showTime && (
                          <label className="block text-xs font-bold text-[var(--muted)]">
                            Time (s)
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={86400}
                              placeholder="30"
                              value={ex.timeSeconds}
                              onChange={(e) =>
                                updateExercise(day.localKey, ex.localKey, {
                                  timeSeconds: e.target.value,
                                })
                              }
                              className={`${INPUT_CLS} mt-0.5`}
                            />
                          </label>
                        )}

                        {showDist && (
                          <label className="block text-xs font-bold text-[var(--muted)]">
                            Dist (m)
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={1000000}
                              placeholder="100"
                              value={ex.distanceM}
                              onChange={(e) =>
                                updateExercise(day.localKey, ex.localKey, {
                                  distanceM: e.target.value,
                                })
                              }
                              className={`${INPUT_CLS} mt-0.5`}
                            />
                          </label>
                        )}

                        <label className="block text-xs font-bold text-[var(--muted)]">
                          Rest (s)
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={600}
                            value={ex.restSeconds}
                            onChange={(e) =>
                              updateExercise(day.localKey, ex.localKey, {
                                restSeconds: e.target.value,
                              })
                            }
                            className={`${INPUT_CLS} mt-0.5`}
                          />
                        </label>
                      </div>

                      <input
                        type="text"
                        value={ex.notes}
                        onChange={(e) =>
                          updateExercise(day.localKey, ex.localKey, {
                            notes: e.target.value,
                          })
                        }
                        placeholder="Notes (optional)"
                        className={INPUT_CLS}
                      />
                    </div>
                  );
                })}

                <Button
                  variant="alt"
                  className="w-full"
                  onClick={() => setPickerDayKey(day.localKey)}
                >
                  <Plus className="h-4 w-4" />
                  Add exercise
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>

      <Button variant="green" className="w-full" onClick={addDay}>
        <Plus className="h-4 w-4" />
        Add day
      </Button>

      <ExercisePickerSheet
        open={pickerDayKey !== null}
        onClose={() => setPickerDayKey(null)}
        onSelect={(ex) => {
          if (pickerDayKey) addExerciseToDay(pickerDayKey, ex);
        }}
      />
    </div>
  );
}
