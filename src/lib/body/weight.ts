import type { BodyMetric, WeightUnit } from '@/types/domain';
import { LB_PER_KG } from '@/lib/workouts/stepSize';

export const BODY_WEIGHT_MIN_KG = 25;
export const BODY_WEIGHT_MAX_KG = 300;

export type BodyWeightRange = '1m' | '3m' | '1y' | 'all';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyBodyWeightPoint {
  date: string;
  weightKg: number;
  movingAvg7dKg: number;
  source: string;
  metricId: string;
}

export interface BodyWeightSummary {
  currentWeightKg: number | null;
  currentMeasuredOn: string | null;
  currentSource: string | null;
  change7dKg: number | null;
  change30dKg: number | null;
  entryCount: number;
  resolvedDayCount: number;
}

/**
 * Validates that a string is a real YYYY-MM-DD calendar date.
 */
export function isValidIsoDate(val: string): boolean {
  if (!ISO_DATE_RE.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === val
  );
}

/**
 * Adds `days` (positive or negative) to a YYYY-MM-DD date in UTC.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Converts stored kg to display value rounded to 1 decimal place.
 */
export function kgToBodyDisplay(kg: number, unit: WeightUnit): number {
  const raw = unit === 'lb' ? kg * LB_PER_KG : kg;
  return Math.round(raw * 10) / 10;
}

/**
 * Converts a display-unit weight value to kg rounded to 2 decimal places
 * so 0.1 lb steps round-trip cleanly without drift.
 */
export function bodyDisplayToKg(val: number, unit: WeightUnit): number {
  const raw = unit === 'lb' ? val / LB_PER_KG : val;
  return Math.round(raw * 100) / 100;
}

/**
 * Canonical source tier for resolving multiple body_metrics rows on one day:
 * - manual / settings -> 3 (highest)
 * - apple_health      -> 2
 * - import / ai_import / liftitup_restore / sample / other -> 1
 */
export function getBodyMetricSourceRank(source: string): number {
  const normalized = source.trim().toLowerCase();
  if (normalized === 'manual' || normalized === 'settings') {
    return 3;
  }
  if (normalized === 'apple_health') {
    return 2;
  }
  return 1;
}

export function isManualBodyMetricSource(source: string): boolean {
  return getBodyMetricSourceRank(source) === 3;
}

export function formatBodyMetricSourceLabel(source: string): string {
  switch (source.trim().toLowerCase()) {
    case 'manual':
      return 'Manual';
    case 'settings':
      return 'Settings';
    case 'apple_health':
      return 'Apple Health';
    case 'ai_import':
      return 'AI Import';
    case 'liftitup_restore':
      return 'Restore';
    case 'import':
      return 'Import';
    case 'sample':
      return 'Sample';
    default:
      return source || 'Other';
  }
}

/**
 * Compares two body_metrics entries for the same day.
 * Returns > 0 if `a` wins over `b`, < 0 if `b` wins over `a`.
 * Precedence: higher source tier wins; within the same tier, latest createdAt (then id) wins.
 */
export function compareBodyMetricPrecedence(
  a: Pick<BodyMetric, 'source' | 'createdAt' | 'id'>,
  b: Pick<BodyMetric, 'source' | 'createdAt' | 'id'>,
): number {
  const rankDiff =
    getBodyMetricSourceRank(a.source) - getBodyMetricSourceRank(b.source);
  if (rankDiff !== 0) return rankDiff;

  const createdDiff = a.createdAt.localeCompare(b.createdAt);
  if (createdDiff !== 0) return createdDiff;

  return a.id.localeCompare(b.id);
}

/**
 * Canonical day-weight resolver: collapses multiple rows per day into a single
 * winning BodyMetric per `measuredOn` date, sorted ascending by `measuredOn`.
 */
export function resolveDailyBodyWeights(metrics: BodyMetric[]): BodyMetric[] {
  const winnersByDate = new Map<string, BodyMetric>();

  for (const metric of metrics) {
    const existing = winnersByDate.get(metric.measuredOn);
    if (!existing || compareBodyMetricPrecedence(metric, existing) > 0) {
      winnersByDate.set(metric.measuredOn, metric);
    }
  }

  return Array.from(winnersByDate.values()).sort((a, b) =>
    a.measuredOn.localeCompare(b.measuredOn),
  );
}

