'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Clock,
  Play,
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
  adoptLegacyWorkoutDrafts,
  clearUserWorkoutDraft,
  generateCid,
  loadUserWorkoutDraft,
  saveUserWorkoutDraft,
} from '@/lib/offline/outbox';
import ExerciseLoggerCard from '@/components/workout/ExerciseLoggerCard';
import ExercisePickerSheet from '@/components/workout/ExercisePickerSheet';
import FloatingRestTimer from '@/components/workout/FloatingRestTimer';
import VariationSwapSheet from '@/components/workout/VariationSwapSheet';
import {
  adjustRestClockTarget,
  computeSessionDurationMinutes,
  computeSessionElapsedSeconds,
  createRestClock,
  dismissRestClock,
  formatClockSeconds,
  resolveSessionStart,
  stopRestClock,
} from '@/lib/workouts/clock';
import {
  computeActualRestForWorkoutSets,
  getLastTimeRestForCompletedSet,
} from '@/lib/workouts/rest';
import { resolveDisplayWeightStep } from '@/lib/workouts/stepSize';
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

function isValidYmdString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isoToLocalTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function combineDateAndLocalTimeToIso(
  ymd: string,
  hhmm: string,
): string | null {
  const dMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  const tMatch = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!dMatch || !tMatch) return null;
  const dt = new Date(
    Number(dMatch[1]),
    Number(dMatch[2]) - 1,
    Number(dMatch[3]),
    Number(tMatch[1]),
    Number(tMatch[2]),
    0,
    0,
  );
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

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
    sessionDate: session.sessionDate,
    durationMinutes:
      session.durationMinutes !== null ? String(session.durationMinutes) : '',
    startedAt: session.startedAt,
    sessionStartSource: null,
    completionSeqCounter: 0,
    restClock: null,
    updatedAt: new Date().toISOString(),
    exercises: session.exercises.map((ex) => ({
      localId: makeLocalId('ex'),
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName ?? ex.exerciseId,
      trackingType: ex.trackingType ?? 'weight_reps',
      defaultRestSeconds:
        ex.sets.find((s) => !s.isWarmup && s.restSeconds !== null)
          ?.restSeconds ?? 120,
      scheduleDayExerciseId: null,
      swappedFromExerciseId: null,
      swappedFromExerciseName: null,
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
          restSeconds: s.isWarmup ? null : s.restSeconds,
          restSecondsDisplay:
            !s.isWarmup && s.restSeconds !== null ? String(s.restSeconds) : '',
          actualRestSeconds: s.isWarmup ? null : s.actualRestSeconds,
          restApproximate: s.isWarmup ? false : s.restApproximate,
          actualRestDisplay:
            !s.isWarmup && s.actualRestSeconds !== null
              ? String(s.actualRestSeconds)
              : '',
          executionQualityPct: s.executionQualityPct,
          repQualities:
            s.repQualities?.map((rq) => ({
              repIndex: rq.repIndex,
              qualityPct: rq.qualityPct,
            })) ?? [],
          rir: s.rir ?? null,
          notes: s.notes ?? '',
          isWarmup: Boolean(s.isWarmup),
          isCompleted: s.isCompleted,
          completedAt: null,
          restEndedAt: null,
          completionSeq: null,
          wasUnchecked: false,
          completedViaCheckAll: false,
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
  const status = dayView.calendarDay.status;
  const statusIsJollyOrSkipped =
    status === 'jolly_instead' ||
    status === 'jolly_extra' ||
    status === 'skipped';
  const forceJolly =
    jollyParam === 'extra' ||
    jollyParam === 'instead' ||
    !plannedDay ||
    plannedDay.isRestDay ||
    statusIsJollyOrSkipped;

  if (forceJolly) {
    const mode: 'extra' | 'instead' =
      jollyParam === 'instead' || (!jollyParam && status === 'jolly_instead')
        ? 'instead'
        : 'extra';
    const jollyEvent =
      dayView.calendarDay.events.find(
        (e) =>
          e.eventType === (mode === 'instead' ? 'jolly_instead' : 'jolly_extra'),
      ) ??
      dayView.calendarDay.events.find(
        (e) =>
          e.eventType === 'jolly_instead' || e.eventType === 'jolly_extra',
      );
    const title = jollyEvent?.jollyLabel?.trim() || 'Jolly Workout';

    return {
      cid: generateCid(),
      title,
      notes: '',
      isJolly: true,
      jollyMode: mode,
      sessionDate: dayView.date,
      durationMinutes: '',
      startedAt: null,
      sessionStartSource: null,
      completionSeqCounter: 0,
      restClock: null,
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
    sessionDate: dayView.date,
    durationMinutes: '',
    startedAt: null,
    sessionStartSource: null,
    completionSeqCounter: 0,
    restClock: null,
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
        swappedFromExerciseId: slot.swappedFromExerciseId ?? null,
        swappedFromExerciseName: slot.swappedFromExerciseName ?? null,
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

  const [timerPickerOpen, setTimerPickerOpen] = useState(false);
  const [sessionNowMs, setSessionNowMs] = useState<number>(() => Date.now());
  const [extraPrefills, setExtraPrefills] = useState<
    Record<string, ExercisePrefill>
  >({});

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

        adoptLegacyWorkoutDrafts(dayRes.user.id);
        const existingDraft = !ignoreSavedDraft
          ? loadUserWorkoutDraft<WorkoutDraft>(dayRes.user.id, draftKey)
          : null;

        if (existingDraft && Array.isArray(existingDraft.exercises)) {
          const normalizedDraft: WorkoutDraft = {
            ...existingDraft,
            sessionDate:
              typeof existingDraft.sessionDate === 'string' &&
              existingDraft.sessionDate.trim()
                ? existingDraft.sessionDate
                : editSession
                  ? editSession.sessionDate
                  : dayRes.date,
            durationMinutes:
              typeof existingDraft.durationMinutes === 'string'
                ? existingDraft.durationMinutes
                : editSession && editSession.durationMinutes !== null
                  ? String(editSession.durationMinutes)
                  : '',
            startedAt:
              typeof existingDraft.startedAt === 'string' &&
              existingDraft.startedAt.trim()
                ? existingDraft.startedAt
                : editSession
                  ? editSession.startedAt
                  : null,
            sessionStartSource: existingDraft.sessionStartSource ?? null,
            completionSeqCounter:
              typeof existingDraft.completionSeqCounter === 'number'
                ? existingDraft.completionSeqCounter
                : 0,
            restClock: existingDraft.restClock ?? null,
            exercises: existingDraft.exercises.map((ex) => ({
              ...ex,
              notes: typeof ex.notes === 'string' ? ex.notes : '',
              swappedFromExerciseId: ex.swappedFromExerciseId ?? null,
              swappedFromExerciseName: ex.swappedFromExerciseName ?? null,
              sets: Array.isArray(ex.sets)
                ? ex.sets.map((s, idx) => ({
                    ...s,
                    setNumber:
                      typeof s.setNumber === 'number' ? s.setNumber : idx + 1,
                    rir:
                      typeof s.rir === 'number' && Number.isFinite(s.rir)
                        ? s.rir
                        : null,
                    notes: typeof s.notes === 'string' ? s.notes : '',
                    isWarmup: Boolean(s.isWarmup),
                    repQualities: Array.isArray(s.repQualities)
                      ? s.repQualities
                      : [],
                  }))
                : [],
            })),
          };
          setDraft(normalizedDraft);
          setRestoredFromStorage(true);
          setNoteOpen(normalizedDraft.notes.trim().length > 0);
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
    if (!draft || !dayView) return;
    saveUserWorkoutDraft(dayView.user.id, draftKey, {
      ...draft,
      updatedAt: new Date().toISOString(),
    });
  }, [draft, dayView, draftKey]);

  const draftStartedAt = draft?.startedAt ?? null;
  useEffect(() => {
    if (sessionId || !draftStartedAt) return;
    const syncNow = () => setSessionNowMs(Date.now());
    syncNow();
    const interval = window.setInterval(syncNow, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', syncNow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', syncNow);
    };
  }, [sessionId, draftStartedAt]);

  const updateDraft = useCallback(
    (updater: (prev: WorkoutDraft) => WorkoutDraft) => {
      setDraft((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const handleStartSession = () => {
    if (sessionId) return;
    const nowIso = new Date().toISOString();
    setSessionNowMs(Date.now());
    updateDraft((prev) => {
      if (prev.startedAt) return prev;
      return {
        ...prev,
        startedAt: resolveSessionStart(prev.startedAt, nowIso),
        sessionStartSource: 'manual',
      };
    });
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

  const handleToggleSetComplete = (exIndex: number, setIndex: number) => {
    if (!dayView) return;
    const nowIso = new Date().toISOString();
    setSessionNowMs(Date.now());
    setTimerPickerOpen(false);
    updateDraft((prev) => {
      const ex = prev.exercises[exIndex];
      const setRow = ex?.sets[setIndex];
      if (!ex || !setRow) return prev;

      const nextDone = !setRow.isCompleted;
      const nextSeq = nextDone ? (prev.completionSeqCounter ?? 0) + 1 : null;
      const nextExercises = prev.exercises.map((item, i) => {
        if (i !== exIndex) return item;
        return {
          ...item,
          sets: item.sets.map((s, j) =>
            j === setIndex
              ? {
                  ...s,
                  isCompleted: nextDone,
                  completedAt: nextDone ? nowIso : null,
                  restEndedAt: null,
                  completedViaCheckAll: false,
                  completionSeq: nextSeq,
                  wasUnchecked: nextDone ? Boolean(s.wasUnchecked) : true,
                }
              : s,
          ),
        };
      });

      let nextStartedAt = prev.startedAt;
      let nextStartSource = prev.sessionStartSource ?? null;
      let nextRestClock = prev.restClock ?? null;

      if (nextDone) {
        if (!sessionId) {
          const resolved = resolveSessionStart(prev.startedAt, nowIso);
          if (!prev.startedAt && resolved) {
            nextStartSource = 'first_set';
          }
          nextStartedAt = resolved;
        }
        if (!setRow.isWarmup) {
          nextRestClock = createRestClock({
            startedAt: nowIso,
            targetSeconds: setRow.restSeconds ?? ex.defaultRestSeconds,
            mode: dayView.user.restClockMode,
            label: ex.exerciseName,
            exerciseLocalId: ex.localId,
            setLocalId: setRow.localId,
          });
        }
      } else if (
        nextRestClock?.isActive &&
        nextRestClock.setLocalId === setRow.localId
      ) {
        nextRestClock = dismissRestClock(nextRestClock);
      }

      return {
        ...prev,
        startedAt: nextStartedAt,
        sessionStartSource: nextStartSource,
        completionSeqCounter:
          nextSeq !== null ? nextSeq : prev.completionSeqCounter ?? 0,
        restClock: nextRestClock,
        exercises: nextExercises,
      };
    });
  };

  const handleAddSet = (exIndex: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        const workingSets = ex.sets.filter((s) => !s.isWarmup);
        const last =
          workingSets[workingSets.length - 1] ?? ex.sets[ex.sets.length - 1];
        const nextSet: LoggerSet = {
          localId: makeLocalId('set'),
          setNumber: ex.sets.length + 1,
          weightDisplay: last?.weightDisplay ?? '',
          reps: last?.reps ?? '',
          timeSeconds: last?.timeSeconds ?? '',
          distanceM: last?.distanceM ?? '',
          restSeconds: last?.restSeconds ?? ex.defaultRestSeconds,
          restSecondsDisplay:
            (last?.restSeconds ?? ex.defaultRestSeconds) !== null
              ? String(last?.restSeconds ?? ex.defaultRestSeconds)
              : '',
          actualRestSeconds: null,
          restApproximate: false,
          actualRestDisplay: '',
          executionQualityPct: null,
          repQualities: [],
          rir: null,
          notes: '',
          isWarmup: false,
          isCompleted: false,
          completedAt: null,
          restEndedAt: null,
          completionSeq: null,
          wasUnchecked: false,
          completedViaCheckAll: false,
        };
        const updatedSets = [...ex.sets, nextSet].map((s, idx) => ({
          ...s,
          setNumber: idx + 1,
        }));
        return { ...ex, sets: updatedSets };
      }),
    }));
  };

  const handleAddWarmupSet = (exIndex: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        const warmups = ex.sets.filter((s) => s.isWarmup);
        const working = ex.sets.filter((s) => !s.isWarmup);
        const lastWarmup = warmups[warmups.length - 1] ?? null;
        const nextWarmup: LoggerSet = {
          localId: makeLocalId('set'),
          setNumber: warmups.length + 1,
          weightDisplay: lastWarmup?.weightDisplay ?? '',
          reps: lastWarmup?.reps ?? '',
          timeSeconds: lastWarmup?.timeSeconds ?? '',
          distanceM: lastWarmup?.distanceM ?? '',
          restSeconds: null,
          restSecondsDisplay: '',
          actualRestSeconds: null,
          restApproximate: false,
          actualRestDisplay: '',
          executionQualityPct: null,
          repQualities: [],
          rir: null,
          notes: '',
          isWarmup: true,
          isCompleted: false,
          completedAt: null,
          restEndedAt: null,
          completionSeq: null,
          wasUnchecked: false,
          completedViaCheckAll: false,
        };
        const combined = [...warmups, nextWarmup, ...working].map((s, idx) => ({
          ...s,
          setNumber: idx + 1,
        }));
        return { ...ex, sets: combined };
      }),
    }));
  };

  const handleRepeatLastWarmups = (exIndex: number) => {
    if (!dayView) return;
    const unit = dayView.user.unit;
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        if (ex.sets.some((s) => s.isWarmup)) return ex;
        const prefill =
          extraPrefills[ex.exerciseId] ??
          dayView.prefillByExerciseId[ex.exerciseId] ??
          null;
        const prevWarmups = prefill?.warmupSets ?? [];
        if (prevWarmups.length === 0) return ex;

        const warmupSets: LoggerSet[] = prevWarmups.map((w, wIdx) => {
          const wDisplay = kgToDisplay(w.weightKg, unit);
          return {
            localId: makeLocalId('set'),
            setNumber: wIdx + 1,
            weightDisplay: wDisplay !== null ? String(wDisplay) : '',
            reps: w.reps !== null ? String(w.reps) : '',
            timeSeconds: w.timeSeconds !== null ? String(w.timeSeconds) : '',
            distanceM: w.distanceM !== null ? String(w.distanceM) : '',
            restSeconds: null,
            restSecondsDisplay: '',
            actualRestSeconds: null,
            restApproximate: false,
            actualRestDisplay: '',
            executionQualityPct: null,
            repQualities: [],
            rir: null,
            notes: '',
            isWarmup: true,
            isCompleted: false,
            completedAt: null,
            restEndedAt: null,
            completionSeq: null,
            wasUnchecked: false,
            completedViaCheckAll: false,
          };
        });
        const working = ex.sets.filter((s) => !s.isWarmup);
        const combined = [...warmupSets, ...working].map((s, idx) => ({
          ...s,
          setNumber: idx + 1,
        }));
        return { ...ex, sets: combined };
      }),
    }));
  };

  const handleRemoveSet = (exIndex: number, setIndex: number) => {
    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        const target = ex.sets[setIndex];
        if (!target) return ex;
        if (!target.isWarmup) {
          const workingCount = ex.sets.filter((s) => !s.isWarmup).length;
          if (workingCount <= 1) return ex;
        }
        const filtered = ex.sets
          .filter((_, j) => j !== setIndex)
          .map((s, idx) => ({ ...s, setNumber: idx + 1 }));
        return { ...ex, sets: filtered };
      }),
    }));
  };

  const handleCheckAll = (exIndex: number) => {
    if (!draft || !dayView) return;
    const ex = draft.exercises[exIndex];
    if (!ex) return;
    const nowIso = new Date().toISOString();
    setSessionNowMs(Date.now());
    setTimerPickerOpen(false);
    updateDraft((prev) => {
      const nextStartedAt = sessionId
        ? prev.startedAt
        : resolveSessionStart(prev.startedAt, nowIso);
      const nextStartSource =
        !sessionId && !prev.startedAt && nextStartedAt
          ? 'first_set'
          : prev.sessionStartSource ?? null;
      return {
        ...prev,
        startedAt: nextStartedAt,
        sessionStartSource: nextStartSource,
        restClock: createRestClock({
          startedAt: nowIso,
          targetSeconds: ex.defaultRestSeconds,
          mode: dayView.user.restClockMode,
          label: ex.exerciseName,
          exerciseLocalId: ex.localId,
          setLocalId: null,
        }),
        exercises: prev.exercises.map((item, i) =>
          i === exIndex
            ? {
                ...item,
                sets: item.sets.map((s) =>
                  s.isWarmup || s.isCompleted
                    ? s
                    : {
                        ...s,
                        isCompleted: true,
                        completedAt: null,
                        restEndedAt: null,
                        completedViaCheckAll: true,
                        completionSeq: null,
                      },
                ),
              }
            : item,
        ),
      };
    });
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
        if (prefill) {
          const loadedPrefill = prefill;
          setExtraPrefills((prev) => ({ ...prev, [ex.id]: loadedPrefill }));
        }
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
      swappedFromExerciseId: null,
      swappedFromExerciseName: null,
      notes: '',
      sets: buildPrefilledSets({
        targetSets: prefill?.sets.length || 3,
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
    scope: 'session' | 'schedule' | 'revert',
  ) => {
    if (swapTargetIdx === null || !dayView) return;
    const targetIdx = swapTargetIdx;
    if (prefill) {
      setExtraPrefills((prev) => ({ ...prev, [toExercise.id]: prefill }));
    }

    updateDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== targetIdx) return ex;
        const workingCount = Math.max(
          1,
          ex.sets.filter((s) => !s.isWarmup).length,
        );
        const plannedSlot = ex.scheduleDayExerciseId
          ? dayView.calendarDay.plannedDay?.exercises.find(
              (slot) => slot.id === ex.scheduleDayExerciseId,
            )
          : undefined;

        let nextSwappedFromId = ex.swappedFromExerciseId ?? null;
        let nextSwappedFromName = ex.swappedFromExerciseName ?? null;
        if (
          scope === 'revert' ||
          scope === 'schedule' ||
          toExercise.id === ex.swappedFromExerciseId
        ) {
          nextSwappedFromId = null;
          nextSwappedFromName = null;
        } else if (scope === 'session' && !nextSwappedFromId) {
          nextSwappedFromId = ex.exerciseId;
          nextSwappedFromName = ex.exerciseName;
        }

        const preserveScheduleTargets =
          (scope === 'revert' || scope === 'schedule') && Boolean(plannedSlot);

        return {
          ...ex,
          exerciseId: toExercise.id,
          exerciseName: toExercise.name,
          trackingType: toExercise.trackingType,
          defaultRestSeconds: preserveScheduleTargets && plannedSlot
            ? plannedSlot.restSeconds
            : toExercise.defaultRestSeconds,
          notes: ex.notes,
          swappedFromExerciseId: nextSwappedFromId,
          swappedFromExerciseName: nextSwappedFromName,
          sets: buildPrefilledSets({
            targetSets:
              preserveScheduleTargets && plannedSlot
                ? plannedSlot.targetSets
                : workingCount,
            trackingType: toExercise.trackingType,
            unit: dayView.user.unit,
            prefill,
            slot: preserveScheduleTargets
              ? plannedSlot
              : plannedSlot
                ? {
                    targetWarmupSets: plannedSlot.targetWarmupSets,
                    restSeconds: toExercise.defaultRestSeconds,
                  }
                : undefined,
          }),
        };
      }),
    }));
  };

  const startRestTimer = (seconds: number, label = '') => {
    if (!dayView) return;
    const nowIso = new Date().toISOString();
    setTimerPickerOpen(false);
    updateDraft((prev) => ({
      ...prev,
      restClock: createRestClock({
        startedAt: nowIso,
        targetSeconds: seconds,
        mode: dayView.user.restClockMode,
        label,
      }),
    }));
  };

  const adjustRestTimer = (deltaSeconds: number) => {
    const nowMs = Date.now();
    updateDraft((prev) => {
      if (!prev.restClock || !prev.restClock.isActive) return prev;
      return {
        ...prev,
        restClock: adjustRestClockTarget(prev.restClock, deltaSeconds, nowMs),
      };
    });
  };

  const handleStopRestForNextSet = () => {
    const nowIso = new Date().toISOString();
    setTimerPickerOpen(false);
    updateDraft((prev) => {
      if (!prev.restClock) return prev;
      const stoppedClock = stopRestClock(prev.restClock, nowIso);
      const targetExId = prev.restClock.exerciseLocalId;
      const targetSetId = prev.restClock.setLocalId;
      const nextExercises =
        targetExId && targetSetId
          ? prev.exercises.map((ex) => {
              if (ex.localId !== targetExId) return ex;
              return {
                ...ex,
                sets: ex.sets.map((s) =>
                  s.localId === targetSetId ? { ...s, restEndedAt: nowIso } : s,
                ),
              };
            })
          : prev.exercises;
      return {
        ...prev,
        restClock: stoppedClock,
        exercises: nextExercises,
      };
    });
  };

  const handleDismissRestClock = () => {
    setTimerPickerOpen(false);
    updateDraft((prev) => ({
      ...prev,
      restClock: prev.restClock ? dismissRestClock(prev.restClock) : null,
    }));
  };

  const handleRestAlertFired = useCallback(
    (startedAt: string) => {
      updateDraft((prev) => {
        if (
          !prev.restClock ||
          prev.restClock.startedAt !== startedAt ||
          prev.restClock.alertFired
        ) {
          return prev;
        }
        return {
          ...prev,
          restClock: { ...prev.restClock, alertFired: true },
        };
      });
    },
    [updateDraft],
  );

  const exerciseByIdMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const ex of exercisesCatalog) {
      map.set(ex.id, ex);
    }
    return map;
  }, [exercisesCatalog]);

  const handleChangeWeightStep = useCallback(
    async (exerciseId: string, weightStepKg: number | null) => {
      try {
        const res =
          weightStepKg === null
            ? await apiFetch<{ exercise: Exercise }>(
                `/api/exercises/${encodeURIComponent(exerciseId)}/step`,
                { method: 'DELETE' },
              )
            : await apiFetch<{ exercise: Exercise }>(
                `/api/exercises/${encodeURIComponent(exerciseId)}/step`,
                {
                  method: 'PUT',
                  body: JSON.stringify({ weightStepKg }),
                },
              );

        const updated = res.exercise;
        setExercisesCatalog((prev) => {
          const exists = prev.some((e) => e.id === updated.id);
          if (exists) {
            return prev.map((e) => (e.id === updated.id ? updated : e));
          }
          return updated.isHidden ? prev : [...prev, updated];
        });
        setDayView((prev) =>
          prev
            ? {
                ...prev,
                exerciseStepsById: {
                  ...(prev.exerciseStepsById ?? {}),
                  [updated.id]: {
                    isCustom: updated.isCustom,
                    weightStepKg: updated.weightStepKg,
                    userWeightStepKg: updated.userWeightStepKg ?? null,
                  },
                },
              }
            : prev,
        );
        toast.success(
          weightStepKg === null
            ? 'Weight step reset to default'
            : 'Weight step updated',
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update step');
        throw err;
      }
    },
    [],
  );

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
    const isEditing = Boolean(sessionId);
    const computedRestMatrix = isEditing
      ? null
      : computeActualRestForWorkoutSets(draft.exercises);

    const exercisesPayload = draft.exercises
      .map((ex, exIdx) => {
        const completed = ex.sets
          .map((s, origSetIdx) => ({ s, origSetIdx }))
          .filter(({ s }) => s.isCompleted);
        const completedEntries = [
          ...completed.filter(({ s }) => s.isWarmup),
          ...completed.filter(({ s }) => !s.isWarmup),
        ];
        return {
          exerciseId: ex.exerciseId,
          orderIndex: exIdx,
          notes: ex.notes.trim(),
          sets: completedEntries.map(({ s, origSetIdx }, sIdx) => {
            const restEntry = computedRestMatrix?.[exIdx]?.[origSetIdx];
            const actualRestSeconds = s.isWarmup
              ? null
              : isEditing
                ? s.actualRestSeconds ?? null
                : restEntry?.actualRestSeconds ?? null;
            const restApproximate = s.isWarmup
              ? false
              : isEditing
                ? actualRestSeconds !== null && Boolean(s.restApproximate)
                : restEntry?.restApproximate ?? false;
            const keepQuality =
              isEditing ||
              dayView.user.enableSetQuality ||
              s.executionQualityPct !== null ||
              s.repQualities.length > 0;

            return {
              setNumber: sIdx + 1,
              weightKg: displayToKg(parseOptionalNum(s.weightDisplay), unit),
              reps: parseOptionalInt(s.reps),
              timeSeconds: parseOptionalInt(s.timeSeconds),
              distanceM: parseOptionalNum(s.distanceM),
              restSeconds: s.isWarmup
                ? null
                : isEditing
                  ? s.restSeconds ?? null
                  : s.restSeconds ?? ex.defaultRestSeconds,
              actualRestSeconds,
              restApproximate,
              executionQualityPct: keepQuality ? s.executionQualityPct : null,
              rir: s.rir,
              notes: s.notes.trim(),
              isWarmup: s.isWarmup,
              isCompleted: true,
              repQualities: keepQuality ? s.repQualities : [],
            };
          }),
        };
      })
      .filter((ex) => ex.sets.length > 0);

    if (exercisesPayload.length === 0) {
      toast.error('Complete at least 1 set');
      return;
    }

    let targetDate = date;
    let parsedDurationMinutes: number | null | undefined;
    if (isEditing) {
      const candidateDate = (draft.sessionDate ?? date).trim();
      if (!isValidYmdString(candidateDate)) {
        toast.error('Enter a valid workout date');
        return;
      }
      targetDate = candidateDate;
      const rawDur = (draft.durationMinutes ?? '').trim();
      if (!rawDur) {
        parsedDurationMinutes = null;
      } else {
        const dur = parseOptionalInt(rawDur);
        if (dur === null || dur < 0 || dur > 600) {
          toast.error('Duration must be between 0 and 600 minutes');
          return;
        }
        parsedDurationMinutes = dur;
      }
    }

    setSaving(true);
    try {
      if (sessionId) {
        await apiFetch(`/api/workouts/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            sessionDate: targetDate,
            isJolly: draft.isJolly,
            jollyMode: draft.isJolly ? draft.jollyMode ?? 'extra' : null,
            title,
            ...(draft.startedAt ? { startedAt: draft.startedAt } : {}),
            durationMinutes: parsedDurationMinutes,
            notes: draft.notes.trim(),
            exercises: exercisesPayload,
          }),
        });
        toast.success('Workout updated');
      } else {
        const completedAtIso = new Date().toISOString();
        const effectiveStartedAt =
          resolveSessionStart(draft.startedAt, completedAtIso) ?? completedAtIso;
        const durationMinutes = computeSessionDurationMinutes(
          effectiveStartedAt,
          completedAtIso,
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
            startedAt: effectiveStartedAt,
            completedAt: completedAtIso,
            durationMinutes,
            userWeightKg: dayView.user.weightKg,
            notes: draft.notes.trim(),
            cid: draft.cid,
            exercises: exercisesPayload,
          }),
        });
        toast.success('Workout saved');
      }

      clearUserWorkoutDraft(dayView.user.id, draftKey);
      router.push(`/workout/${encodeURIComponent(targetDate)}`);
    } catch (err) {
      // Never swallow errors into an outbox loop: surface exact server message
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!sessionId || !dayView) return;
    setDeleting(true);
    try {
      await apiFetch(
        `/api/workouts/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      clearUserWorkoutDraft(dayView.user.id, draftKey);
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
        <div className="card h-24 animate-pulse bg-[var(--gold-bg)]/50" />
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
  const workingCompletedTotal = draft.exercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => !s.isWarmup && s.isCompleted).length,
    0,
  );
  const warmupCompletedTotal = draft.exercises.reduce(
    (sum, ex) => sum + ex.sets.filter((s) => s.isWarmup && s.isCompleted).length,
    0,
  );
  const finishSetsLabel =
    workingCompletedTotal > 0 && warmupCompletedTotal > 0
      ? `${workingCompletedTotal} sets + ${warmupCompletedTotal}w`
      : workingCompletedTotal > 0
        ? `${workingCompletedTotal} sets`
        : warmupCompletedTotal > 0
          ? `${warmupCompletedTotal} warmup sets`
          : '0 sets';

  const restClockActive = Boolean(draft.restClock?.isActive);
  const restClockExId = draft.restClock?.exerciseLocalId ?? null;
  const restClockSetId = draft.restClock?.setLocalId ?? null;
  let lastTimeRest = null;
  if (restClockActive && restClockExId && restClockSetId) {
    const clockEx = draft.exercises.find((e) => e.localId === restClockExId);
    if (clockEx) {
      const completedPos = clockEx.sets
        .filter((s) => !s.isWarmup && s.isCompleted)
        .findIndex((s) => s.localId === restClockSetId);
      if (completedPos >= 0) {
        const prefill =
          extraPrefills[clockEx.exerciseId] ??
          dayView.prefillByExerciseId[clockEx.exerciseId] ??
          null;
        lastTimeRest = getLastTimeRestForCompletedSet(prefill, completedPos);
      }
    }
  }

  return (
    <main
      className={`mx-auto max-w-xl space-y-4 px-4 pt-4 ${
        restClockActive || timerPickerOpen ? 'pb-64' : 'pb-48'
      }`}
    >
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
              if (restClockActive) {
                handleDismissRestClock();
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

      {/* User-Driven Session Clock (new workouts) or Editable Session Details (edit mode) */}
      {!sessionId ? (
        <section
          aria-label="Session clock"
          className="card-sm flex items-center justify-between gap-3"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--line)] ${
                draft.startedAt
                  ? 'bg-[var(--green-bg)] text-[var(--ink)]'
                  : 'bg-[var(--surface-alt)] text-[var(--muted)]'
              }`}
            >
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-marker text-xl tracking-wider text-[var(--ink)]">
                  {formatClockSeconds(
                    computeSessionElapsedSeconds(draft.startedAt, sessionNowMs),
                  )}
                </span>
                <span
                  className={`pill px-2 py-0.5 text-xs ${
                    draft.startedAt ? 'green' : ''
                  }`}
                >
                  {draft.startedAt ? 'Session active' : 'Not started'}
                </span>
              </div>
              {!draft.startedAt && (
                <p className="truncate text-xs font-bold text-[var(--muted)]">
                  Tap Start or complete your first set
                </p>
              )}
            </div>
          </div>

          {!draft.startedAt && (
            <button
              type="button"
              onClick={handleStartSession}
              className="btn green !min-h-[44px] shrink-0 !px-4 text-base"
            >
              <Play className="h-4 w-4" />
              <span>Start</span>
            </button>
          )}
        </section>
      ) : (
        <section aria-label="Session details" className="card-sm space-y-2.5">
          <label className="block space-y-0.5">
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              value={draft.sessionDate ?? date}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  sessionDate: e.target.value,
                }))
              }
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
                value={isoToLocalTimeInput(draft.startedAt)}
                onChange={(e) => {
                  const hhmm = e.target.value;
                  updateDraft((prev) => {
                    const ymd = prev.sessionDate ?? date;
                    const nextIso = combineDateAndLocalTimeToIso(ymd, hhmm);
                    return nextIso ? { ...prev, startedAt: nextIso } : prev;
                  });
                }}
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
                  updateDraft((prev) => ({
                    ...prev,
                    durationMinutes: e.target.value,
                  }))
                }
                placeholder="—"
                aria-label="Duration minutes"
                className="min-h-[44px] w-full rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 text-base font-bold outline-none focus:bg-[var(--surface)]"
              />
            </label>
          </div>
        </section>
      )}

      {/* Restored Draft Pill */}
      {restoredFromStorage && (
        <div className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-[var(--line)] bg-[var(--gold-bg)] px-3 py-2 text-sm font-bold">
          <span>Draft restored</span>
          <button
            type="button"
            onClick={() => {
              clearUserWorkoutDraft(dayView.user.id, draftKey);
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
            className="min-h-[44px] flex-1 rounded-[8px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 font-marker text-xl outline-none focus:bg-[var(--surface)]"
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
              <span className="text-xs font-bold uppercase text-[var(--muted)]">
                Workout Note
              </span>
              {draft.notes.trim().length === 0 && (
                <button
                  type="button"
                  onClick={() => setNoteOpen(false)}
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
              onChange={(e) =>
                updateDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Workout note..."
              className="w-full resize-none rounded-[6px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-base font-bold outline-none"
            />
          </div>
        )}
      </section>

      {/* Exercises */}
      <div className="space-y-3">
        {draft.exercises.map((ex, idx) => {
          const catalogEx = exerciseByIdMap.get(ex.exerciseId);
          const stepMeta = dayView.exerciseStepsById?.[ex.exerciseId];
          const isCustomExercise =
            catalogEx?.isCustom ?? stepMeta?.isCustom ?? false;
          const exerciseDefaultKg =
            catalogEx?.weightStepKg ?? stepMeta?.weightStepKg ?? null;
          const userOverrideKg =
            catalogEx?.userWeightStepKg ?? stepMeta?.userWeightStepKg ?? null;
          const resolvedStep = resolveDisplayWeightStep({
            userOverrideKg,
            exerciseDefaultKg,
            userGlobalDefaultKg: dayView.user.defaultWeightStepKg,
            unit: dayView.user.unit,
          });
          const exPrefill =
            extraPrefills[ex.exerciseId] ??
            dayView.prefillByExerciseId[ex.exerciseId] ??
            null;

          return (
            <ExerciseLoggerCard
              key={ex.localId}
              exercise={ex}
              index={idx}
              totalCount={draft.exercises.length}
              unit={dayView.user.unit}
              enableSetQuality={dayView.user.enableSetQuality}
              alwaysShowRir={dayView.user.alwaysShowRir}
              enableSetNoteTags={dayView.user.enableSetNoteTags}
              enableSetNoteHint={dayView.user.enableSetNoteHint}
              isEditing={Boolean(sessionId)}
              weightStepDisplay={resolvedStep.displayStep}
              weightStepSource={resolvedStep.source}
              isCustomExercise={isCustomExercise}
              hasUserStepOverride={userOverrideKg !== null}
              hasCustomExerciseStep={
                isCustomExercise && exerciseDefaultKg !== null
              }
              prefill={exPrefill}
              onChangeWeightStep={handleChangeWeightStep}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onDeleteExercise={handleDeleteExercise}
              onOpenSwap={(i) => setSwapTargetIdx(i)}
              onChangeNotes={handleChangeExNotes}
              onUpdateSet={handleUpdateSet}
              onToggleSetComplete={handleToggleSetComplete}
              onAddSet={handleAddSet}
              onAddWarmupSet={handleAddWarmupSet}
              onRepeatLastWarmups={handleRepeatLastWarmups}
              onRemoveSet={handleRemoveSet}
              onCheckAll={handleCheckAll}
              onStartRestTimer={startRestTimer}
            />
          );
        })}

        {draft.exercises.length === 0 && (
          <div className="card py-6 text-center font-bold text-[var(--muted)]">
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
              : `Finish workout (${finishSetsLabel})`}
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
          currentNotes={swapExercise.notes}
          scheduleDayExerciseId={swapExercise.scheduleDayExerciseId}
          swappedFromExerciseId={swapExercise.swappedFromExerciseId}
          swappedFromExerciseName={swapExercise.swappedFromExerciseName}
          allowScheduleScope={!sessionId && Boolean(swapExercise.scheduleDayExerciseId)}
          exercises={exercisesCatalog}
          prefillByExerciseId={{
            ...dayView.prefillByExerciseId,
            ...extraPrefills,
          }}
          onSwapComplete={handleSwapComplete}
        />
      )}

      <FloatingRestTimer
        restClock={draft.restClock}
        preferredMode={dayView.user.restClockMode}
        lastTimeRest={lastTimeRest}
        isExpandedPicker={timerPickerOpen}
        onAdjustTarget={adjustRestTimer}
        onStartPreset={startRestTimer}
        onStopForNextSet={handleStopRestForNextSet}
        onDismiss={handleDismissRestClock}
        onAlertFired={handleRestAlertFired}
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
          <div className="card h-24 animate-pulse bg-[var(--gold-bg)]/50" />
          <div className="card h-56 animate-pulse" />
        </main>
      }
    >
      <WorkoutLoggerInner />
    </Suspense>
  );
}
