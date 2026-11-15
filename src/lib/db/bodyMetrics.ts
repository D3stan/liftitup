import crypto from 'node:crypto';
import type { BodyMetric } from '@/types/domain';
import { getDb } from './connection';

interface DbBodyMetricRow {
  id: string;
  user_id: string;
  measured_on: string;
  weight_kg: number;
  source: string;
  created_at: string;
}

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

export function recordBodyMetric(input: {
  userId: string;
  measuredOn: string;
  weightKg: number;
  source: string;
}): BodyMetric {
  const db = getDb();
  const id = `bm_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO body_metrics (id, user_id, measured_on, weight_kg, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.userId, input.measuredOn, input.weightKg, input.source, now);

  return {
    id,
    userId: input.userId,
    measuredOn: input.measuredOn,
    weightKg: input.weightKg,
    source: input.source,
    createdAt: now,
  };
}

export function listBodyMetrics(
  userId: string,
  opts?: { from?: string; to?: string; limit?: number },
): BodyMetric[] {
  const db = getDb();
  const clauses = ['user_id = ?'];
  const params: Array<string | number> = [userId];

  if (opts?.from) {
    clauses.push('measured_on >= ?');
    params.push(opts.from);
  }
  if (opts?.to) {
    clauses.push('measured_on <= ?');
    params.push(opts.to);
  }

  const limitSql = opts?.limit && opts.limit > 0 ? 'LIMIT ?' : '';
  if (limitSql) {
    params.push(opts!.limit!);
  }

  const rows = db
    .prepare(
      `SELECT * FROM body_metrics WHERE ${clauses.join(' AND ')} ORDER BY measured_on ASC, created_at ASC ${limitSql}`,
    )
    .all(...params) as unknown as DbBodyMetricRow[];

  return rows.map(mapBodyMetricRow);
}
