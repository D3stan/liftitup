import crypto from 'node:crypto';
import type { BodyMetric } from '@/types/domain';
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  getBodyMetricSourceRank,
  getLatestResolvedBodyWeight,
  isValidIsoDate,
  resolveDailyBodyWeights,
  resolveWeightForDate,
} from '@/lib/body/weight';
import { query, queryOne, withTransaction } from './connection';
import { DEFAULT_USER_WEIGHT_KG } from './userDeletion';

export {
  getBodyMetricSourceRank,
  getLatestResolvedBodyWeight,
  resolveDailyBodyWeights,
  resolveWeightForDate,
};

type DbBodyMetricRow = {
  id: string;
  user_id: string;
  measured_on: string;
  weight_kg: number;
  source: string;
  created_at: string;
};

function mapBodyMetricRow(row: DbBodyMetricRow): BodyMetric {
  return {
    id: row.id,
    userId: row.user_id,
    measuredOn: row.measured_on,
    weightKg: Number(row.weight_kg),
    source: row.source,
    createdAt: row.created_at,
  };
}

function assertValidWeightKg(weightKg: number): number {
  if (!Number.isFinite(weightKg)) {
    throw new Error('weightKg must be a finite number');
  }
  if (weightKg < BODY_WEIGHT_MIN_KG || weightKg > BODY_WEIGHT_MAX_KG) {
    throw new Error(
      `weightKg must be between ${BODY_WEIGHT_MIN_KG} and ${BODY_WEIGHT_MAX_KG}`,
    );
  }
  return Math.round(weightKg * 100) / 100;
}

function assertValidMeasuredOn(measuredOn: string): string {
  if (!isValidIsoDate(measuredOn)) {
    throw new Error('measuredOn must be a valid YYYY-MM-DD date');
  }
  return measuredOn;
}

export async function recordBodyMetric(input: {
  userId: string;
  measuredOn: string;
  weightKg: number;
  source: string;
  createdAt?: string;
}): Promise<BodyMetric> {
  const id = `bm_${crypto.randomUUID()}`;
  const now = input.createdAt ?? new Date().toISOString();

  await query(
    `
    INSERT INTO body_metrics (id, user_id, measured_on, weight_kg, source, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [id, input.userId, input.measuredOn, input.weightKg, input.source, now],
  );

  return {
    id,
    userId: input.userId,
    measuredOn: input.measuredOn,
    weightKg: input.weightKg,
    source: input.source,
    createdAt: now,
  };
}

export async function listBodyMetrics(
  userId: string,
  opts?: { from?: string; to?: string; limit?: number },
): Promise<BodyMetric[]> {
  const clauses = ['user_id = $1'];
  const params: Array<string | number> = [userId];
  let idx = 2;

  if (opts?.from) {
    clauses.push(`measured_on >= $${idx++}`);
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push(`measured_on <= $${idx++}`);
    params.push(opts.to);
  }

  let limitSql = '';
  if (opts?.limit && opts.limit > 0) {
    limitSql = `LIMIT $${idx++}`;
    params.push(opts.limit);
  }

  const res = await query<DbBodyMetricRow>(
    `SELECT * FROM body_metrics WHERE ${clauses.join(' AND ')} ORDER BY measured_on ASC, created_at ASC ${limitSql}`,
    params,
  );

  return res.rows.map(mapBodyMetricRow);
}

export async function getBodyMetricById(
  userId: string,
  id: string,
): Promise<BodyMetric | null> {
  const row = await queryOne<DbBodyMetricRow>(
    'SELECT * FROM body_metrics WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return row ? mapBodyMetricRow(row) : null;
}

/**
 * Re-syncs `users.weight_kg` to the latest resolved daily body weight from `body_metrics`.
 * Falls back to `DEFAULT_USER_WEIGHT_KG` (75 kg) when no `body_metrics` rows remain,
 * unless `preserveExistingIfEmpty` is true (used by Restore when export has no bodyMetrics).
 * Safe to call inside an active `withTransaction` block.
 */
export async function syncUserProfileWeightFromBodyMetrics(
  userId: string,
  opts?: { preserveExistingIfEmpty?: boolean },
): Promise<number> {
  const metrics = await listBodyMetrics(userId);
  const latest = getLatestResolvedBodyWeight(metrics);

  if (latest) {
    await query('UPDATE users SET weight_kg = $1 WHERE id = $2', [
      latest.weightKg,
      userId,
    ]);
    return latest.weightKg;
  }

  if (opts?.preserveExistingIfEmpty) {
    const existing = await queryOne<{ weight_kg: number }>(
      'SELECT weight_kg FROM users WHERE id = $1',
      [userId],
    );
    return existing ? Number(existing.weight_kg) : DEFAULT_USER_WEIGHT_KG;
  }

  await query('UPDATE users SET weight_kg = $1 WHERE id = $2', [
    DEFAULT_USER_WEIGHT_KG,
    userId,
  ]);
  return DEFAULT_USER_WEIGHT_KG;
}

/**
 * Upserts a manual body weight entry for `(userId, measuredOn)`.
 * If a manual or settings row already exists for that date, updates the latest one
 * in place rather than inserting a duplicate row, then re-syncs `users.weight_kg`.
 */
export async function upsertManualBodyMetricInTx(input: {
  userId: string;
  measuredOn: string;
  weightKg: number;
  source?: 'manual' | 'settings';
}): Promise<{
  metric: BodyMetric;
  updatedInPlace: boolean;
  profileWeightKg: number;
}> {
  const measuredOn = assertValidMeasuredOn(input.measuredOn);
  const weightKg = assertValidWeightKg(input.weightKg);
  const targetSource = input.source ?? 'manual';
  const now = new Date().toISOString();

  return withTransaction(async () => {
    const existing = await queryOne<DbBodyMetricRow>(
      `
      SELECT * FROM body_metrics
      WHERE user_id = $1
        AND measured_on = $2
        AND source IN ('manual', 'settings')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [input.userId, measuredOn],
    );

    let metric: BodyMetric;
    let updatedInPlace = false;

    if (existing) {
      await query(
        `
        UPDATE body_metrics
        SET weight_kg = $1, source = $2, created_at = $3
        WHERE id = $4 AND user_id = $5
        `,
        [weightKg, targetSource, now, existing.id, input.userId],
      );
      metric = {
        id: existing.id,
        userId: input.userId,
        measuredOn,
        weightKg,
        source: targetSource,
        createdAt: now,
      };
      updatedInPlace = true;
    } else {
      metric = await recordBodyMetric({
        userId: input.userId,
        measuredOn,
        weightKg,
        source: targetSource,
        createdAt: now,
      });
    }

    const profileWeightKg = await syncUserProfileWeightFromBodyMetrics(
      input.userId,
    );

    return { metric, updatedInPlace, profileWeightKg };
  });
}

