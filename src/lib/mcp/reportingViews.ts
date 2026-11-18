import { ApiError } from '@/lib/api/handler';
import { isPgMemActive, query, withTransaction } from '@/lib/db/connection';

export type ReportingViewColumnType = 'text' | 'number';

export interface ReportingViewSpec {
  name: ReportingViewName;
  description: string;
  columns: Record<string, ReportingViewColumnType>;
  defaultOrderBy: { column: string; direction: 'ASC' | 'DESC' };
}

export type ReportingViewName =
  | 'v_admin_user_activity'
  | 'v_admin_daily_workouts'
  | 'v_admin_exercise_usage'
  | 'v_admin_photo_storage'
  | 'v_admin_route_health'
  | 'v_admin_event_counts';

export const MAX_REPORTING_VIEW_ROWS = 100;
export const REPORTING_VIEW_TIMEOUT_MS = 3000;

export const REPORTING_VIEW_SPECS: Record<
  ReportingViewName,
  ReportingViewSpec
> = {
  v_admin_user_activity: {
    name: 'v_admin_user_activity',
    description:
      'Per-user activity, feature settings flags, API key usage timestamp, session counts, and photo storage totals (no notes, weights, hashes, or tokens).',
    columns: {
      user_id: 'text',
      username: 'text',
      is_guest: 'number',
      is_disabled: 'number',
      unit: 'text',
      theme: 'text',
      theme_variant: 'text',
      rest_clock_mode: 'text',
      default_workout_view: 'text',
      apple_fitness_enabled: 'number',
      has_api_key: 'number',
      api_key_last_used_at: 'text',
      created_at: 'text',
      last_active_at: 'text',
      session_count: 'number',
      last_session_date: 'text',
      photo_count: 'number',
      photo_bytes: 'number',
    },
    defaultOrderBy: { column: 'last_active_at', direction: 'DESC' },
  },
  v_admin_daily_workouts: {
    name: 'v_admin_daily_workouts',
    description:
      'Aggregate workout session counts, unique users, jolly sessions, and average duration per calendar day.',
    columns: {
      session_date: 'text',
      session_count: 'number',
      unique_user_count: 'number',
      jolly_session_count: 'number',
      avg_duration_minutes: 'number',
    },
    defaultOrderBy: { column: 'session_date', direction: 'DESC' },
  },
  v_admin_exercise_usage: {
    name: 'v_admin_exercise_usage',
    description:
      'Exercise catalog and custom exercise IDs, categories, tracking types, and aggregate log/user counts (excludes custom exercise text).',
    columns: {
      exercise_id: 'text',
      slug: 'text',
      catalog_name: 'text',
      tracking_type: 'text',
      equipment: 'text',
      category: 'text',
      is_custom: 'number',
      log_count: 'number',
      distinct_user_count: 'number',
    },
    defaultOrderBy: { column: 'log_count', direction: 'DESC' },
  },
  v_admin_photo_storage: {
    name: 'v_admin_photo_storage',
    description:
      'Per-user progress photo counts, byte sizes, quota, and timestamps (no image bytes or weights).',
    columns: {
      user_id: 'text',
      username: 'text',
      is_guest: 'number',
      effective_quota: 'number',
      photo_count: 'number',
      total_full_bytes: 'number',
      total_thumb_bytes: 'number',
      total_bytes: 'number',
      first_photo_at: 'text',
      last_photo_at: 'text',
    },
    defaultOrderBy: { column: 'total_bytes', direction: 'DESC' },
  },
  v_admin_route_health: {
    name: 'v_admin_route_health',
    description:
      'Hourly HTTP route metric buckets: request counts, 4xx/5xx counts, total and max latency.',
    columns: {
      bucket_start: 'text',
      route: 'text',
      method: 'text',
      request_count: 'number',
      error_4xx_count: 'number',
      error_5xx_count: 'number',
      total_duration_ms: 'number',
      max_duration_ms: 'number',
      updated_at: 'text',
    },
    defaultOrderBy: { column: 'bucket_start', direction: 'DESC' },
  },
  v_admin_event_counts: {
    name: 'v_admin_event_counts',
    description:
      'Aggregated telemetry counts, distinct users, and first/last timestamps by event_type.',
    columns: {
      event_type: 'text',
      event_count: 'number',
      distinct_user_count: 'number',
      first_at: 'text',
      last_at: 'text',
    },
    defaultOrderBy: { column: 'event_count', direction: 'DESC' },
  },
};

