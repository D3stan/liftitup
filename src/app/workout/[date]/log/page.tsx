'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Plus,
  RotateCcw,
  Sparkles,
  StickyNote,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Exercise,
  ExercisePrefill,
  WeightUnit,
  WorkoutSession,
} from '@/types/domain';
import {
  ApiClientError,
  apiFetch,
  Button,
  Sheet,
  toast,
} from '@/components/ui';
import type { WorkoutDayViewResponse } from '@/lib/workouts/types';
import {
  clearWorkoutDraft,
  generateCid,
  loadWorkoutDraft,
  saveWorkoutDraft,
} from '@/lib/offline/outbox';
import ExerciseLoggerCard from '@/components/workout/ExerciseLoggerCard';
import ExercisePickerSheet from '@/components/workout/ExercisePickerSheet';
import FloatingRestTimer from '@/components/workout/FloatingRestTimer';
import VariationSwapSheet from '@/components/workout/VariationSwapSheet';
import {
  buildPrefilledSets,
  displayToKg,
  formatDisplayDate,
  kgToDisplay,
  localTodayYmd,
  makeLocalId,
  parseOptionalInt,
  parseOptionalNum,
  type LoggerExercise,
  type LoggerSet,
  type WorkoutDraft,
} from '@/components/workout/trackingFormat';

function sessionToDraft(
  session: WorkoutSession,
  unit: WeightUnit,
): WorkoutDraft {
  return {
    cid: session.cid ?? generateCid(),
    title: session.title,
    notes: session.notes,
    isJolly: session.isJolly,
    jollyMode: session.jollyMode,
    startedAt: session.startedAt,
    updatedAt: new Date().toISOString(),
    exercises: session.exercises.map((ex) => ({
      localId: makeLocalId('ex'),
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName ?? ex.exerciseId,
      trackingType: ex.trackingType ?? 'weight_reps',
      defaultRestSeconds: ex.sets[0]?.restSeconds ?? 120,
      scheduleDayExerciseId: null,
      notes: ex.notes,
      sets: ex.sets.map((s, idx) => {
        const w = kgToDisplay(s.weightKg, unit);
        return {
          localId: makeLocalId('set'),
          setNumber: idx + 1,
          weightDisplay: w !== null ? String(w) : '',
          reps: s.reps !== null ? String(s.reps) : '',
          timeSeconds: s.timeSeconds !== null ? String(s.timeSeconds) : '',
          distanceM: s.distanceM !== null ? String(s.distanceM) : '',
          restSeconds: s.restSeconds,
          executionQualityPct: s.executionQualityPct,
          repQualities:
            s.repQualities?.map((rq) => ({
              repIndex: rq.repIndex,
              qualityPct: rq.qualityPct,
            })) ?? [],
          isCompleted: s.isCompleted,
        };
      }),
    })),
  };
}

function buildInitialDraft(params: {
  dayView: WorkoutDayViewResponse;
  jollyParam: string | null;
  editSession: WorkoutSession | null;
}): WorkoutDraft {
  const { dayView, jollyParam, editSession } = params;
  const unit = dayView.user.unit;

  if (editSession) {
    return sessionToDraft(editSession, unit);
  }

  const plannedDay = dayView.calendarDay.plannedDay;
  const forceJolly =
    jollyParam === 'extra' ||
    jollyParam === 'instead' ||
    !plannedDay ||
    plannedDay.isRestDay;

  if (forceJolly) {
    return {
      cid: generateCid(),
      title: 'Jolly Workout',
      notes: '',
      isJolly: true,
      jollyMode: jollyParam === 'instead' ? 'instead' : 'extra',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: [],
    };
  }

  return {
    cid: generateCid(),
    title: plannedDay.label,
    notes: '',
    isJolly: false,
    jollyMode: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exercises: plannedDay.exercises.map((slot) => {
      const t = slot.trackingType ?? 'weight_reps';
      const prefill = dayView.prefillByExerciseId[slot.exerciseId] ?? null;
      return {
        localId: makeLocalId('ex'),
        exerciseId: slot.exerciseId,
        exerciseName: slot.exerciseName ?? slot.exerciseId,
        trackingType: t,
        defaultRestSeconds: slot.restSeconds,
        scheduleDayExerciseId: slot.id,
        notes: slot.notes ?? '',
        sets: buildPrefilledSets({
          targetSets: slot.targetSets,
          trackingType: t,
          unit,
          prefill,
          slot,
        }),
      };
    }),
  };
}