/**
 * Resolves the winning BodyMetric for a single YYYY-MM-DD date, or null if none.
 * Reused by Phase 8 progress photos to attach the day's resolved weight.
 */
export function resolveWeightForDate(
  metrics: BodyMetric[],
  date: string,
): BodyMetric | null {
  let winner: BodyMetric | null = null;
  for (const metric of metrics) {
    if (metric.measuredOn !== date) continue;
    if (!winner || compareBodyMetricPrecedence(metric, winner) > 0) {
      winner = metric;
    }
  }
  return winner;
}

/**
 * Returns the winning BodyMetric on the latest `measuredOn` date, or null if empty.
 */
export function getLatestResolvedBodyWeight(
  metrics: BodyMetric[],
): BodyMetric | null {
  const resolved = resolveDailyBodyWeights(metrics);
  return resolved.length > 0 ? resolved[resolved.length - 1] : null;
}

/**
 * Computes a 7-day calendar moving average [date - 6d, date] over resolved daily points.
 * Accepts resolved daily points in any order and returns them sorted ascending by date.
 */
export function computeMovingAverage7dSeries(
  resolvedDaily: BodyMetric[],
): DailyBodyWeightPoint[] {
  const sorted = [...resolvedDaily].sort((a, b) =>
    a.measuredOn.localeCompare(b.measuredOn),
  );

  const series: DailyBodyWeightPoint[] = [];
  let windowStartIdx = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const windowStartDate = addDaysIso(current.measuredOn, -6);

    while (
      windowStartIdx < i &&
      sorted[windowStartIdx].measuredOn < windowStartDate
    ) {
      windowStartIdx += 1;
    }

    let sum = 0;
    let count = 0;
    for (let j = windowStartIdx; j <= i; j += 1) {
      sum += sorted[j].weightKg;
      count += 1;
    }

    const avgKg = count > 0 ? Math.round((sum / count) * 100) / 100 : current.weightKg;

    series.push({
      date: current.measuredOn,
      weightKg: current.weightKg,
      movingAvg7dKg: avgKg,
      source: current.source,
      metricId: current.id,
    });
  }

  return series;
}

/**
 * Computes current weight and 7d / 30d changes from resolved daily points.
 * Compares the latest resolved point against the closest resolved point on or before
 * `latestDate - 7d` / `latestDate - 30d`. Returns `null` for a delta when no point
 * exists on or before that baseline date.
 */
export function computeBodyWeightSummary(
  resolvedDaily: BodyMetric[],
  totalRawCount?: number,
): BodyWeightSummary {
  const sorted = [...resolvedDaily].sort((a, b) =>
    a.measuredOn.localeCompare(b.measuredOn),
  );

  if (sorted.length === 0) {
    return {
      currentWeightKg: null,
      currentMeasuredOn: null,
      currentSource: null,
      change7dKg: null,
      change30dKg: null,
      entryCount: totalRawCount ?? 0,
      resolvedDayCount: 0,
    };
  }

  const latest = sorted[sorted.length - 1];
  const target7d = addDaysIso(latest.measuredOn, -7);
  const target30d = addDaysIso(latest.measuredOn, -30);

  let baseline7d: BodyMetric | null = null;
  let baseline30d: BodyMetric | null = null;

  for (const pt of sorted) {
    if (pt.measuredOn <= target7d) {
      baseline7d = pt;
    }
    if (pt.measuredOn <= target30d) {
      baseline30d = pt;
    }
  }

  return {
    currentWeightKg: latest.weightKg,
    currentMeasuredOn: latest.measuredOn,
    currentSource: latest.source,
    change7dKg:
      baseline7d !== null
        ? Math.round((latest.weightKg - baseline7d.weightKg) * 100) / 100
        : null,
    change30dKg:
      baseline30d !== null
        ? Math.round((latest.weightKg - baseline30d.weightKg) * 100) / 100
        : null,
    entryCount: totalRawCount ?? sorted.length,
    resolvedDayCount: sorted.length,
  };
}

/**
 * Filters a precomputed daily series to the requested range relative to `todayIso`.
 */
export function filterResolvedPointsByRange(
  series: DailyBodyWeightPoint[],
  range: BodyWeightRange,
  todayIso: string,
): DailyBodyWeightPoint[] {
  if (range === 'all') return series;
  const days = range === '1m' ? 30 : range === '3m' ? 90 : 365;
  const fromDate = addDaysIso(todayIso, -days);
  return series.filter((pt) => pt.date >= fromDate);
}