export const REPORTING_VIEW_NAMES = Object.keys(
  REPORTING_VIEW_SPECS,
) as ReportingViewName[];

const ALLOWED_FILTER_OPS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
]);

export interface ReportingViewFilterInput {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like';
  value: string | number | boolean | null;
}

export interface ReportingViewQueryInput {
  view: unknown;
  columns?: unknown;
  filters?: unknown;
  orderBy?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export interface ReportingViewQueryResult {
  view: ReportingViewName;
  columns: string[];
  rowCount: number;
  limit: number;
  offset: number;
  rows: Array<Record<string, unknown>>;
}

function isReportingViewName(value: unknown): value is ReportingViewName {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(REPORTING_VIEW_SPECS, value)
  );
}

export function listReportingViewsMetadata() {
  return REPORTING_VIEW_NAMES.map((name) => {
    const spec = REPORTING_VIEW_SPECS[name];
    return {
      name: spec.name,
      description: spec.description,
      columns: Object.entries(spec.columns).map(([column, type]) => ({
        column,
        type,
      })),
      defaultOrderBy: spec.defaultOrderBy,
    };
  });
}

/**
 * Queries one of the fixed, privacy-safe SQL reporting views using strictly
 * allowlisted views, columns, operators, and parameterized values inside a
 * read-only, statement-timeout-guarded transaction with hard row limits.
 */