function WorkoutLoggerInner() {
  const params = useParams<{ date: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const date = params.date;
  const sessionId = searchParams.get('sessionId');
  const jollyParam = searchParams.get('jolly');

  const draftKey = useMemo(
    () =>
      sessionId
        ? `edit:${sessionId}`
        : `new:${date}:${jollyParam ?? 'planned'}`,
    [date, sessionId, jollyParam],
  );

  const [dayView, setDayView] = useState<WorkoutDayViewResponse | null>(null);
  const [exercisesCatalog, setExercisesCatalog] = useState<Exercise[]>([]);
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapTargetIdx, setSwapTargetIdx] = useState<number | null>(null);

  const [timerEndMs, setTimerEndMs] = useState<number | null>(null);
  const [timerTotalSec, setTimerTotalSec] = useState<number>(120);
  const [timerLabel, setTimerLabel] = useState<string>('');
  const [timerPickerOpen, setTimerPickerOpen] = useState(false);

  const loadData = useCallback(
    async (ignoreSavedDraft = false) => {
      setLoading(true);
      try {
        const today = localTodayYmd();
        const [dayRes, exRes] = await Promise.all([
          apiFetch<WorkoutDayViewResponse>(
            `/api/workouts/${encodeURIComponent(date)}?today=${encodeURIComponent(today)}`,
          ),
          apiFetch<{ exercises: Exercise[] }>('/api/workouts/exercises'),
        ]);

        let editSession: WorkoutSession | null = null;
        if (sessionId) {
          editSession =
            dayRes.sessions.find((s) => s.id === sessionId) ?? null;
          if (!editSession) {
            const single = await apiFetch<{ session: WorkoutSession }>(
              `/api/workouts/sessions/${encodeURIComponent(sessionId)}`,
            );
            editSession = single.session;
          }
        }

        setDayView(dayRes);
        setExercisesCatalog(exRes.exercises);

        const existingDraft = !ignoreSavedDraft
          ? loadWorkoutDraft<WorkoutDraft>(draftKey)
          : null;

        if (existingDraft && Array.isArray(existingDraft.exercises)) {
          setDraft(existingDraft);
          setRestoredFromStorage(true);
          setNoteOpen(existingDraft.notes.trim().length > 0);
        } else {
          const fresh = buildInitialDraft({
            dayView: dayRes,
            jollyParam,
            editSession,
          });
          setDraft(fresh);
          setRestoredFromStorage(false);
          setNoteOpen(fresh.notes.trim().length > 0);
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/welcome');
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [date, draftKey, jollyParam, router, sessionId],
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Persist draft automatically
  useEffect(() => {
    if (!draft) return;
    saveWorkoutDraft(draftKey, {
      ...draft,
      updatedAt: new Date().toISOString(),
    });
  }, [draft, draftKey]);

  const updateDraft = (updater: (prev: WorkoutDraft) => WorkoutDraft) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    updateDraft((prev) => {
      const next = [...prev.exercises];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return { ...prev, exercises: next };
    });
  };

  const handleMoveDown = (index: number) => {
    updateDraft((prev) => {
      if (index >= prev.exercises.length - 1) return prev;
      const next = [...prev.exercises];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return { ...prev, exercises: next };
    });
  };

  const handleDeleteExercise = (index: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== index),
    }));
  };

  const handleChangeExNotes = (index: number, notes: string) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i === index ? { ...ex, notes } : ex,
      ),
    }));
  };

  const handleUpdateSet = (
    exIndex: number,
    setIndex: number,
    patch: Partial<LoggerSet>,
  ) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIndex ? { ...s, ...patch } : s,
          ),
        };
      }),
    }));
  };

  const handleAddSet = (exIndex: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const nextSet: LoggerSet = {
          localId: makeLocalId('set'),
          setNumber: ex.sets.length + 1,
          weightDisplay: last?.weightDisplay ?? '',
          reps: last?.reps ?? '',
          timeSeconds: last?.timeSeconds ?? '',
          distanceM: last?.distanceM ?? '',
          restSeconds: last?.restSeconds ?? ex.defaultRestSeconds,
          executionQualityPct: null,
          repQualities: [],
          isCompleted: false,
        };
        return { ...ex, sets: [...ex.sets, nextSet] };
      }),
    }));
  };

  const handleRemoveSet = (exIndex: number, setIndex: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex || ex.sets.length <= 1) return ex;
        const filtered = ex.sets
          .filter((_, j) => j !== setIndex)
          .map((s, idx) => ({ ...s, setNumber: idx + 1 }));
        return { ...ex, sets: filtered };
      }),
    }));
  };

  const handleCheckAll = (exIndex: number) => {
    if (!draft) return;
    const ex = draft.exercises[exIndex];
    if (!ex) return;
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((item, i) =>
        i === exIndex
          ? {
              ...item,
              sets: item.sets.map((s) => ({ ...s, isCompleted: true })),
            }
          : item,
      ),
    }));
    startRestTimer(ex.defaultRestSeconds, ex.exerciseName);
  };

  const handleAddExercise = async (ex: Exercise) => {
    if (!dayView) return;
    let prefill: ExercisePrefill | null =
      dayView.prefillByExerciseId[ex.id] ?? null;

    if (!prefill) {
      try {
        const res = await apiFetch<{
          prefillByExerciseId: Record<string, ExercisePrefill>;
        }>(
          `/api/workouts/prefill?exerciseIds=${encodeURIComponent(ex.id)}&beforeDate=${encodeURIComponent(date)}`,
        );
        prefill = res.prefillByExerciseId[ex.id] ?? null;
      } catch {
        // Fallback to empty prefill
      }
    }

    const newExercise: LoggerExercise = {
      localId: makeLocalId('ex'),
      exerciseId: ex.id,
      exerciseName: ex.name,
      trackingType: ex.trackingType,
      defaultRestSeconds: ex.defaultRestSeconds,
      scheduleDayExerciseId: null,
      notes: '',
      sets: buildPrefilledSets({
        targetSets: prefill?.sets.length ?? 3,
        trackingType: ex.trackingType,
        unit: dayView.user.unit,
        prefill,
      }),
    };

    updateDraft((prev) => ({
      ...prev,
      exercises: [...prev.exercises, newExercise],
    }));
  };

  const handleSwapComplete = (
    toExercise: Exercise,
    prefill: ExercisePrefill | null,
  ) => {
    if (swapTargetIdx === null || !dayView) return;
    const targetIdx = swapTargetIdx;

    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== targetIdx) return ex;
        return {
          ...ex,
          exerciseId: toExercise.id,
          exerciseName: toExercise.name,
          trackingType: toExercise.trackingType,
          defaultRestSeconds: toExercise.defaultRestSeconds,
          sets: buildPrefilledSets({
            targetSets: ex.sets.length,
            trackingType: toExercise.trackingType,
            unit: dayView.user.unit,
            prefill,
          }),
        };
      }),
    }));
  };

  const startRestTimer = (seconds: number, label = '') => {
    const safeSec = Math.max(5, Math.round(seconds || 90));
    setTimerPickerOpen(false);
    setTimerTotalSec(safeSec);
    setTimerLabel(label);
    setTimerEndMs(Date.now() + safeSec * 1000);
  };

  const adjustRestTimer = (deltaSeconds: number) => {
    setTimerEndMs((prev) => {
      if (!prev) return null;
      const next = Math.max(Date.now(), prev + deltaSeconds * 1000);
      return next;
    });
    if (deltaSeconds > 0) {
      setTimerTotalSec((prev) => Math.max(15, prev + deltaSeconds));
    }
  };

  const handleSave = async () => {
    if (!draft || !dayView) return;

    const title = draft.title.trim();
    if (!title) {
      toast.error('Title is required');
      return;
    }

    if (draft.exercises.length === 0) {
      toast.error('Add at least 1 exercise');
      return;
    }

    const unit = dayView.user.unit;
    const exercisesPayload = draft.exercises
      .map((ex, exIdx) => {
        const completedSets = ex.sets.filter((s) => s.isCompleted);
        return {
          exerciseId: ex.exerciseId,
          orderIndex: exIdx,
          notes: ex.notes.trim(),
          sets: completedSets.map((s, sIdx) => ({
            setNumber: sIdx + 1,
            weightKg: displayToKg(parseOptionalNum(s.weightDisplay), unit),
            reps: parseOptionalInt(s.reps),
            timeSeconds: parseOptionalInt(s.timeSeconds),
            distanceM: parseOptionalNum(s.distanceM),
            restSeconds: s.restSeconds ?? ex.defaultRestSeconds,
            executionQualityPct: dayView.user.enableSetQuality
              ? s.executionQualityPct
              : null,
            isCompleted: true,
            repQualities: dayView.user.enableSetQuality ? s.repQualities : [],
          })),
        };
      })
      .filter((ex) => ex.sets.length > 0);

    if (exercisesPayload.length === 0) {
      toast.error('Complete at least 1 set');
      return;
    }

    setSaving(true);
    try {
      if (sessionId) {
        await apiFetch(`/api/workouts/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            sessionDate: date,
            isJolly: draft.isJolly,
            jollyMode: draft.isJolly ? draft.jollyMode ?? 'extra' : null,
            title,
            notes: draft.notes.trim(),
            exercises: exercisesPayload,
          }),
        });
        toast.success('Workout updated');
      } else {
        const elapsedMin = Math.max(
          1,
          Math.round((Date.now() - Date.parse(draft.startedAt)) / 60000),
        );
        const scheduleDayId =
          !draft.isJolly && dayView.calendarDay.plannedDay
            ? dayView.calendarDay.plannedDay.id
            : null;

        await apiFetch('/api/workouts/sessions', {
          method: 'POST',
          body: JSON.stringify({
            sessionDate: date,
            scheduleDayId,
            isJolly: draft.isJolly,
            jollyMode: draft.isJolly ? draft.jollyMode ?? 'extra' : null,
            title,
            startedAt: draft.startedAt,
            completedAt: new Date().toISOString(),
            durationMinutes: Number.isFinite(elapsedMin) ? elapsedMin : null,
            userWeightKg: dayView.user.weightKg,
            notes: draft.notes.trim(),
            cid: draft.cid,
            exercises: exercisesPayload,
          }),
        });
        toast.success('Workout saved');
      }

      clearWorkoutDraft(draftKey);
      router.push(`/workout/${encodeURIComponent(date)}`);
    } catch (err) {
      // Never swallow errors into an outbox loop: surface exact server message
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!sessionId) return;
    setDeleting(true);
    try {
      await apiFetch(
        `/api/workouts/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      clearWorkoutDraft(draftKey);
      toast.success('Workout deleted');
      router.push(`/workout/${encodeURIComponent(date)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  if (loading || !draft || !dayView) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 pb-32 pt-4">
        <div className="card h-24 animate-pulse bg-[#fbedba]/50" />
        <div className="card h-56 animate-pulse" />
      </main>
    );
  }

  const swapExercise =
    swapTargetIdx !== null ? draft.exercises[swapTargetIdx] ?? null : null;
  const canOfferInstead = Boolean(
    dayView.calendarDay.plannedDay &&
      !dayView.calendarDay.plannedDay.isRestDay,
  );
  const completedSetsTotal = draft.exercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => s.isCompleted).length,
    0,
  );

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 pb-36 pt-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/workout/${encodeURIComponent(date)}`}
          className="btn alt !min-h-[44px] !px-3 text-base"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <span className="pill text-sm">{formatDisplayDate(date)}</span>
          <button
            type="button"
            onClick={() => {
              if (timerEndMs) {
                setTimerEndMs(null);
                setTimerPickerOpen(false);
              } else {
                setTimerPickerOpen((v) => !v);
              }
            }}
            aria-label="Rest timer"
            className="btn alt icon !h-[44px] !w-[44px]"
          >
            <Timer className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Restored Draft Pill */}
      {restoredFromStorage && (
        <div className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-[#1d1a16] bg-[#fbedba] px-3 py-2 text-sm font-bold">
          <span>Draft restored</span>
          <button
            type="button"
            onClick={() => {
              clearWorkoutDraft(draftKey);
              loadData(true);
            }}
            className="inline-flex items-center gap-1 underline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
        </div>
      )}

      {/* Session Title + Jolly Mode + Optional Workout Note */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft.title}
            onChange={(e) =>
              updateDraft((prev) => ({ ...prev, title: e.target.value }))
            }
            placeholder="Workout title"
            aria-label="Workout title"
            className="min-h-[44px] flex-1 rounded-[8px] border-[2.5px] border-[#1d1a16] bg-[#ece2c6]/60 px-3 font-marker text-xl outline-none focus:bg-white"
          />
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
        </div>

        {draft.isJolly && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill gold text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Jolly
            </span>
            <button
              type="button"
              onClick={() =>
                updateDraft((prev) => ({ ...prev, jollyMode: 'extra' }))
              }
              className={`pill min-h-[36px] cursor-pointer text-xs ${
                draft.jollyMode !== 'instead' ? 'gold' : ''
              }`}
            >
              Extra
            </button>
            {canOfferInstead && (
              <button
                type="button"
                onClick={() =>
                  updateDraft((prev) => ({ ...prev, jollyMode: 'instead' }))
                }
                className={`pill min-h-[36px] cursor-pointer text-xs ${
                  draft.jollyMode === 'instead' ? 'gold' : ''
                }`}
              >
                Instead of {dayView.calendarDay.plannedDay?.label}
              </button>
            )}
          </div>
        )}

        {(noteOpen || draft.notes.trim().length > 0) && (
          <div className="note space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-[#5d5446]">
                Workout Note
              </span>
              {draft.notes.trim().length === 0 && (
                <button
                  type="button"
                  onClick={() => setNoteOpen(false)}
                  aria-label="Close empty workout note"
                  className="flex h-7 w-7 items-center justify-center rounded border border-[#1d1a16]/40 bg-[#fbf5e4]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <textarea
              rows={2}
              value={draft.notes}
              onChange={(e) =>
                updateDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Workout note..."
              className="w-full resize-none rounded-[6px] border-2 border-[#1d1a16] bg-[#fbf5e4] px-2.5 py-1.5 text-base font-bold outline-none"
            />
          </div>
        )}
      </section>

      {/* Exercises */}
      <div className="space-y-3">
        {draft.exercises.map((ex, idx) => (
          <ExerciseLoggerCard
            key={ex.localId}
            exercise={ex}
            index={idx}
            totalCount={draft.exercises.length}
            unit={dayView.user.unit}
            enableSetQuality={dayView.user.enableSetQuality}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onDeleteExercise={handleDeleteExercise}
            onOpenSwap={(i) => setSwapTargetIdx(i)}
            onChangeNotes={handleChangeExNotes}
            onUpdateSet={handleUpdateSet}
            onAddSet={handleAddSet}
            onRemoveSet={handleRemoveSet}
            onCheckAll={handleCheckAll}
            onStartRestTimer={startRestTimer}
          />
        ))}

        {draft.exercises.length === 0 && (
          <div className="card py-6 text-center font-bold text-[#5d5446]">
            No exercises yet
          </div>
        )}

        <Button
          variant="alt"
          className="w-full"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="h-5 w-5" />
          <span>Add exercise</span>
        </Button>
      </div>

      {/* Save & Delete Actions */}
      <div className="space-y-2 pt-2">
        <Button
          variant="primary"
          size="big"
          loading={saving}
          onClick={handleSave}
          className="w-full"
        >
          <Check className="h-5 w-5" />
          <span>
            {sessionId
              ? 'Save changes'
              : `Finish workout (${completedSetsTotal} sets)`}
          </span>
        </Button>

        {sessionId && (
          <Button
            variant="red"
            onClick={() => setConfirmDeleteOpen(true)}
            className="w-full"
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete workout</span>
          </Button>
        )}
      </div>

      {/* Sheets & Timer */}
      <ExercisePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exercises={exercisesCatalog}
        onSelect={handleAddExercise}
      />

      {swapExercise && (
        <VariationSwapSheet
          open={swapTargetIdx !== null}
          onClose={() => setSwapTargetIdx(null)}
          dateKey={date}
          unit={dayView.user.unit}
          currentExerciseId={swapExercise.exerciseId}
          currentExerciseName={swapExercise.exerciseName}
          scheduleDayExerciseId={swapExercise.scheduleDayExerciseId}
          allowScheduleScope={!sessionId && Boolean(swapExercise.scheduleDayExerciseId)}
          exercises={exercisesCatalog}
          prefillByExerciseId={dayView.prefillByExerciseId}
          onSwapComplete={handleSwapComplete}
        />
      )}

      <FloatingRestTimer
        endTimeMs={timerEndMs}
        totalSeconds={timerTotalSec}
        label={timerLabel}
        isExpandedPicker={timerPickerOpen}
        onAdjustSeconds={adjustRestTimer}
        onStartPreset={startRestTimer}
        onDismiss={() => {
          setTimerEndMs(null);
          setTimerPickerOpen(false);
        }}
      />

      <Sheet
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete Workout?"
      >
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="alt"
            onClick={() => setConfirmDeleteOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="red"
            loading={deleting}
            onClick={handleDeleteSession}
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </main>
  );
}

export default function WorkoutLogPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-xl space-y-4 px-4 pb-32 pt-4">
          <div className="card h-24 animate-pulse bg-[#fbedba]/50" />
          <div className="card h-56 animate-pulse" />
        </main>
      }
    >
      <WorkoutLoggerInner />
    </Suspense>
  );
}
