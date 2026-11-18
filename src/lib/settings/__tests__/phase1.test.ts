import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { newDb } from 'pg-mem';

const srcRoot = path.resolve(process.cwd(), 'src');
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.includes('/node_modules/')) {
      return nextResolve(specifier, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
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
        target,
        `${target}.ts`,
        `${target}.tsx`,
        path.join(target, 'index.ts'),
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { NextRequest } = await import('next/server');
const { setTestPool, closeDb, query, queryOne } = await import(
  '@/lib/db/connection'
);
const { createUser, getUserById, deleteExpiredGuests } = await import(
  '@/lib/db/users'
);
const {
  deleteUserWorkoutHistory,
  deleteUserBodyData,
  deleteUserSplitData,
  deleteUserAccount,
} = await import('@/lib/db/userDeletion');
const { recordBodyMetric, listBodyMetrics } = await import(
  '@/lib/db/bodyMetrics'
);
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { generateApiKey, hashToken, requireSessionAuth, SESSION_COOKIE_NAME } =
  await import('@/lib/auth/session');
const { createGuestSandbox } = await import('@/lib/auth/sandbox');
const { EXERCISE_CATALOG } = await import('@/lib/exercises/catalog');
const { POST: dangerRoutePost } = await import(
  '@/app/api/settings/danger/route'
);
const { filterSettingsItems, getVisibleSettingsCategories } = await import(
  '@/lib/settings/registry'
);

function createInstrumentedMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const sqlLog: string[] = [];

  const wrapClient = (client: PoolClient) =>
    ({
      async query(sql: string, params?: unknown[]) {
        sqlLog.push(sql.trim());
        const trimmed = sql.trim();
        if (
          trimmed === 'BEGIN' ||
          trimmed === 'COMMIT' ||
          trimmed === 'ROLLBACK'
        ) {
          return { rows: [], rowCount: 0 };
        }
        return params && params.length > 0
          ? client.query(sql, params)
          : client.query(sql);
      },
      release() {
        client.release();
      },
    }) as unknown as PoolClient;

  const pool = {
    async connect() {
      const c = await innerPool.connect();
      return wrapClient(c);
    },
    async query(sql: string, params?: unknown[]) {
      sqlLog.push(sql.trim());
      return params && params.length > 0
        ? innerPool.query(sql, params)
        : innerPool.query(sql);
    },
    async end() {
      await innerPool.end();
    },
  } as unknown as Pool;

  return { pool, sqlLog };
}

async function seedRichUserData(
  userId: string,
  suffix: string,
  options?: { isGuest?: boolean; lastActiveAt?: string },
) {
  const now = options?.lastActiveAt ?? new Date().toISOString();
  const user = await createUser({
    id: userId,
    username: `user_${suffix}`,
    displayName: `User ${suffix}`,
    passwordHash: 'hash',
    weightKg: 82.5,
    isGuest: options?.isGuest ?? false,
  });

  if (options?.lastActiveAt) {
    await query('UPDATE users SET last_active_at = $1 WHERE id = $2', [
      options.lastActiveAt,
      userId,
    ]);
  }

  // Custom exercise
  const customExId = `custom_ex_${suffix}`;
  await query(
    `INSERT INTO exercises (id, user_id, slug, name, tracking_type, equipment, category, default_rest_seconds, is_custom, aliases_json, created_at)
     VALUES ($1, $2, $3, $4, 'weight_reps', 'barbell', 'chest', 120, 1, '[]', $5)`,
    [customExId, userId, `custom-${suffix}`, `Custom Lift ${suffix}`, now],
  );

  // Hidden catalog exercise
  await query(
    `INSERT INTO hidden_exercises (user_id, exercise_id, hidden_at)
     VALUES ($1, $2, $3)`,
    [userId, EXERCISE_CATALOG[0].id, now],
  );

  // Schedule + day + day exercise (referencing custom exercise!) + event
  const schedId = `sched_${suffix}`;
  const dayId = `day_${suffix}`;
  const sdeId = `sde_${suffix}`;
  await query(
    `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
     VALUES ($1, $2, 'PPL', 1, '2026-11-01', 0, $3, $3)`,
    [schedId, userId, now],
  );
  await query(
    `INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
     VALUES ($1, $2, 0, 'Push', 0)`,
    [dayId, schedId],
  );
  await query(
    `INSERT INTO schedule_day_exercises (id, schedule_day_id, exercise_id, order_index)
     VALUES ($1, $2, $3, 0)`,
    [sdeId, dayId, customExId],
  );
  await query(
    `INSERT INTO schedule_events (id, user_id, schedule_id, event_date, event_type, created_at)
     VALUES ($1, $2, $3, '2026-11-10', 'skip', $4)`,
    [`evt_${suffix}`, userId, schedId, now],
  );

  // Session + workout_exercise (referencing custom exercise!) + set + rep quality + swap
  const sessId = `sess_${suffix}`;
  const wexId = `wex_${suffix}`;
  const setId = `set_${suffix}`;
  await query(
    `INSERT INTO workout_sessions (id, user_id, session_date, schedule_id, schedule_day_id, is_jolly, jolly_mode, title, started_at, completed_at)
     VALUES ($1, $2, '2026-11-15', $3, $4, 0, NULL, 'Push', $5, $5)`,
    [sessId, userId, schedId, dayId, now],
  );
  await query(
    `INSERT INTO workout_exercises (id, session_id, exercise_id, order_index)
     VALUES ($1, $2, $3, 0)`,
    [wexId, sessId, customExId],
  );
  await query(
    `INSERT INTO workout_sets (id, workout_exercise_id, set_number, weight_kg, reps, is_completed, created_at)
     VALUES ($1, $2, 1, 100, 5, 1, $3)`,
    [setId, wexId, now],
  );
  await query(
    `INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
     VALUES ($1, $2, 0, 95)`,
    [`rq_${suffix}`, setId],
  );
  await query(
    `INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id)
     VALUES ($1, '2026-11-15', $2, $3)`,
    [userId, sdeId, EXERCISE_CATALOG[0].id],
  );

  // Body metric
  await recordBodyMetric({
    userId,
    measuredOn: '2026-11-15',
    weightKg: 82.5,
    source: 'settings',
  });

  // Apple health workout linked to session
  const ahId = `ah_${suffix}`;
  await query(
    `INSERT INTO apple_health_workouts (id, user_id, workout_type, started_at, duration_minutes, active_calories, linked_session_id, created_at)
     VALUES ($1, $2, 'Traditional Strength Training', $3, 45, 300, $4, $3)`,
    [ahId, userId, now, sessId],
  );

  // API key & auth session
  const rawToken = `tok_${suffix}_${crypto.randomBytes(8).toString('hex')}`;
  await createAuthSession(
    userId,
    hashToken(rawToken),
    new Date(Date.now() + 86_400_000).toISOString(),
  );
  const apiKey = generateApiKey();
  await upsertApiKey(userId, apiKey.keyHash, apiKey.keyPrefix);

  return {
    user,
    rawToken,
    rawApiKey: apiKey.rawKey,
    customExId,
    schedId,
    dayId,
    sdeId,
    sessId,
    wexId,
    setId,
    ahId,
  };
}

async function countRows(table: string, where = '1=1', params: unknown[] = []) {
  const row = await queryOne<{ cnt: string | number }>(
    `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${where}`,
    params,
  );
  return Number(row?.cnt ?? 0);
}

test('danger zone actions scope strictly to target user and preserve second user & catalog', async () => {
  const { pool } = createInstrumentedMemPool();
  setTestPool(pool);

  try {
    const u1 = await seedRichUserData('usr_one', 'one');
    const u2 = await seedRichUserData('usr_two', 'two');
    const initialCatalogCount = await countRows(
      'exercises',
      'user_id IS NULL AND is_custom = 0',
    );
    assert.equal(initialCatalogCount, EXERCISE_CATALOG.length);

    // 1. Delete workout history for u1
    await deleteUserWorkoutHistory(u1.user.id);
    assert.equal(
      await countRows('workout_sessions', 'user_id = $1', [u1.user.id]),
      0,
    );
    assert.equal(
      await countRows('workout_exercises', 'id = $1', [u1.wexId]),
      0,
    );
    assert.equal(await countRows('workout_sets', 'id = $1', [u1.setId]), 0);
    assert.equal(
      await countRows('workout_set_rep_qualities', 'workout_set_id = $1', [
        u1.setId,
      ]),
      0,
    );
    assert.equal(
      await countRows('session_swaps', 'user_id = $1', [u1.user.id]),
      0,
    );
    const u1Ah = await queryOne<{ linked_session_id: string | null }>(
      'SELECT linked_session_id FROM apple_health_workouts WHERE id = $1',
      [u1.ahId],
    );
    assert.ok(u1Ah);
    assert.equal(u1Ah.linked_session_id, null);
    // Kept for u1: split, custom exercise, body metrics
    assert.equal(
      await countRows('schedules', 'user_id = $1', [u1.user.id]),
      1,
    );
    assert.equal(
      await countRows('exercises', 'user_id = $1', [u1.user.id]),
      1,
    );
    assert.equal((await listBodyMetrics(u1.user.id)).length, 1);

    // 2. Delete body data for u1
    await deleteUserBodyData(u1.user.id);
    assert.equal((await listBodyMetrics(u1.user.id)).length, 0);
    const u1AfterBody = await getUserById(u1.user.id);
    assert.equal(u1AfterBody?.weightKg, 75);
    assert.equal(
      await countRows('schedules', 'user_id = $1', [u1.user.id]),
      1,
    );

    // 3. Reset split for u2 (who still has a linked session!)
    await deleteUserSplitData(u2.user.id);
    assert.equal(
      await countRows('schedules', 'user_id = $1', [u2.user.id]),
      0,
    );
    assert.equal(
      await countRows('schedule_days', 'id = $1', [u2.dayId]),
      0,
    );
    assert.equal(
      await countRows('schedule_day_exercises', 'id = $1', [u2.sdeId]),
      0,
    );
    assert.equal(
      await countRows('schedule_events', 'user_id = $1', [u2.user.id]),
      0,
    );
    const u2Sess = await queryOne<{
      schedule_id: string | null;
      schedule_day_id: string | null;
    }>(
      'SELECT schedule_id, schedule_day_id FROM workout_sessions WHERE id = $1',
      [u2.sessId],
    );
    assert.ok(u2Sess);
    assert.equal(u2Sess.schedule_id, null);
    assert.equal(u2Sess.schedule_day_id, null);
    // u2's custom exercise and u1's schedule were untouched
    assert.equal(
      await countRows('exercises', 'user_id = $1', [u2.user.id]),
      1,
    );
    assert.equal(
      await countRows('schedules', 'user_id = $1', [u1.user.id]),
      1,
    );

    // Re-check u2 still has its body data and workout session intact
    assert.equal((await listBodyMetrics(u2.user.id)).length, 1);
    assert.equal((await getUserById(u2.user.id))?.weightKg, 82.5);
    assert.equal(
      await countRows('workout_sessions', 'user_id = $1', [u2.user.id]),
      1,
    );

    // Catalog untouched
    assert.equal(
      await countRows('exercises', 'user_id IS NULL AND is_custom = 0'),
      initialCatalogCount,
    );
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('deleteUserAccount and deleteExpiredGuests delete custom exercises used in both sessions and splits in child-to-parent order', async () => {
  const { pool, sqlLog } = createInstrumentedMemPool();
  setTestPool(pool);

  try {
    const u1 = await seedRichUserData('usr_del_1', 'del1');
    const u2 = await seedRichUserData('usr_keep_2', 'keep2');

    sqlLog.length = 0;
    const deleted = await deleteUserAccount(u1.user.id);
    assert.equal(deleted, true);
    assert.equal(await getUserById(u1.user.id), null);

    // Verify explicit child-to-parent order in SQL log:
    // workout_exercises and schedule_day_exercises MUST be deleted before exercises,
    // and exercises MUST be deleted before users.
    const idxWorkoutEx = sqlLog.findIndex((s) =>
      s.startsWith('DELETE FROM workout_exercises'),
    );
    const idxSchedDayEx = sqlLog.findIndex((s) =>
      s.startsWith('DELETE FROM schedule_day_exercises'),
    );
    const idxExercises = sqlLog.findIndex((s) =>
      s.startsWith('DELETE FROM exercises'),
    );
    const idxUsers = sqlLog.findIndex((s) =>
      s.startsWith('DELETE FROM users'),
    );
    assert.ok(idxWorkoutEx >= 0);
    assert.ok(idxSchedDayEx >= 0);
    assert.ok(idxExercises > idxWorkoutEx);
    assert.ok(idxExercises > idxSchedDayEx);
    assert.ok(idxUsers > idxExercises);

    // u2 and catalog completely untouched
    assert.ok(await getUserById(u2.user.id));
    assert.equal(
      await countRows('workout_sessions', 'user_id = $1', [u2.user.id]),
      1,
    );
    assert.equal(
      await countRows('schedules', 'user_id = $1', [u2.user.id]),
      1,
    );
    assert.equal(
      await countRows('exercises', 'user_id IS NULL AND is_custom = 0'),
      EXERCISE_CATALOG.length,
    );

    // Now test deleteExpiredGuests with custom exercise used in BOTH session and split
    const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const expiredGuest = await seedRichUserData('usr_guest_exp', 'gexp', {
      isGuest: true,
      lastActiveAt: oldIso,
    });
    const purged = await deleteExpiredGuests(24);
    assert.equal(purged, 1);
    assert.equal(await getUserById(expiredGuest.user.id), null);
    assert.equal(
      await countRows('exercises', 'id = $1', [expiredGuest.customExId]),
      0,
    );
    assert.ok(await getUserById(u2.user.id));
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('POST /api/settings/danger and requireSessionAuth reject API keys, guests, and invalid confirmations; accept session cookie', async () => {
  const { pool } = createInstrumentedMemPool();
  setTestPool(pool);

  try {
    const u1 = await seedRichUserData('usr_route_1', 'r1');
    const guest = await createGuestSandbox('UTC');
    const guestToken = `gtok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      guest.id,
      hashToken(guestToken),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    // 1. No auth -> 401
    const resUnauth = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_workouts',
          confirmation: 'DELETE',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resUnauth.status, 401);

    // 2. Bearer API key only -> 403
    const resBearer = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${u1.rawApiKey}`,
        },
        body: JSON.stringify({
          action: 'delete_workouts',
          confirmation: 'DELETE',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resBearer.status, 403);

    // 3. x-api-key header (even with session cookie!) -> 403
    const resApiKeyAndCookie = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': u1.rawApiKey,
          cookie: `${SESSION_COOKIE_NAME}=${u1.rawToken}`,
        },
        body: JSON.stringify({
          action: 'delete_workouts',
          confirmation: 'DELETE',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resApiKeyAndCookie.status, 403);

    // Direct requireSessionAuth check with Bearer rejects
    await assert.rejects(
      () =>
        requireSessionAuth(
          new NextRequest('http://localhost/api/settings/danger', {
            headers: { authorization: `Bearer ${u1.rawApiKey}` },
          }),
        ),
      { status: 403 },
    );

    // 4. Guest user with valid session cookie -> 403
    const resGuest = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${guestToken}`,
        },
        body: JSON.stringify({
          action: 'delete_account',
          confirmation: 'DELETE',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resGuest.status, 403);

    // 5. Wrong confirmation word -> 400
    const resBadConfirm = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${u1.rawToken}`,
        },
        body: JSON.stringify({
          action: 'reset_split',
          confirmation: 'DELETE',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resBadConfirm.status, 400);

    // 6. Valid session cookie + confirmation on delete_account -> 200 and clears cookie
    const resDeleteAccount = await dangerRoutePost(
      new NextRequest('http://localhost/api/settings/danger', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${u1.rawToken}`,
        },
        body: JSON.stringify({
          action: 'delete_account',
          confirmation: 'delete',
        }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resDeleteAccount.status, 200);
    assert.equal(await getUserById(u1.user.id), null);
    const setCookieHeader = resDeleteAccount.headers.get('set-cookie') ?? '';
    assert.ok(setCookieHeader.includes(`${SESSION_COOKIE_NAME}=;`));
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('settings search registry filters across categories by name and keywords and hides danger zone for guests', () => {
  assert.equal(getVisibleSettingsCategories({ isGuest: false }).length, 7);
  const guestCats = getVisibleSettingsCategories({ isGuest: true });
  assert.equal(guestCats.length, 6);
  assert.equal(
    guestCats.some((c) => c.id === 'danger'),
    false,
  );

  const themeMatches = filterSettingsItems('theme');
  assert.ok(themeMatches.some((i) => i.href === '/settings/appearance'));

  const exportMatches = filterSettingsItems('export');
  assert.ok(exportMatches.some((i) => i.href === '/settings/data'));

  const qualityMatches = filterSettingsItems('execution quality');
  assert.ok(qualityMatches.some((i) => i.href === '/settings/training#set-quality'));

  const deleteMatchesUser = filterSettingsItems('delete', { isGuest: false });
  assert.equal(deleteMatchesUser.length, 4);

  const deleteMatchesGuest = filterSettingsItems('delete', { isGuest: true });
  assert.equal(deleteMatchesGuest.length, 0);
});
