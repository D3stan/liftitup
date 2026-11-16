'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, RotateCcw } from 'lucide-react';
import { ApiClientError, Button, apiFetch, toast } from '@/components/ui';
import type { RotationSchedule, UserProfile, WeightUnit } from '@/types/domain';
import { formatExerciseTarget, getLocalTodayIso } from './formatTarget';

export function SplitView() {
  const router = useRouter();
  const [schedule, setSchedule] = useState<RotationSchedule | null>(null);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, meRes] = await Promise.all([
        apiFetch<{ schedule: RotationSchedule | null }>('/api/schedule'),
        apiFetch<{ user: UserProfile }>('/api/auth/me'),
      ]);
      setSchedule(schedRes.schedule);
      setUnit(meRes.user.unit);
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

  const handleResetRotation = async () => {
    if (!schedule || resetting) return;
    setResetting(true);
    try {
      await apiFetch('/api/schedule/events', {
        method: 'POST',
        body: JSON.stringify({
          eventDate: getLocalTodayIso(),
          eventType: 'reset',
        }),
      });
      toast.success('Rotation reset');
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reset rotation',
      );
    } finally {
      setResetting(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marker text-2xl text-[var(--ink)]">
          {schedule?.name || 'Split'}
        </h1>
        <div className="flex items-center gap-2">
          {schedule && schedule.days.length > 0 && (
            <Button
              variant="alt"
              onClick={handleResetRotation}
              loading={resetting}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          )}
          <Link href="/split/edit" className="btn">
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      {!schedule || schedule.days.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-marker text-lg text-[var(--ink)]">No split yet</p>
          <Link href="/split/edit" className="btn">
            Create split
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {schedule.days.map((day, idx) => (
            <section key={day.id} className="card space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-[6px_8px_6px_8px] border-2 border-[var(--line)] bg-[var(--gold)] px-1.5 font-marker text-sm text-[var(--btn-gold-fg)]">
                    {idx + 1}
                  </span>
                  <h2 className="font-marker text-xl text-[var(--ink)]">
                    {day.label}
                  </h2>
                </div>
                {day.isRestDay && (
                  <span className="rounded border-2 border-[var(--line)] bg-[var(--blue-bg)] px-2.5 py-0.5 text-sm font-bold text-[var(--ink)]">
                    Rest
                  </span>
                )}
              </div>

              {!day.isRestDay && (
                <div className="space-y-2 pt-1">
                  {day.exercises.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">No exercises</p>
                  ) : (
                    day.exercises.map((ex) => (
                      <div
                        key={ex.id}
                        className="rounded-[8px_10px_8px_10px] border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2"
                      >
                        <div className="font-bold text-[var(--ink)]">
                          {ex.exerciseName ?? 'Exercise'}
                        </div>
                        <div className="text-sm text-[var(--muted)]">
                          {formatExerciseTarget(ex, unit)}
                        </div>
                        {ex.notes.trim().length > 0 && (
                          <div className="mt-1 text-sm italic text-[var(--muted)]">
                            {ex.notes}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
