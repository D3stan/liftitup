import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { logger } from '@/lib/logger';
import { initSchema } from './schema';

export type QueryResultLike<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
};

interface TxContext {
  client: PoolClient;
  depth: number;
}

const txStorage = new AsyncLocalStorage<TxContext>();

const POOL_MAX_CONNECTIONS = 10;
const MAX_SLOW_QUERY_ENTRIES = 50;
const DEFAULT_SLOW_QUERY_THRESHOLD_MS = (() => {
  const raw = Number(process.env.ADMIN_SLOW_QUERY_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
})();

export interface DbPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
}

export interface SlowQueryRecord {
  sql: string;
  durationMs: number;
  recordedAt: string;
}

export interface DbHealthStats {
  pool: DbPoolStats;
  totalQueriesExecuted: number;
  slowQueryThresholdMs: number;
  slowQueries: SlowQueryRecord[];
}

let poolInstance: Pool | null = null;
let initPromise: Promise<void> | null = null;
let totalQueriesExecuted = 0;
let slowQueryThresholdMs = DEFAULT_SLOW_QUERY_THRESHOLD_MS;
const slowQueryBuffer: SlowQueryRecord[] = [];

function sanitizeSlowSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function recordQueryTiming(sql: string, durationMs: number): void {
  totalQueriesExecuted += 1;
  if (durationMs >= slowQueryThresholdMs) {
    slowQueryBuffer.unshift({
      sql: sanitizeSlowSql(sql),
      durationMs: Math.round(durationMs * 100) / 100,
      recordedAt: new Date().toISOString(),
    });
    if (slowQueryBuffer.length > MAX_SLOW_QUERY_ENTRIES) {
      slowQueryBuffer.length = MAX_SLOW_QUERY_ENTRIES;
    }
  }
}

export function isPgMemActive(): boolean {
  return poolInstance ? isPgMemPool(poolInstance) : false;
}

export function hasActivePool(): boolean {
  return Boolean(poolInstance || process.env.DATABASE_URL);
}

export function setSlowQueryThresholdMsForTests(ms: number): void {
  slowQueryThresholdMs = Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_SLOW_QUERY_THRESHOLD_MS;
}

export function resetDbHealthStatsForTests(): void {
  totalQueriesExecuted = 0;
  slowQueryBuffer.length = 0;
  slowQueryThresholdMs = DEFAULT_SLOW_QUERY_THRESHOLD_MS;
}

export function getDbHealthStats(): DbHealthStats {
  const p = poolInstance as
    | (Pool & { totalCount?: number; idleCount?: number; waitingCount?: number })
    | null;
  return {
    pool: {
      totalCount: Number(p?.totalCount ?? 0),
      idleCount: Number(p?.idleCount ?? 0),
      waitingCount: Number(p?.waitingCount ?? 0),
      maxConnections: POOL_MAX_CONNECTIONS,
    },
    totalQueriesExecuted,
    slowQueryThresholdMs,
    slowQueries: [...slowQueryBuffer],
  };
}

function isPgMemPool(pool: Pool): boolean {
  return (
    pool.constructor?.name === 'MemPg' ||
    Boolean((pool as unknown as { __isPgMem?: boolean }).__isPgMem)
  );
}

function getPool(): Pool {
  if (poolInstance) {
    return poolInstance;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  poolInstance = new Pool({
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
  });
  return poolInstance;
}

async function ensureSchema(): Promise<Pool> {
  const pool = getPool();
  if (!initPromise) {
    initPromise = initSchema(pool).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
  return pool;
}

/**
 * Overrides or clears the active Pool instance for unit tests (e.g., pg-mem).
 * Resets cached schema initialization state.
 */
export function setTestPool(pool: Pool | null): void {
  const prev = poolInstance;
  initPromise = null;
  poolInstance = pool;
  if (prev && prev !== pool) {
    void prev.end().catch(() => {});
  }
}

/**
 * Closes the singleton Pool and clears cached schema initialization state.
 */
export async function closeDb(): Promise<void> {
  initPromise = null;
  if (poolInstance) {
    const toClose = poolInstance;
    poolInstance = null;
    await toClose.end();
  }
}

/**
 * Ensures the database schema is initialized and verifies connectivity.
 */
export async function pingDb(): Promise<void> {
  const pool = await ensureSchema();
  await pool.query('SELECT 1');
}

/**
 * Executes a parameterized PostgreSQL query against the active transaction client
 * (when inside `withTransaction`) or the singleton Pool.
 */
export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<QueryResultLike<T>> {
  const pool = await ensureSchema();
  const tx = txStorage.getStore();
  const runner = tx ? tx.client : pool;
  const startedAt = performance.now();
  try {
    const res =
      params && params.length > 0
        ? await runner.query<T>(sql, params)
        : await runner.query<T>(sql);
    recordQueryTiming(sql, performance.now() - startedAt);
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? 0,
    };
  } catch (err) {
    recordQueryTiming(sql, performance.now() - startedAt);
    throw err;
  }
}

/**
 * Executes a parameterized query and returns the first row or null.
 */
export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const res = await query<T>(sql, params);
  return res.rows[0] ?? null;
}

/**
 * Executes raw SQL/DDL statements against the active transaction client or Pool.
 */
export async function exec(sql: string): Promise<void> {
  const pool = await ensureSchema();
  const tx = txStorage.getStore();
  const runner = tx ? tx.client : pool;
  const startedAt = performance.now();
  try {
    await runner.query(sql);
  } finally {
    recordQueryTiming(sql, performance.now() - startedAt);
  }
}

/**
 * Runs an async callback inside a PostgreSQL transaction using AsyncLocalStorage.
 * Nested calls automatically use SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO SAVEPOINT.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const pool = await ensureSchema();
  const existing = txStorage.getStore();

  if (existing) {
    if (isPgMemPool(pool)) {
      return txStorage.run(
        { client: existing.client, depth: existing.depth + 1 },
        fn,
      );
    }

    const savepoint = `sp_${existing.depth}`;
    await existing.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await txStorage.run(
        { client: existing.client, depth: existing.depth + 1 },
        fn,
      );
      await existing.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (err) {
      try {
        await existing.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch {
        // ignore rollback failure if connection/transaction aborted
      }
      throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run({ client, depth: 1 }, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure if connection closed
    }
    throw err;
  } finally {
    client.release();
  }
}

const SHUTDOWN_KEY = Symbol.for('liftitup.db.shutdownRegistered');

function registerShutdownHandlers(): void {
  if (typeof process === 'undefined' || typeof process.once !== 'function') {
    return;
  }
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[SHUTDOWN_KEY]) {
    return;
  }
  g[SHUTDOWN_KEY] = true;

  const onSignal = () => {
    void closeDb().catch((err) => {
      logger.warn('failed to close PostgreSQL pool on shutdown', { err });
    });
  };

  try {
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  } catch {
    // ignore in restricted/test runtimes
  }
}

registerShutdownHandlers();
