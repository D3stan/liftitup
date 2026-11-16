import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

const srcRoot = path.resolve(process.cwd(), 'src');
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.includes('/node_modules/')) {
      return nextResolve(specifier, context);
    }
    let target = specifier;
    if (specifier.startsWith('@/')) {
      target = path.join(srcRoot, specifier.slice(2));
    } else if (
      specifier.startsWith('.') &&
      context.parentURL &&
      !specifier.endsWith('.ts') &&
      !specifier.endsWith('.tsx')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      target = path.resolve(parentDir, specifier);
    }
    if (target !== specifier) {
      for (const candidate of [
        `${target}.ts`,
        `${target}.tsx`,
        path.join(target, 'index.ts'),
      ]) {
        if (fs.existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  setTestPool,
  closeDb,
  pingDb,
  query,
  queryOne,
  exec,
  withTransaction,
} = await import('../connection.ts');
const { initSchema, SCHEMA_VERSION } = await import('../schema.ts');
const {
  createUser,
  getUserById,
  updateUserSettings,
  deleteExpiredGuests,
} = await import('../users.ts');
const { recordBodyMetric, listBodyMetrics } = await import('../bodyMetrics.ts');
const {
  createAuthSession,
  getAuthSessionByTokenHash,
  upsertApiKey,
  getUserByApiKeyHash,
} = await import('../sessions.ts');

const { EXERCISE_CATALOG } = await import('../../exercises/catalog.ts');

function createPgMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const pool = new pgAdapter.Pool() as Pool;
  return { memDb, pool };
}

/**
 * Wraps a pg-mem Pool to record transaction SQL statements and emulate
 * BEGIN/ROLLBACK/SAVEPOINT snapshots (since pg-mem's MemPg adapter auto-commits
 * individual queries and does not parse SAVEPOINT).
 */
function createTransactionalMemPool(memDb: ReturnType<typeof newDb>) {
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const statements: string[] = [];
  const snapshots = new Map<string, ReturnType<typeof memDb.backup>>();
  let releaseCount = 0;

  const clientProxy = {
    async query(sql: string, params?: unknown[]) {
      const trimmed = sql.trim();
      statements.push(trimmed);

      if (trimmed === 'BEGIN') {
        snapshots.set('__tx__', memDb.backup());
        return { rows: [], rowCount: 0 };
      }
      if (trimmed === 'COMMIT') {
        snapshots.delete('__tx__');
        return { rows: [], rowCount: 0 };
      }
      if (trimmed === 'ROLLBACK') {
        snapshots.get('__tx__')?.restore();
        snapshots.delete('__tx__');
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith('SAVEPOINT ')) {
        const name = trimmed.slice('SAVEPOINT '.length);
        snapshots.set(name, memDb.backup());
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith('RELEASE SAVEPOINT ')) {
        const name = trimmed.slice('RELEASE SAVEPOINT '.length);
        snapshots.delete(name);
        return { rows: [], rowCount: 0 };
      }
      if (trimmed.startsWith('ROLLBACK TO SAVEPOINT ')) {
        const name = trimmed.slice('ROLLBACK TO SAVEPOINT '.length);
        snapshots.get(name)?.restore();
        snapshots.delete(name);
        return { rows: [], rowCount: 0 };
      }

      return params && params.length > 0
        ? innerPool.query(sql, params)
        : innerPool.query(sql);
    },
    release() {
      releaseCount += 1;
    },
  };

  const poolProxy = {
    query(sql: string, params?: unknown[]) {
      return clientProxy.query(sql, params);
    },
    async connect() {
      return clientProxy;
    },
    async end() {
      await innerPool.end();
    },
  } as unknown as Pool;

  return {
    pool: poolProxy,
    statements,
    getReleaseCount: () => releaseCount,
  };
}

test('pingDb initializes PostgreSQL schema v2 and syncs EXERCISE_CATALOG without seeding users', async () => {
  const { pool } = createPgMemPool();
  try {
    setTestPool(pool);
    await pingDb();

    const versionRow = await queryOne<{ version: number }>(
      'SELECT version FROM schema_version',
    );
    assert.equal(versionRow?.version, SCHEMA_VERSION);

    const userCount = await queryOne<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM users',
    );
    assert.equal(userCount?.c, 0);

    const catalogCount = await queryOne<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM exercises WHERE is_custom = 0',
    );
    assert.equal(catalogCount?.c, EXERCISE_CATALOG.length);
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('initSchema is idempotent and preserves custom exercises while syncing catalog', async () => {
  const { pool } = createPgMemPool();
  try {
    setTestPool(pool);
    await pingDb();

    const user = await createUser({
      username: 'lifter',
      displayName: 'Lifter',
      passwordHash: 'hash',
    });

    await query(
      `
      INSERT INTO exercises (
        id, user_id, slug, name, tracking_type, equipment, category,
        default_rest_seconds, is_custom, aliases_json, created_at
      ) VALUES ($1, $2, $3, $4, 'weight_reps', 'barbell', 'push', 120, 1, '[]', $5)
      `,
      [
        'custom-press',
        user.id,
        'custom-press',
        'My Custom Press',
        new Date().toISOString(),
      ],
    );

    const firstCatalogEx = EXERCISE_CATALOG[0];
    await query('UPDATE exercises SET name = $1 WHERE id = $2', [
      'Stale Name',
      firstCatalogEx.id,
    ]);

    await initSchema(pool);

    const versions = await query<{ version: number }>(
      'SELECT version FROM schema_version',
    );
    assert.equal(versions.rowCount, 1);

    const custom = await queryOne<{ name: string; is_custom: number }>(
      'SELECT name, is_custom FROM exercises WHERE id = $1',
      ['custom-press'],
    );
    assert.equal(custom?.name, 'My Custom Press');
    assert.equal(custom?.is_custom, 1);

    const synced = await queryOne<{ name: string }>(
      'SELECT name FROM exercises WHERE id = $1',
      [firstCatalogEx.id],
    );
    assert.equal(synced?.name, firstCatalogEx.name);
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('additive ALTER TABLE adds theme columns safely without wiping existing users', async () => {
  const { pool } = createPgMemPool();
  try {
    // Simulate a pre-theme users table with an existing user row
    await pool.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        height_cm DOUBLE PRECISION,
        weight_kg DOUBLE PRECISION NOT NULL DEFAULT 75,
        age INTEGER,
        training_years DOUBLE PRECISION,
        unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
        timezone TEXT NOT NULL DEFAULT 'UTC',
        enable_set_quality INTEGER NOT NULL DEFAULT 0 CHECK (enable_set_quality IN (0, 1)),
        apple_fitness_enabled INTEGER NOT NULL DEFAULT 1 CHECK (apple_fitness_enabled IN (0, 1)),
        is_guest INTEGER NOT NULL DEFAULT 0 CHECK (is_guest IN (0, 1)),
        last_active_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    await pool.query(
      `
      INSERT INTO users (
        id, username, display_name, password_hash, weight_kg,
        unit, timezone, enable_set_quality, apple_fitness_enabled,
        is_guest, last_active_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'kg', 'UTC', 0, 1, 0, $6, $6)
      `,
      ['usr_legacy', 'alex', 'Alex', 'hash_legacy', 82.5, now],
    );

    setTestPool(pool);
    await pingDb();

    const user = await getUserById('usr_legacy');
    assert.ok(user, 'Existing user must NOT be wiped by schema init');
    assert.equal(user.username, 'alex');
    assert.equal(user.displayName, 'Alex');
    assert.equal(user.weightKg, 82.5);
    assert.equal(user.theme, 'notebook');
    assert.equal(user.themeVariant, 'light');
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('withTransaction handles commit, rollback, and nested savepoints', async () => {
  const { memDb } = createPgMemPool();
  const { pool, statements, getReleaseCount } =
    createTransactionalMemPool(memDb);

  try {
    setTestPool(pool);
    await pingDb();
    statements.length = 0;

    // 1. Commit
    const created = await withTransaction(async () => {
      return createUser({
        id: 'usr_tx_commit',
        username: 'txcommit',
        displayName: 'Tx Commit',
        passwordHash: 'hash',
      });
    });
    assert.equal(created.id, 'usr_tx_commit');
    assert.ok(statements.includes('BEGIN'));
    assert.ok(statements.includes('COMMIT'));
    assert.ok(await getUserById('usr_tx_commit'));

    // 2. Rollback on error
    statements.length = 0;
    await assert.rejects(
      () =>
        withTransaction(async () => {
          await createUser({
            id: 'usr_tx_rollback',
            username: 'txrollback',
            displayName: 'Tx Rollback',
            passwordHash: 'hash',
          });
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.ok(statements.includes('BEGIN'));
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(await getUserById('usr_tx_rollback'), null);

    // 3. Nested savepoint rollback inside committed outer transaction
    statements.length = 0;
    await withTransaction(async () => {
      await createUser({
        id: 'usr_outer_ok',
        username: 'outerok',
        displayName: 'Outer OK',
        passwordHash: 'hash',
      });

      await assert.rejects(
        () =>
          withTransaction(async () => {
            await createUser({
              id: 'usr_inner_fail',
              username: 'innerfail',
              displayName: 'Inner Fail',
              passwordHash: 'hash',
            });
            throw new Error('inner boom');
          }),
        /inner boom/,
      );

      await withTransaction(async () => {
        await createUser({
          id: 'usr_inner_ok',
          username: 'innerok',
          displayName: 'Inner OK',
          passwordHash: 'hash',
        });
      });
    });

    assert.ok(statements.includes('SAVEPOINT sp_1'));
    assert.ok(statements.includes('ROLLBACK TO SAVEPOINT sp_1'));
    assert.ok(statements.includes('RELEASE SAVEPOINT sp_1'));
    assert.ok(await getUserById('usr_outer_ok'));
    assert.equal(await getUserById('usr_inner_fail'), null);
    assert.ok(await getUserById('usr_inner_ok'));
    assert.ok(getReleaseCount() >= 3);
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('core DB repositories (users, sessions, apiKeys, bodyMetrics, exec) work with pg-mem', async () => {
  const { pool } = createPgMemPool();
  try {
    setTestPool(pool);
    await exec('SELECT 1');

    const user = await createUser({
      username: 'CoreUser',
      displayName: 'Core User',
      passwordHash: 'pw_hash',
      isGuest: true,
    });
    assert.equal(user.username, 'coreuser');

    const updated = await updateUserSettings(user.id, {
      theme: 'cutecore',
      themeVariant: 'dark',
      weightKg: 78.5,
    });
    assert.equal(updated?.theme, 'cutecore');
    assert.equal(updated?.themeVariant, 'dark');
    assert.equal(updated?.weightKg, 78.5);

    const metric = await recordBodyMetric({
      userId: user.id,
      measuredOn: '2026-11-16',
      weightKg: 78.5,
      source: 'settings',
    });
    assert.equal(metric.weightKg, 78.5);

    const metrics = await listBodyMetrics(user.id);
    assert.equal(metrics.length, 1);

    await createAuthSession(user.id, 'tok_hash_1', '2099-01-01T00:00:00.000Z');
    const sess = await getAuthSessionByTokenHash('tok_hash_1');
    assert.equal(sess?.userId, user.id);

    await upsertApiKey(user.id, 'key_hash_1', 'liu_1234');
    const apiAuth = await getUserByApiKeyHash('key_hash_1');
    assert.equal(apiAuth?.user.id, user.id);

    // Verify nullable CHECK constraints allow NULL in pg-mem
    const now = new Date().toISOString();
    await query(
      `INSERT INTO workout_sessions (id, user_id, session_date, is_jolly, jolly_mode, title, started_at)
       VALUES ($1, $2, '2026-11-16', 0, NULL, 'Push', $3)`,
      ['sess_null_check', user.id, now],
    );
    await query(
      `INSERT INTO workout_exercises (id, session_id, exercise_id, order_index)
       VALUES ($1, $2, $3, 0)`,
      ['wex_null_check', 'sess_null_check', EXERCISE_CATALOG[0].id],
    );
    await query(
      `INSERT INTO workout_sets (id, workout_exercise_id, set_number, execution_quality_pct, is_completed, created_at)
       VALUES ($1, $2, 1, NULL, 1, $3)`,
      ['set_null_check', 'wex_null_check', now],
    );

    // Purging guests older than 0 hours removes the guest
    const purged = await deleteExpiredGuests(-1);
    assert.equal(purged, 1);
    assert.equal(await getUserById(user.id), null);
  } finally {
    await closeDb();
    setTestPool(null);
  }
});