/**
 * Updates an existing `body_metrics` row scoped to `userId` and re-syncs `users.weight_kg`.
 */
export async function updateBodyMetricEntry(
  userId: string,
  id: string,
  patch: { measuredOn?: string; weightKg?: number },
): Promise<{ metric: BodyMetric; profileWeightKg: number } | null> {
  return withTransaction(async () => {
    const existing = await getBodyMetricById(userId, id);
    if (!existing) return null;

    const nextMeasuredOn =
      patch.measuredOn !== undefined
        ? assertValidMeasuredOn(patch.measuredOn)
        : existing.measuredOn;
    const nextWeightKg =
      patch.weightKg !== undefined
        ? assertValidWeightKg(patch.weightKg)
        : existing.weightKg;

    await query(
      `
      UPDATE body_metrics
      SET measured_on = $1, weight_kg = $2
      WHERE id = $3 AND user_id = $4
      `,
      [nextMeasuredOn, nextWeightKg, id, userId],
    );

    const profileWeightKg = await syncUserProfileWeightFromBodyMetrics(userId);
    return {
      metric: {
        ...existing,
        measuredOn: nextMeasuredOn,
        weightKg: nextWeightKg,
      },
      profileWeightKg,
    };
  });
}

/**
 * Deletes a `body_metrics` row scoped to `userId` and re-syncs `users.weight_kg`
 * (falling back to 75 kg if no rows remain).
 */
export async function deleteBodyMetricEntry(
  userId: string,
  id: string,
): Promise<{ deleted: boolean; profileWeightKg: number }> {
  return withTransaction(async () => {
    const res = await query(
      'DELETE FROM body_metrics WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    const deleted = Number(res.rowCount ?? 0) > 0;
    const profileWeightKg = await syncUserProfileWeightFromBodyMetrics(userId);
    return { deleted, profileWeightKg };
  });
}
