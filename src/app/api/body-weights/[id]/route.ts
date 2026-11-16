import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  isValidIsoDate,
} from '@/lib/body/weight';
import {
  deleteBodyMetricEntry,
  updateBodyMetricEntry,
} from '@/lib/db/bodyMetrics';

interface PatchBodyWeightBody {
  weightKg?: unknown;
  measuredOn?: unknown;
}

export const PATCH = withApiHandler<{ id: string }>(
  'body_weights.patch',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const { id } = ctx.params;
    const body = await parseJsonBody<PatchBodyWeightBody>(req);

    const patch: { weightKg?: number; measuredOn?: string } = {};

    if (body.weightKg !== undefined) {
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
      patch.weightKg = body.weightKg;
    }

    if (body.measuredOn !== undefined) {
      if (
        typeof body.measuredOn !== 'string' ||
        !isValidIsoDate(body.measuredOn.trim())
      ) {
        throw ApiError.validation('measuredOn must be a valid YYYY-MM-DD date');
      }
      patch.measuredOn = body.measuredOn.trim();
    }

    if (patch.weightKg === undefined && patch.measuredOn === undefined) {
      throw ApiError.validation('Provide weightKg or measuredOn to update');
    }

    const result = await updateBodyMetricEntry(user.id, id, patch);
    if (!result) {
      throw ApiError.notFound('Body weight entry not found');
    }

    return NextResponse.json(result);
  },
);

export const DELETE = withApiHandler<{ id: string }>(
  'body_weights.delete',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const { id } = ctx.params;

    const result = await deleteBodyMetricEntry(user.id, id);
    if (!result.deleted) {
      throw ApiError.notFound('Body weight entry not found');
    }

    return NextResponse.json(result);
  },
);
