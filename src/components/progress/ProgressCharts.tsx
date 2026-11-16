'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiFetch, toast } from '@/components/ui';
import type { ProgressResponse } from '@/app/api/progress/route';
import type { TrackingType, WeightUnit } from '@/types/domain';
import { SvgLineChart } from './SvgLineChart';
import { SvgBarChart } from './SvgBarChart';

type RangeOption = '4w' | '12w' | 'all';

const RANGE_OPTIONS: Array<{ value: RangeOption; label: string }> = [
  { value: '4w', label: '4w' },
  { value: '12w', label: '12w' },
  { value: 'all', label: 'All' },
];

function localTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;
}

function metricMetaForTrackingType(
  trackingType: TrackingType,
  unit: WeightUnit,
): { title: string; unitLabel: string; isWeight: boolean } {
  switch (trackingType) {
    case 'weight_reps':
      return { title: 'Best Weight', unitLabel: unit, isWeight: true };
    case 'weighted_bodyweight':
      return { title: 'Best Added Load', unitLabel: unit, isWeight: true };
    case 'assisted_bodyweight':
      return { title: 'Min Assistance', unitLabel: unit, isWeight: true };
    case 'bodyweight_reps':
      return { title: 'Best Reps', unitLabel: 'reps', isWeight: false };
    case 'time':
      return { title: 'Best Hold', unitLabel: 's', isWeight: false };
    case 'weight_time':
      return { title: 'Best Weight', unitLabel: unit, isWeight: true };
    case 'distance':
    case 'distance_time':
      return { title: 'Best Distance', unitLabel: 'm', isWeight: false };
  }
}

export function ProgressCharts() {
  const router = useRouter();
  const [range, setRange] = useState<RangeOption>('12w');
  const [exerciseId, setExerciseId] = useState<string>('');
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(
    async (nextRange: RangeOption, nextExerciseId: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          range: nextRange,
          today: localTodayIso(),
        });
        if (nextExerciseId) {
          params.set('exerciseId', nextExerciseId);
        }
        const res = await apiFetch<ProgressResponse>(
          `/api/progress?${params.toString()}`,
        );
        setData(res);
        if (!nextExerciseId && res.selectedExercise) {
          setExerciseId(res.selectedExercise.id);
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
    [router],
  );

  useEffect(() => {
    void load(range, exerciseId);
  }, [load, range, exerciseId]);

  const unit: WeightUnit = data?.unit ?? 'kg';
  const selected = data?.selectedExercise ?? null;

  const primaryMeta = useMemo(() => {
    if (!selected) return null;
    return metricMetaForTrackingType(selected.trackingType, unit);
  }, [selected, unit]);

  const primaryPoints = useMemo(() => {
    if (!data || !primaryMeta) return [];
    return data.exerciseSeries.map((pt) => ({
      label: pt.date,
      value: primaryMeta.isWeight
        ? toDisplayWeight(pt.primaryValue, unit)
        : pt.primaryValue,
      sublabel: `${pt.setsCount} sets`,
    }));
  }, [data, primaryMeta, unit]);

  const supportsVolume =
    selected?.trackingType === 'weight_reps' ||
    selected?.trackingType === 'weighted_bodyweight';

  const volumePoints = useMemo(() => {
    if (!data || !supportsVolume) return [];
    return data.exerciseSeries
      .filter((pt) => pt.volumeKg !== null)
      .map((pt) => ({
        label: pt.date,
        value: toDisplayWeight(pt.volumeKg ?? 0, unit),
        sublabel: `${pt.setsCount} sets`,
      }));
  }, [data, supportsVolume, unit]);

  const bodyWeightPoints = useMemo(() => {
    if (!data) return [];
    return data.bodyWeightSeries.map((pt) => ({
      label: pt.date,
      value: toDisplayWeight(pt.weightKg, unit),
    }));
  }, [data, unit]);

  const weeklySessionPoints = useMemo(
    () =>
      (data?.weeklySessions ?? []).map((w) => ({
        label: w.weekStart,
        value: w.value,
      })),
    [data],
  );

  const weeklySetPoints = useMemo(
    () =>
      (data?.weeklySets ?? []).map((w) => ({
        label: w.weekStart,
        value: w.value,
      })),
    [data],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marker text-2xl text-[var(--ink)]">Progress</h1>
        <div className="flex items-center gap-1.5" role="group" aria-label="Range">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={`min-h-[44px] min-w-[48px] rounded-xl border-2 border-[var(--line)] px-3 text-base font-bold transition ${
                  active
                    ? 'bg-[var(--gold)] text-[var(--btn-gold-fg)] shadow-[2px_2px_0_var(--shadow-color)]'
                    : 'bg-[var(--card)] text-[var(--muted)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exercise Picker + Per-Exercise Chart */}
      <section className="card flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="progress-exercise-select" className="font-marker text-lg">
            Exercise
          </label>
          {data && data.exercises.length > 0 ? (
            <select
              id="progress-exercise-select"
              value={selected?.id ?? ''}
              onChange={(e) => setExerciseId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base sm:max-w-xs"
            >
              {data.exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-[var(--muted)]">
              {loading ? 'Loading…' : 'No logged sets'}
            </span>
          )}
        </div>

        {primaryMeta && (
          <div className="pt-1">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              {primaryMeta.title}
            </div>
            <SvgLineChart
              points={primaryPoints}
              unitLabel={primaryMeta.unitLabel}
              strokeColor="var(--red)"
              emptyLabel="No sets in range"
            />
          </div>
        )}

        {supportsVolume && (
          <div className="border-t border-[var(--line)]/15 pt-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Session Volume ({unit})
            </div>
            <SvgLineChart
              points={volumePoints}
              unitLabel={unit}
              strokeColor="var(--blue)"
              emptyLabel="No volume in range"
            />
          </div>
        )}
      </section>

      {/* Sessions Per Week */}
      <section className="card flex flex-col gap-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">Sessions / Week</h2>
        <SvgBarChart
          points={weeklySessionPoints}
          unitLabel="sessions"
          barColor="var(--green)"
          emptyLabel="No sessions yet"
        />
      </section>

      {/* Weekly Sets */}
      <section className="card flex flex-col gap-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">Sets / Week</h2>
        <SvgBarChart
          points={weeklySetPoints}
          unitLabel="sets"
          barColor="var(--blue)"
          emptyLabel="No sets yet"
        />
      </section>

      {/* Body Weight */}
      <section className="card flex flex-col gap-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">Body Weight</h2>
        <SvgLineChart
          points={bodyWeightPoints}
          unitLabel={unit}
          strokeColor="var(--ink)"
          emptyLabel="No weight entries"
        />
      </section>
    </div>
  );
}