export async function queryReportingView(
  input: ReportingViewQueryInput,
): Promise<ReportingViewQueryResult> {
  if (!isReportingViewName(input.view)) {
    throw ApiError.validation(
      `Invalid reporting view. Allowed views: ${REPORTING_VIEW_NAMES.join(', ')}`,
    );
  }

  const spec = REPORTING_VIEW_SPECS[input.view];
  const allowedCols = Object.keys(spec.columns);
  const allowedSet = new Set(allowedCols);

  let selectedColumns = allowedCols;
  if (input.columns !== undefined) {
    if (!Array.isArray(input.columns) || input.columns.length === 0) {
      throw ApiError.validation('columns must be a non-empty array of view column names');
    }
    const deduped: string[] = [];
    for (const rawCol of input.columns) {
      if (typeof rawCol !== 'string' || !allowedSet.has(rawCol)) {
        throw ApiError.validation(
          `Invalid column "${String(rawCol)}" for view ${spec.name}`,
        );
      }
      if (!deduped.includes(rawCol)) {
        deduped.push(rawCol);
      }
    }
    selectedColumns = deduped;
  }

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (input.filters !== undefined) {
    if (!Array.isArray(input.filters)) {
      throw ApiError.validation('filters must be an array');
    }
    if (input.filters.length > 10) {
      throw ApiError.validation('At most 10 filters are allowed per query');
    }
    for (let i = 0; i < input.filters.length; i += 1) {
      const f = input.filters[i] as Partial<ReportingViewFilterInput> | null;
      if (!f || typeof f !== 'object') {
        throw ApiError.validation(`filters[${i}] must be an object`);
      }
      if (typeof f.column !== 'string' || !allowedSet.has(f.column)) {
        throw ApiError.validation(
          `filters[${i}].column "${String(f.column)}" is not allowed on view ${spec.name}`,
        );
      }
      if (typeof f.op !== 'string' || !ALLOWED_FILTER_OPS.has(f.op)) {
        throw ApiError.validation(
          `filters[${i}].op must be one of eq, neq, gt, gte, lt, lte, like`,
        );
      }

      const colType = spec.columns[f.column];
      const val = f.value;

      if (val === undefined) {
        throw ApiError.validation(`filters[${i}].value is required`);
      }

      if (val === null) {
        if (f.op === 'eq') {
          whereClauses.push(`${f.column} IS NULL`);
          continue;
        }
        if (f.op === 'neq') {
          whereClauses.push(`${f.column} IS NOT NULL`);
          continue;
        }
        throw ApiError.validation(
          `filters[${i}]: null value is only valid with eq or neq`,
        );
      }

      let boundVal: string | number = typeof val === 'boolean' ? (val ? 1 : 0) : val;
      if (colType === 'number') {
        if (typeof boundVal !== 'number' || !Number.isFinite(boundVal)) {
          throw ApiError.validation(
            `filters[${i}].value must be a finite number for column ${f.column}`,
          );
        }
        if (f.op === 'like') {
          throw ApiError.validation(
            `filters[${i}]: "like" operator is only valid on text columns`,
          );
        }
      } else {
        if (typeof boundVal !== 'string') {
          throw ApiError.validation(
            `filters[${i}].value must be a string for column ${f.column}`,
          );
        }
        if (boundVal.length > 200) {
          throw ApiError.validation(
            `filters[${i}].value cannot exceed 200 characters`,
          );
        }
      }

      params.push(boundVal);
      const placeholder = `$${params.length}`;
      switch (f.op) {
        case 'eq':
          whereClauses.push(`${f.column} = ${placeholder}`);
          break;
        case 'neq':
          whereClauses.push(`${f.column} <> ${placeholder}`);
          break;
        case 'gt':
          whereClauses.push(`${f.column} > ${placeholder}`);
          break;
        case 'gte':
          whereClauses.push(`${f.column} >= ${placeholder}`);
          break;
        case 'lt':
          whereClauses.push(`${f.column} < ${placeholder}`);
          break;
        case 'lte':
          whereClauses.push(`${f.column} <= ${placeholder}`);
          break;
        case 'like':
          whereClauses.push(`LOWER(${f.column}) LIKE LOWER(${placeholder})`);
          break;
      }
    }
  }

  let orderCol = spec.defaultOrderBy.column;
  let orderDir: 'ASC' | 'DESC' = spec.defaultOrderBy.direction;
  if (input.orderBy !== undefined) {
    if (!input.orderBy || typeof input.orderBy !== 'object') {
      throw ApiError.validation('orderBy must be an object');
    }
    const ob = input.orderBy as { column?: unknown; direction?: unknown };
    if (typeof ob.column !== 'string' || !allowedSet.has(ob.column)) {
      throw ApiError.validation(
        `Invalid orderBy.column "${String(ob.column)}" for view ${spec.name}`,
      );
    }
    orderCol = ob.column;
    if (ob.direction !== undefined) {
      const dir = String(ob.direction).toLowerCase();
      if (dir !== 'asc' && dir !== 'desc') {
        throw ApiError.validation('orderBy.direction must be "asc" or "desc"');
      }
      orderDir = dir === 'asc' ? 'ASC' : 'DESC';
    }
  }

  let limit = 50;
  if (input.limit !== undefined) {
    if (
      typeof input.limit !== 'number' ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_REPORTING_VIEW_ROWS
    ) {
      throw ApiError.validation(
        `limit must be an integer between 1 and ${MAX_REPORTING_VIEW_ROWS}`,
      );
    }
    limit = input.limit;
  }

  let offset = 0;
  if (input.offset !== undefined) {
    if (
      typeof input.offset !== 'number' ||
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 10_000
    ) {
      throw ApiError.validation('offset must be an integer between 0 and 10000');
    }
    offset = input.offset;
  }

  const colsSql = selectedColumns.join(', ');
  const whereSql =
    whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const sql = `SELECT ${colsSql} FROM ${spec.name}${whereSql} ORDER BY ${orderCol} ${orderDir} NULLS LAST LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;

  const rows = await withTransaction(async () => {
    const pgMem = isPgMemActive();
    await query(`SET LOCAL statement_timeout = ${REPORTING_VIEW_TIMEOUT_MS}`);
    if (!pgMem) {
      await query('SET TRANSACTION READ ONLY');
    }

    const res = await query<Record<string, unknown>>(sql, params);
    return res.rows;
  });

  const normalizedRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const col of selectedColumns) {
      const val = r[col];
      if (val === undefined) {
        out[col] = null;
      } else if (spec.columns[col] === 'number' && val !== null) {
        out[col] = Number(val);
      } else {
        out[col] = val;
      }
    }
    return out;
  });

  return {
    view: spec.name,
    columns: selectedColumns,
    rowCount: normalizedRows.length,
    limit,
    offset,
    rows: normalizedRows,
  };
}
