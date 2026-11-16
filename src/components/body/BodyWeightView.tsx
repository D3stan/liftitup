'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Pencil, Scale, Trash2 } from 'lucide-react';
import type {
  BodyWeightHistoryItem,
  BodyWeightsGetResponse,
} from '@/app/api/body-weights/route';
import { SvgLineChart } from '@/components/progress/SvgLineChart';
import {
  ApiClientError,
  Button,
  NumberStepper,
  Sheet,
  apiFetch,
  toast,
} from '@/components/ui';
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  bodyDisplayToKg,
  formatBodyMetricSourceLabel,
  isManualBodyMetricSource,
  kgToBodyDisplay,
  type BodyWeightRange,
} from '@/lib/body/weight';
import { LB_PER_KG } from '@/lib/workouts/stepSize';
import type { WeightUnit } from '@/types/domain';

const RANGE_OPTIONS: Array<{ value: BodyWeightRange; label: string }> = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

function formatDisplayDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatShortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function formatSignedDelta(deltaKg: number | null, unit: WeightUnit): string {
  if (deltaKg === null) return '—';
  const raw = unit === 'lb' ? deltaKg * LB_PER_KG : deltaKg;
  const rounded = Math.round(raw * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return `0.0 ${unit}`;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} ${unit}`;
}

export function BodyWeightView() {
  const router = useRouter();
  const [range, setRange] = useState<BodyWeightRange>('3m');
  const [data, setData] = useState<BodyWeightsGetResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [todayInput, setTodayInput] = useState('');
  const [savingToday, setSavingToday] = useState(false);

  // Past-date add sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addWeight, setAddWeight] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);

  // Edit entry sheet
  const [editingItem, setEditingItem] = useState<BodyWeightHistoryItem | null>(
    null,
  );
  const [editDate, setEditDate] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Inline delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(
    async (nextRange: BodyWeightRange) => {
      setLoading(true);
      try {
        const res = await apiFetch<BodyWeightsGetResponse>(
          `/api/body-weights?range=${nextRange}`,
        );
        setData(res);
        const todayWinner = res.history.find(
          (h) => h.measuredOn === res.today && h.isWinningForDay,
        );
        const seedKg =
          todayWinner?.weightKg ??
          res.summary.currentWeightKg ??
          res.profileWeightKg;
        setTodayInput(String(kgToBodyDisplay(seedKg, res.unit)));
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
    void load(range);
  }, [load, range]);

  const unit: WeightUnit = data?.unit ?? 'kg';
  const minDisplay = kgToBodyDisplay(BODY_WEIGHT_MIN_KG, unit);
  const maxDisplay = kgToBodyDisplay(BODY_WEIGHT_MAX_KG, unit);
  const fallbackDisplay = useMemo(() => {
    const baseKg =
      data?.summary.currentWeightKg ?? data?.profileWeightKg ?? 75;
    return kgToBodyDisplay(baseKg, unit);
  }, [data, unit]);

  const todayHasManual = useMemo(() => {
    if (!data) return false;
    return data.history.some(
      (h) => h.measuredOn === data.today && isManualBodyMetricSource(h.source),
    );
  }, [data]);

  const chartPoints = useMemo(() => {
    if (!data) return [];
    return data.series.map((pt) => ({
      label: pt.date,
      value: kgToBodyDisplay(pt.weightKg, unit),
      sublabel: formatBodyMetricSourceLabel(pt.source),
    }));
  }, [data, unit]);

  const movingAvgPoints = useMemo(() => {
    if (!data) return [];
    return data.series.map((pt) => kgToBodyDisplay(pt.movingAvg7dKg, unit));
  }, [data, unit]);

  function parseDisplayToValidKg(raw: string): number | null {
    const parsed = Number(raw.trim().replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const kg = bodyDisplayToKg(parsed, unit);
    if (kg < BODY_WEIGHT_MIN_KG || kg > BODY_WEIGHT_MAX_KG) return null;
    return kg;
  }

  async function handleSaveToday(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const kg = parseDisplayToValidKg(todayInput);
    if (kg === null) {
      toast.error(
        `Enter weight between ${minDisplay} and ${maxDisplay} ${unit}`,
      );
      return;
    }

    setSavingToday(true);
    try {
      const res = await apiFetch<{ updatedInPlace: boolean }>(
        '/api/body-weights',
        {
          method: 'POST',
          body: JSON.stringify({
            weightKg: kg,
            measuredOn: data.today,
          }),
        },
      );
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success(
        res.updatedInPlace ? "Updated today's weight" : "Logged today's weight",
      );
      await load(range);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingToday(false);
    }
  }

  function openAddSheet() {
    if (!data) return;
    setAddDate(data.today);
    setAddWeight(todayInput || String(fallbackDisplay));
    setAddSheetOpen(true);
  }

  async function handleSavePastEntry(e: React.FormEvent) {
    e.preventDefault();
    const kg = parseDisplayToValidKg(addWeight);
    if (kg === null) {
      toast.error(
        `Enter weight between ${minDisplay} and ${maxDisplay} ${unit}`,
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate)) {
      toast.error('Select a valid date');
      return;
    }

    setSavingAdd(true);
    try {
      const res = await apiFetch<{ updatedInPlace: boolean }>(
        '/api/body-weights',
        {
          method: 'POST',
          body: JSON.stringify({
            weightKg: kg,
            measuredOn: addDate,
          }),
        },
      );
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success(res.updatedInPlace ? 'Updated entry' : 'Weight logged');
      setAddSheetOpen(false);
      await load(range);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingAdd(false);
    }
  }

  function openEditSheet(item: BodyWeightHistoryItem) {
    setConfirmDeleteId(null);
    setEditingItem(item);
    setEditDate(item.measuredOn);
    setEditWeight(String(kgToBodyDisplay(item.weightKg, unit)));
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;
    const kg = parseDisplayToValidKg(editWeight);
    if (kg === null) {
      toast.error(
        `Enter weight between ${minDisplay} and ${maxDisplay} ${unit}`,
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      toast.error('Select a valid date');
      return;
    }

    setSavingEdit(true);
    try {
      await apiFetch(`/api/body-weights/${editingItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          weightKg: kg,
          measuredOn: editDate,
        }),
      });
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success('Entry updated');
      setEditingItem(null);
      await load(range);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteEntry(id: string) {
    setDeletingId(id);
    try {
      await apiFetch(`/api/body-weights/${id}`, {
        method: 'DELETE',
      });
      window.dispatchEvent(new Event('liftitup:user-updated'));
      toast.success('Entry deleted');
      setConfirmDeleteId(null);
      await load(range);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-6 pt-2">
      {/* Header & Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6 text-[var(--ink)]" aria-hidden="true" />
          <h1 className="font-marker text-2xl text-[var(--ink)]">Body</h1>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Range">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={`min-h-[44px] min-w-[44px] rounded-xl border-2 border-[var(--line)] px-2.5 text-sm font-bold transition ${
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

      {/* Quick Today Entry */}
      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-marker text-lg text-[var(--ink)]">
              Today&apos;s Weight ({unit})
            </h2>
            <p className="text-xs text-[var(--muted)]">
              {data ? formatDisplayDate(data.today) : 'Loading…'}
              {todayHasManual ? ' · Updates today’s manual log' : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="alt"
            onClick={openAddSheet}
            disabled={!data}
            className="min-h-[44px] gap-1.5 px-3 text-sm"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Past date
          </Button>
        </div>

        <form onSubmit={handleSaveToday} className="flex items-center gap-2">
          <NumberStepper
            value={todayInput}
            onChange={setTodayInput}
            step={0.1}
            min={minDisplay}
            max={maxDisplay}
            fallbackValue={fallbackDisplay}
            inputMode="decimal"
            ariaLabel={`Today's weight in ${unit}`}
            decrementLabel="Decrease today's weight"
            incrementLabel="Increase today's weight"
            disabled={!data || savingToday}
            className="flex-1"
          />
          <Button
            type="submit"
            loading={savingToday}
            disabled={!data}
            className="min-h-[44px] shrink-0 px-4"
          >
            {todayHasManual ? 'Update' : 'Log'}
          </Button>
        </form>
      </section>

      {/* Summary Cards */}
      <section className="grid grid-cols-3 gap-2" aria-label="Weight summary">
        <div className="card flex flex-col gap-0.5 px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Current
          </span>
          <span className="font-marker text-lg leading-tight text-[var(--ink)]">
            {data?.summary.currentWeightKg !== null && data
              ? `${kgToBodyDisplay(data.summary.currentWeightKg, unit)} ${unit}`
              : '—'}
          </span>
          <span className="text-[11px] text-[var(--muted)]">
            {data?.summary.currentMeasuredOn
              ? formatShortDate(data.summary.currentMeasuredOn)
              : 'No logs yet'}
          </span>
        </div>

        <div className="card flex flex-col gap-0.5 px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            7d Change
          </span>
          <span className="font-marker text-lg leading-tight text-[var(--ink)]">
            {data ? formatSignedDelta(data.summary.change7dKg, unit) : '—'}
          </span>
          <span className="text-[11px] text-[var(--muted)]">
            {data && data.summary.change7dKg === null
              ? 'Need ≥7d data'
              : 'vs 7+ days ago'}
          </span>
        </div>

        <div className="card flex flex-col gap-0.5 px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            30d Change
          </span>
          <span className="font-marker text-lg leading-tight text-[var(--ink)]">
            {data ? formatSignedDelta(data.summary.change30dKg, unit) : '—'}
          </span>
          <span className="text-[11px] text-[var(--muted)]">
            {data && data.summary.change30dKg === null
              ? 'Need ≥30d data'
              : 'vs 30+ days ago'}
          </span>
        </div>
      </section>

      {/* Trend Chart */}
      <section className="card flex flex-col gap-2">
        <h2 className="font-marker text-lg text-[var(--ink)]">Weight Trend</h2>
        {loading && !data ? (
          <div className="flex h-36 items-center justify-center text-sm text-[var(--muted)]">
            Loading…
          </div>
        ) : (
          <SvgLineChart
            points={chartPoints}
            secondaryPoints={movingAvgPoints}
            unitLabel={unit}
            strokeColor="var(--ink)"
            secondaryStrokeColor="var(--blue)"
            primaryLabel="Daily"
            secondaryLabel="7d avg"
            emptyLabel="No weight entries in this range"
          />
        )}
      </section>

      {/* History List */}
      <section className="card flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-marker text-lg text-[var(--ink)]">History</h2>
          <span className="text-xs font-bold text-[var(--muted)]">
            {data ? `${data.history.length} entries` : ''}
          </span>
        </div>

        {!data || data.history.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            {loading
              ? 'Loading history…'
              : 'No body weight entries yet. Log today’s weight above.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--line)]/15">
            {data.history.map((item) => {
              const isConfirming = confirmDeleteId === item.id;
              const isDeleting = deletingId === item.id;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-base font-bold text-[var(--ink)]">
                        {kgToBodyDisplay(item.weightKg, unit)} {unit}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {formatDisplayDate(item.measuredOn)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-block rounded-md border border-[var(--line)]/30 bg-[var(--surface-alt)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--ink)]">
                        {formatBodyMetricSourceLabel(item.source)}
                      </span>
                      {!item.isWinningForDay && (
                        <span className="text-[11px] text-[var(--muted)]">
                          Overridden for day
                        </span>
                      )}
                    </div>
                  </div>

                  {isConfirming ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="red"
                        loading={isDeleting}
                        onClick={() => void handleDeleteEntry(item.id)}
                        className="min-h-[44px] px-3 text-sm"
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        variant="alt"
                        disabled={isDeleting}
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[44px] px-2.5 text-sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditSheet(item)}
                        aria-label={`Edit ${item.measuredOn} entry`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        aria-label={`Delete ${item.measuredOn} entry`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border-2 border-[var(--line)] bg-[var(--red-bg)] text-[var(--red)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Log Past Date Sheet */}
      <Sheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Log Weight Entry"
      >
        <form onSubmit={handleSavePastEntry} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              value={addDate}
              onChange={(e) => setAddDate(e.target.value)}
              required
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Weight ({unit})
            </span>
            <NumberStepper
              value={addWeight}
              onChange={setAddWeight}
              step={0.1}
              min={minDisplay}
              max={maxDisplay}
              fallbackValue={fallbackDisplay}
              inputMode="decimal"
              ariaLabel={`Weight in ${unit}`}
              decrementLabel="Decrease weight"
              incrementLabel="Increase weight"
            />
          </div>

          <div className="mt-1 flex gap-2">
            <Button
              type="button"
              variant="alt"
              onClick={() => setAddSheetOpen(false)}
              className="min-h-[44px] flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={savingAdd}
              className="min-h-[44px] flex-1"
            >
              Save
            </Button>
          </div>
        </form>
      </Sheet>

      {/* Edit Entry Sheet */}
      <Sheet
        open={editingItem !== null}
        onClose={() => setEditingItem(null)}
        title="Edit Weight Entry"
      >
        <form onSubmit={handleSaveEdit} className="flex flex-col gap-3">
          {editingItem && (
            <p className="text-xs text-[var(--muted)]">
              Source: {formatBodyMetricSourceLabel(editingItem.source)}
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              required
              className="min-h-[44px] w-full rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-3 text-base"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Weight ({unit})
            </span>
            <NumberStepper
              value={editWeight}
              onChange={setEditWeight}
              step={0.1}
              min={minDisplay}
              max={maxDisplay}
              fallbackValue={fallbackDisplay}
              inputMode="decimal"
              ariaLabel={`Edited weight in ${unit}`}
              decrementLabel="Decrease edited weight"
              incrementLabel="Increase edited weight"
            />
          </div>

          <div className="mt-1 flex gap-2">
            <Button
              type="button"
              variant="alt"
              onClick={() => setEditingItem(null)}
              className="min-h-[44px] flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={savingEdit}
              className="min-h-[44px] flex-1"
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
