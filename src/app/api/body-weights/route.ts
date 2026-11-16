import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  compareBodyMetricPrecedence,
  computeBodyWeightSummary,
  computeMovingAverage7dSeries,
  filterResolvedPointsByRange,
  isValidIsoDate,
  resolveDailyBodyWeights,
  type BodyWeightRange,
  type BodyWeightSummary,
  type DailyBodyWeightPoint,
} from '@/lib/body/weight';
import {
  listBodyMetrics,
  upsertManualBodyMetricInTx,
} from '@/lib/db/bodyMetrics';
import { localDateForTimezone } from '@/lib/db/users';
import type { BodyMetric, WeightUnit } from '@/types/domain';

export interface BodyWeightHistoryItem extends BodyMetric {
  isWinningForDay: boolean;
}

export interface BodyWeightsGetResponse {
  range: BodyWeightRange;
  unit: WeightUnit;
  today: string;
  profileWeightKg: number;
  summary: BodyWeightSummary;
  series: DailyBodyWeightPoint[];
  history: BodyWeightHistoryItem[];
}

function parseRange(raw: string | null): BodyWeightRange {
  if (!raw) return '3m';
  if (raw === '1m' || raw === '3m' || raw === '1y' || raw === 'all') {
    return raw;
  }
  throw ApiError.validation('range must be 1m, 3m, 1y, or all');
}

export const GET = withApiHandler(
  'body_weights.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const range = parseRange(req.nextUrl.searchParams.get('range'));
    const today = localDateForTimezone(user.timezone);

    const allMetrics = await listBodyMetrics(user.id);
    const resolvedDaily = resolveDailyBodyWeights(allMetrics);
    const fullSeries = computeMovingAverage7dSeries(resolvedDaily);
    const series = filterResolvedPointsByRange(fullSeries, range, today);
    const summary = computeBodyWeightSummary(resolvedDaily, allMetrics.length);
    const winningIds = new Set(resolvedDaily.map((m) => m.id));

    const history: BodyWeightHistoryItem[] = [...allMetrics]
      .sort((a, b) => {
        const dateCmp = b.measuredOn.localeCompare(a.measuredOn);
        if (dateCmp !== 0) return dateCmp;
        return compareBodyMetricPrecedence(b, a);
      })
      .map((m) => ({
        ...m,
        isWinningForDay: winningIds.has(m.id),
      }));

    const payload: BodyWeightsGetResponse = {
      range,
      unit: user.unit,
      today,
      profileWeightKg: user.weightKg,
      summary,
      series,
      history,
    };

    return NextResponse.json(payload);
  },
);

interface PostBodyWeightBody {
  weightKg?: unknown;
  measuredOn?: unknown;
}

export const POST = withApiHandler(
  'body_weights.post',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<PostBodyWeightBody>(req);

    if (typeof body.weightKg !== 'number' || !Number.isFinite(body.weightKg)) {
      throw ApiError.validation('weightKg must be a finite number');
    }
    if (
      body.weightKg < BODY_WEIGHT_MIN_KG ||
      body.weightKg > BODY_WEIGHT_MAX_KG
    ) {
      throw ApiError.validation(
        `weightKg must be between ${BODY_WEIGHT_MIN_KG} and ${BODY_WEIGHT_MAX_KG}`,
      );
    }

    let measuredOn = localDateForTimezone(user.timezone);
    if (body.measuredOn !== undefined && body.measuredOn !== null && body.measuredOn !== '') {
      if (
        typeof body.measuredOn !== 'string' ||
        !isValidIsoDate(body.measuredOn.trim())
      ) {
        throw ApiError.validation('measuredOn must be a valid YYYY-MM-DD date');
      }
      measuredOn = body.measuredOn.trim();
    }

    const result = await upsertManualBodyMetricInTx({
      userId: user.id,
      measuredOn,
      weightKg: body.weightKg,
      source: 'manual',
    });

    return NextResponse.json(result, {
      status: result.updatedInPlace ? 200 : 201,
    });
  },
);
