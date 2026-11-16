import crypto from 'node:crypto';
import { Pool } from 'pg';
import { closeDb, pingDb, setTestPool } from '@/lib/db/connection';
import { initSchema } from '@/lib/db/schema';

export const DEFAULT_TEST_POSTGRES_URL =
  'postgres://liftitup:liftitup@localhost:5432/liftitup';

export function resolveTestPostgresUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    DEFAULT_TEST_POSTGRES_URL
  );
}

export interface RealPostgresTestContext {
  databaseName: string;
  connectionString: string;
  pool: Pool;
  teardown: () => Promise<void>;
}

/**
 * Creates an isolated temporary PostgreSQL database for integration tests,
 * connects a Pool, wires it into `setTestPool`, and initializes the full schema.
 * Call `teardown()` in `t.after(...)` / `after(...)` to close connections and drop the DB.
 * Designed for reuse across phases (Phase 8, Phase 10, etc.).
 */
export async function setupRealPostgresTestDb(
  label = 'test',
): Promise<RealPostgresTestContext> {
  const baseUrl = resolveTestPostgresUrl();
  const safeLabel =
    label
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 20) || 'test';
  const databaseName = `liftitup_test_${safeLabel}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const adminUrl = new URL(baseUrl);
  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    max: 2,
  });

  try {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await adminPool.end();
  }

  const dbUrl = new URL(baseUrl);
  dbUrl.pathname = `/${databaseName}`;
  const connectionString = dbUrl.toString();

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
  });

  setTestPool(pool);
  await initSchema(pool);
  await pingDb();

  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    await closeDb();

    const dropPool = new Pool({
      connectionString: adminUrl.toString(),
      max: 2,
    });
    try {
      await dropPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    } finally {
      await dropPool.end();
    }
  };

  return {
    databaseName,
    connectionString,
    pool,
    teardown,
  };
}
