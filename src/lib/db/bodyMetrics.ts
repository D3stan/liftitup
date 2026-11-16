import crypto from 'node:crypto';
import type { BodyMetric } from '@/types/domain';
import { query } from './connection';

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

export async function recordBodyMetric(input: {
  userId: string;
  measuredOn: string;
  weightKg: number;
  source: string;
}): Promise<BodyMetric> {
  const id = `bm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

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
