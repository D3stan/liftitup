'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Pencil,
  Play,
  Plus,
  SkipForward,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import {
  ApiClientError,
  apiFetch,
  Button,
  Sheet,
  toast,
} from '@/components/ui';
import type { WorkoutDayViewResponse } from '@/lib/workouts/types';
import {
  formatDisplayDate,
  formatLoggedSet,
  formatPlannedTarget,
  getQualityRowColor,
  localTodayYmd,
} from '@/components/workout/trackingFormat';
import {
  computeSessionRestSummary,
  formatRestSeconds,
} from '@/lib/workouts/rest';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  planned: { label: 'Planned', className: 'gold' },
  completed: { label: 'Done', className: 'green' },
  rest: { label: 'Rest', className: 'blue' },
  skipped: { label: 'Skipped', className: 'red' },
  idle: { label: 'Off', className: '' },
  postponed: { label: 'Postponed', className: 'blue' },
  jolly_extra: { label: 'Jolly Extra', className: 'gold' },
  jolly_instead: { label: 'Jolly', className: 'gold' },
  unscheduled: { label: 'Open', className: '' },
};

export default function WorkoutDayPage() {
  const params = useParams<{ date: string }>();
  const router = useRouter();
  const date = params.date;

  const [data, setData] = useState<WorkoutDayViewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [jollySheetOpen, setJollySheetOpen] = useState(false);

  const loadDay = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const today = localTodayYmd();
      const res = await apiFetch<WorkoutDayViewResponse>(
        `/api/workouts/${encodeURIComponent(date)}?today=${encodeURIComponent(today)}`,
      );
      setData(res);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.replace('/welcome');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to load day';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [date, router]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  const handleDeleteSession = async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/workouts/sessions/${encodeURIComponent(deleteTargetId)}`, {
        method: 'DELETE',
      });
      toast.success('Workout deleted');
      setDeleteTargetId(null);
      await loadDay();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleSkipToday = async () => {
    setSkipping(true);
    try {
      await apiFetch('/api/schedule/events', {
        method: 'POST',
        body: JSON.stringify({
          eventDate: date,
          eventType: 'skip',
          today: localTodayYmd(),
        }),
      });
      toast.success('Day skipped');
      await loadDay();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Skip failed');
    } finally {
      setSkipping(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 pb-28 pt-4">
        <div className="card h-24 animate-pulse bg-[var(--gold-bg)]/50" />
        <div className="card h-44 animate-pulse" />
      </main>
    );
  }

  if (errorMsg || !data) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 pb-28 pt-4">
        <Link href="/" className="btn alt inline-flex">
          <ArrowLeft className="h-4 w-4" />
          <span>Calendar</span>
        </Link>
        <div className="card space-y-3">
          <p className="font-bold text-[var(--red)]">
            {errorMsg || 'Unable to load'}
          </p>
          <Button variant="primary" onClick={loadDay}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const { user, calendarDay, sessions, today } = data;
  const statusInfo =
    STATUS_BADGE[calendarDay.status] ?? STATUS_BADGE.unscheduled;
  const isToday = date === today;
  const isFutureOrToday = date >= today;
  const plannedDay = calendarDay.plannedDay;
  const hasCompletedPlannedSession = sessions.some(
    (s) => !s.isJolly && s.completedAt !== null,
  );
  const canStartPlanned =
    Boolean(plannedDay && !plannedDay.isRestDay) &&
    !hasCompletedPlannedSession &&
    calendarDay.status === 'planned' &&
    isFutureOrToday;
  const canOfferJollyInstead =
    Boolean(plannedDay && !plannedDay.isRestDay) &&
    !hasCompletedPlannedSession &&
    calendarDay.status === 'planned';
  const jollyEvent = calendarDay.events.find(
    (e) => e.eventType === 'jolly_instead' || e.eventType === 'jolly_extra',
  );

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 pb-28 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="btn alt !min-h-[44px] !px-3 text-base">
          <ArrowLeft className="h-4 w-4" />
          <span>Calendar</span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="pill">
            <Calendar className="h-3.5 w-3.5" />
            <span>{formatDisplayDate(date)}</span>
          </span>
          <span className={`pill ${statusInfo.className}`}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Logged Sessions (Read-Only) */}
      {sessions.map((session) => {
        const restSummary = computeSessionRestSummary(session);
        const showRestSummary =
          restSummary.measuredCount > 0 || restSummary.hasUnmeasuredRests;

        return (
        <section key={session.id} className="card space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {session.isJolly && (
                  <span className="pill gold text-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    {session.jollyMode === 'instead'
                      ? 'Jolly (Instead)'
                      : 'Jolly (Extra)'}
                  </span>
                )}
                {session.durationMinutes !== null && (
                  <span className="pill text-xs">
                    {session.durationMinutes} min
                  </span>
                )}
              </div>
              <h1 className="font-marker text-2xl leading-tight text-[var(--ink)]">
                {session.title}
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href={`/workout/${encodeURIComponent(date)}/log?sessionId=${encodeURIComponent(session.id)}`}
                className="btn alt !min-h-[44px] !px-3 text-base"
              >
                <Pencil className="h-4 w-4" />
                <span>Edit</span>
              </Link>
              <button
                type="button"
                onClick={() => setDeleteTargetId(session.id)}
                aria-label={`Delete ${session.title}`}
                className="btn red icon !h-[44px] !w-[44px]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {session.notes.trim().length > 0 && (
            <div className="note text-base font-bold text-[var(--ink)]">
              {session.notes}
            </div>
          )}

          {showRestSummary && (
            <div className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--paper)]/60 px-3 py-2 text-sm font-bold space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Total rest:{' '}
                  {restSummary.measuredCount > 0
                    ? formatRestSeconds(
                        restSummary.totalRestSeconds,
                        restSummary.hasAnyApproximate,
                      )
                    : '—'}
                </span>
                <span>
                  Avg rest:{' '}
                  {restSummary.averageRestSeconds !== null
                    ? formatRestSeconds(
                        restSummary.averageRestSeconds,
                        restSummary.hasAnyApproximate,
                      )
                    : '—'}
                </span>
              </div>
              {restSummary.allRestsMeasured &&
              restSummary.workingTimeSeconds !== null ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                  <span>
                    Working time: {formatRestSeconds(restSummary.workingTimeSeconds)}
                  </span>
                  <span>
                    Rest time:{' '}
                    {formatRestSeconds(
                      restSummary.totalRestSeconds,
                      restSummary.hasAnyApproximate,
                    )}
                  </span>
                </div>
              ) : (
                restSummary.hasUnmeasuredRests && (
                  <p className="text-xs text-[var(--muted)]">
                    Some rests were not measured
                  </p>
                )
              )}
            </div>
          )}

          <div className="space-y-2.5">
            {session.exercises.map((ex, idx) => {
              const t = ex.trackingType ?? 'weight_reps';
              const warmupSets = ex.sets.filter((s) => s.isWarmup);
              const workingSets = ex.sets.filter((s) => !s.isWarmup);
              const annotatedNotes = [
                ...warmupSets.map((s, wIdx) => ({
                  label: `W${wIdx + 1}`,
                  notes: s.notes.trim(),
                })),
                ...workingSets.map((s, sIdx) => ({
                  label: `Set ${sIdx + 1}`,
                  notes: s.notes.trim(),
                })),
              ].filter((item) => item.notes.length > 0);

              return (
                <div
                  key={ex.id}
                  className="rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="pill !bg-[var(--ink)] px-2 py-0 text-xs !text-[var(--card)]">
                      #{idx + 1}
                    </span>
                    <h2 className="font-bold text-lg leading-snug text-[var(--ink)]">
                      {ex.exerciseName ?? ex.exerciseId}
                    </h2>
                  </div>

                  {ex.notes.trim().length > 0 && (
                    <div className="note !py-1.5 !px-2.5 text-sm font-bold">
                      {ex.notes}
                    </div>
                  )}

                  {warmupSets.length > 0 && (
                    <div className="text-xs font-bold text-[var(--muted)]">
                      Warmup:{' '}
                      {warmupSets
                        .map((s) => {
                          const base = formatLoggedSet(s, t, user.unit);
                          return s.rir !== null
                            ? `${base} @ RIR ${s.rir}`
                            : base;
                        })
                        .join(' · ')}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {workingSets.map((s) => {
                      const color = getQualityRowColor(
                        s.isCompleted,
                        user.enableSetQuality || s.executionQualityPct !== null,
                        s.executionQualityPct,
                      );
                      const restLabel =
                        s.actualRestSeconds !== null
                          ? formatRestSeconds(
                              s.actualRestSeconds,
                              s.restApproximate,
                            )
                          : null;
                      const planDiffers =
                        restLabel !== null &&
                        s.restSeconds !== null &&
                        s.restSeconds !== s.actualRestSeconds;
                      const hasSetNote = s.notes.trim().length > 0;
                      return (
                        <span
                          key={s.id}
                          className={`inline-flex flex-wrap items-center gap-1.5 rounded-[6px] border-2 border-[var(--line)] px-2.5 py-1 text-sm font-bold ${color}`}
                        >
                          <span>{formatLoggedSet(s, t, user.unit)}</span>
                          {s.rir !== null && (
                            <span className="text-xs opacity-85">
                              @ RIR {s.rir}
                            </span>
                          )}
                          {s.executionQualityPct !== null &&
                            (user.enableSetQuality ||
                              s.executionQualityPct !== 100) && (
                              <span className="text-xs opacity-80">
                                ({s.executionQualityPct}%)
                              </span>
                            )}
                          {restLabel && (
                            <span className="text-xs opacity-85">
                              · {restLabel}
                              {planDiffers
                                ? ` (plan ${formatRestSeconds(s.restSeconds)})`
                                : ''}
                            </span>
                          )}
                          {hasSetNote && (
                            <StickyNote
                              className="h-3.5 w-3.5 shrink-0 opacity-80"
                              aria-label="Set has note"
                            />
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {annotatedNotes.length > 0 && (
                    <div className="space-y-0.5 text-xs font-bold text-[var(--muted)]">
                      {annotatedNotes.map((item, nIdx) => (
                        <div key={`${item.label}-${nIdx}`}>
                          <span className="text-[var(--ink)]">
                            {item.label}:
                          </span>{' '}
                          {item.notes}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        );
      })}

      {/* Planned Workout Card (only when day status is planned) */}
      {plannedDay && !plannedDay.isRestDay && !hasCompletedPlannedSession && calendarDay.status === 'planned' && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="font-marker text-2xl text-[var(--ink)]">
                {plannedDay.label}
              </h1>
            </div>

            {canStartPlanned && (
              <Link
                href={`/workout/${encodeURIComponent(date)}/log`}
                className="btn big"
              >
                <Play className="h-5 w-5" />
                <span>Start</span>
              </Link>
            )}
          </div>

          <div className="space-y-2">
            {plannedDay.exercises.map((ex, idx) => (
              <div
                key={ex.id}
                className="rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--paper)]/60 px-3 py-2.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="pill shrink-0 !bg-[var(--ink)] px-2 py-0 text-xs !text-[var(--card)]">
                      #{idx + 1}
                    </span>
                    <span className="truncate font-bold text-lg text-[var(--ink)]">
                      {ex.exerciseName ?? ex.exerciseId}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-[var(--muted)]">
                    {ex.restSeconds}s
                  </span>
                </div>

                <div className="text-base font-bold text-[var(--muted)]">
                  {formatPlannedTarget(ex, user.unit)}
                </div>

                {ex.swappedFromExerciseName && (
                  <div className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--line)]/40 bg-[var(--gold-bg)] px-2 py-0.5 text-xs font-bold text-[var(--ink)]">
                    <span>Swapped from {ex.swappedFromExerciseName}</span>
                  </div>
                )}

                {ex.notes.trim().length > 0 && (
                  <div className="note !mt-1.5 !py-1.5 !px-2.5 text-sm font-bold">
                    {ex.notes}
                  </div>
                )}
              </div>
            ))}
          </div>

          {isToday && canStartPlanned && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="alt"
                loading={skipping}
                onClick={handleSkipToday}
                className="flex-1"
              >
                <SkipForward className="h-4 w-4" />
                <span>Skip</span>
              </Button>
              <Button
                variant="blue"
                onClick={() => setJollySheetOpen(true)}
                className="flex-1"
              >
                <Sparkles className="h-4 w-4" />
                <span>Jolly</span>
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Rest / Postponed / Skipped / Jolly / Open Fallback Card */}
      {(!plannedDay ||
        plannedDay.isRestDay ||
        calendarDay.status !== 'planned') &&
        sessions.length === 0 && (
          <section className="card space-y-3 text-center">
            <h1 className="font-marker text-2xl text-[var(--ink)]">
              {calendarDay.status === 'rest'
                ? 'Rest Day'
                : calendarDay.status === 'postponed'
                  ? 'Postponed'
                  : calendarDay.status === 'skipped'
                    ? calendarDay.skippedLabel
                      ? `Skipped: ${calendarDay.skippedLabel}`
                      : 'Skipped'
                    : calendarDay.status === 'jolly_instead'
                      ? jollyEvent?.jollyLabel?.trim() || 'Jolly Day'
                      : calendarDay.status === 'jolly_extra'
                        ? jollyEvent?.jollyLabel?.trim() || 'Jolly Extra'
                        : 'No Planned Workout'}
            </h1>
            <Link
              href={`/workout/${encodeURIComponent(date)}/log?jolly=${
                calendarDay.status === 'jolly_instead' ? 'instead' : 'extra'
              }`}
              className="btn w-full"
            >
              <Sparkles className="h-4 w-4" />
              <span>Start Jolly Workout</span>
            </Link>
          </section>
        )}

      {/* Extra session option when sessions already exist on this date */}
      {sessions.length > 0 && (
        <div className="flex justify-center">
          <Link
            href={`/workout/${encodeURIComponent(date)}/log?jolly=extra`}
            className="btn alt w-full"
          >
            <Plus className="h-4 w-4" />
            <span>Add Jolly Workout</span>
          </Link>
        </div>
      )}

      {/* Confirm Delete Sheet */}
      <Sheet
        open={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        title="Delete Workout?"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="alt"
              onClick={() => setDeleteTargetId(null)}
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
        </div>
      </Sheet>

      {/* Jolly Mode Sheet */}
      <Sheet
        open={jollySheetOpen}
        onClose={() => setJollySheetOpen(false)}
        title="Jolly Workout"
      >
        <div className="space-y-2.5">
          {canOfferJollyInstead && (
            <Link
              href={`/workout/${encodeURIComponent(date)}/log?jolly=instead`}
              className="btn w-full"
              onClick={() => setJollySheetOpen(false)}
            >
              Instead of {plannedDay?.label}
            </Link>
          )}
          <Link
            href={`/workout/${encodeURIComponent(date)}/log?jolly=extra`}
            className="btn alt w-full"
            onClick={() => setJollySheetOpen(false)}
          >
            Extra workout
          </Link>
        </div>
      </Sheet>
    </main>
  );
}
