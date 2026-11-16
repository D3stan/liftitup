import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const {
  adjustRestClockTarget,
  computeRestClockState,
  computeSessionDurationMinutes,
  computeSessionElapsedSeconds,
  createRestClock,
  dismissRestClock,
  formatClockSeconds,
  resolveSessionStart,
  shouldFireRestAlert,
  stopRestClock,
} = await import('@/lib/workouts/clock');
const { closeDb, setTestPool, pingDb } = await import('@/lib/db/connection');
const { createUser, getUserById, updateUserSettings } = await import(
  '@/lib/db/users'
);
const { createAuthSession } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { PATCH: settingsPatchRoute } = await import('@/app/api/settings/route');
const { buildUserExportJson } = await import('@/lib/export/exportData');
const { handleMcpJsonRpcRequest } = await import('@/lib/mcp/server');
const { getWorkoutDayView } = await import('@/lib/workouts/queries');
const { filterSettingsItems } = await import('@/lib/settings/registry');

test('rest clock derives elapsed, remaining, and target-reached from stored start timestamp in stopwatch & countdown modes', () => {
  const startIso = '2026-11-16T10:00:00.000Z';
  const startMs = Date.parse(startIso);

  // Stopwatch mode: counts up past target with no upper limit
  const sw = createRestClock({
    startedAt: startIso,
    targetSeconds: 90,
    mode: 'stopwatch',
    label: 'Bench Press',
    exerciseLocalId: 'ex_1',
    setLocalId: 'set_1',
  });

  const swAt45 = computeRestClockState(sw, startMs + 45_000);
  assert.equal(swAt45.isActive, true);
  assert.equal(swAt45.mode, 'stopwatch');
  assert.equal(swAt45.elapsedSeconds, 45);
  assert.equal(swAt45.remainingSeconds, 45);
  assert.equal(swAt45.targetReached, false);
  assert.equal(swAt45.progressPct, 50);
  assert.equal(formatClockSeconds(swAt45.elapsedSeconds), '00:45');
  assert.equal(shouldFireRestAlert(sw, startMs + 45_000), false);

  // At exact 90s target: targetReached flips and alert should fire once
  const swAt90 = computeRestClockState(sw, startMs + 90_000);
  assert.equal(swAt90.elapsedSeconds, 90);
  assert.equal(swAt90.targetReached, true);
  assert.equal(swAt90.progressPct, 100);
  assert.equal(shouldFireRestAlert(sw, startMs + 90_000), true);

  // Reload/past timestamp 215s later: keeps counting up past target, alert fires if not yet fired, never refires after alertFired = true
  const swAt215 = computeRestClockState(sw, startMs + 215_000);
  assert.equal(swAt215.elapsedSeconds, 215);
  assert.equal(swAt215.targetReached, true);
  assert.equal(formatClockSeconds(swAt215.elapsedSeconds), '03:35');
  assert.equal(shouldFireRestAlert(sw, startMs + 215_000), true);

  const swFired = { ...sw, alertFired: true };
  assert.equal(shouldFireRestAlert(swFired, startMs + 215_000), false);

  // Adjusting target past elapsed resets alertFired so new target can fire once
  const swExtended = adjustRestClockTarget(swFired, 150, startMs + 215_000);
  assert.equal(swExtended.targetSeconds, 240);
  assert.equal(swExtended.alertFired, false);
  assert.equal(shouldFireRestAlert(swExtended, startMs + 215_000), false);
  assert.equal(shouldFireRestAlert(swExtended, startMs + 240_000), true);

  // Explicit stop vs dismiss
  const stopped = stopRestClock(sw, '2026-11-16T10:02:05.000Z');
  assert.equal(stopped.isActive, false);
  assert.equal(stopped.stoppedAt, '2026-11-16T10:02:05.000Z');

  const dismissed = dismissRestClock(sw);
  assert.equal(dismissed.isActive, false);
  assert.equal(dismissed.stoppedAt, null);

  // Countdown mode derived from stored start timestamp
  const cd = createRestClock({
    startedAt: startIso,
    targetSeconds: 120,
    mode: 'countdown',
    label: 'Squat',
  });
  const cdAt50 = computeRestClockState(cd, startMs + 50_000);
  assert.equal(cdAt50.mode, 'countdown');
  assert.equal(cdAt50.elapsedSeconds, 50);
  assert.equal(cdAt50.remainingSeconds, 70);
  assert.equal(cdAt50.targetReached, false);
  assert.equal(shouldFireRestAlert(cd, startMs + 50_000), false);

  // Simulated reload after phone lock past 120s
  const cdAt135 = computeRestClockState(cd, startMs + 135_000);
  assert.equal(cdAt135.remainingSeconds, 0);
  assert.equal(cdAt135.targetReached, true);
  assert.equal(shouldFireRestAlert(cd, startMs + 135_000), true);

  // Floor at 5s when decreasing target
  const cdMin = adjustRestClockTarget(cd, -500, startMs + 1_000);
  assert.equal(cdMin.targetSeconds, 5);
});

test('session start is null before user action, chooses earlier of Start tap and first completed set, survives reload, and computes duration', () => {
  // Null before either Start tap or first completed set
  assert.equal(resolveSessionStart(null, null), null);
  assert.equal(computeSessionElapsedSeconds(null, Date.now()), 0);
  assert.equal(
    computeSessionDurationMinutes(null, '2026-11-16T10:30:00.000Z'),
    null,
  );

  const t1 = '2026-11-16T10:00:00.000Z';
  const t2 = '2026-11-16T10:02:30.000Z';

  // Explicit Start tap first -> preserved when first set completes later
  const afterTap = resolveSessionStart(null, t1);
  assert.equal(afterTap, t1);
  const afterLaterSet = resolveSessionStart(afterTap, t2);
  assert.equal(afterLaterSet, t1);

  // First completed set first -> preserved even if another candidate comes later, or replaced if earlier
  const afterSetFirst = resolveSessionStart(null, t2);
  assert.equal(afterSetFirst, t2);
  assert.equal(resolveSessionStart(afterSetFirst, t1), t1);

  // Reload mid-workout: elapsed derived from persisted startedAt
  const reloadNowMs = Date.parse('2026-11-16T10:32:15.000Z');
  const elapsedSec = computeSessionElapsedSeconds(afterTap, reloadNowMs);
  assert.equal(elapsedSec, 32 * 60 + 15);
  assert.equal(formatClockSeconds(elapsedSec), '32:15');

  // Duration calculation on finish
  assert.equal(
    computeSessionDurationMinutes(t1, '2026-11-16T10:47:20.000Z'),
    47,
  );
  assert.equal(
    computeSessionDurationMinutes(t1, '2026-11-16T10:00:15.000Z'),
    1,
  );
  assert.equal(computeSessionDurationMinutes(t1, t1), 0);
  assert.equal(
    computeSessionDurationMinutes(t1, '2026-11-17T02:00:00.000Z'),
    600,
  );
});

test('restClockMode persists in DB, additive migration, PATCH /api/settings, dayView, exportData, and MCP get_profile', async () => {
  const memDb = newDb();
  const pg = memDb.adapters.createPg();
  const pool = new pg.Pool();

  try {
    // Simulate legacy users table without rest_clock_mode before initSchema
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
      `INSERT INTO users (
        id, username, display_name, password_hash, weight_kg,
        unit, timezone, enable_set_quality, apple_fitness_enabled,
        is_guest, last_active_at, created_at
      ) VALUES ($1, $2, $3, $4, 75, 'kg', 'UTC', 0, 1, 0, $5, $5)`,
      ['usr_leg', 'legacy_user', 'Legacy', 'hash', now],
    );

    setTestPool(pool);
    await pingDb();

    // Legacy row defaults to 'stopwatch'
    const legacyUser = await getUserById('usr_leg');
    assert.equal(legacyUser?.restClockMode, 'stopwatch');

    // New user defaults to 'stopwatch'
    const user = await createUser({
      id: 'usr_p2',
      username: 'clock_tester',
      displayName: 'Clock Tester',
      passwordHash: 'hash',
    });
    assert.equal(user.restClockMode, 'stopwatch');

    const rawToken = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    // PATCH /api/settings validates and updates restClockMode -> 'countdown'
    const resPatch = await settingsPatchRoute(
      new NextRequest('http://localhost/api/settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
        body: JSON.stringify({ restClockMode: 'countdown' }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resPatch.status, 200);
    const patchJson = (await resPatch.json()) as {
      user: { restClockMode: string };
    };
    assert.equal(patchJson.user.restClockMode, 'countdown');

    // Invalid restClockMode -> 400
    const resInvalid = await settingsPatchRoute(
      new NextRequest('http://localhost/api/settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        },
        body: JSON.stringify({ restClockMode: 'invalid_mode' }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(resInvalid.status, 400);

    // DB updateUserSettings round-trip
    const fetched = await getUserById(user.id);
    assert.equal(fetched?.restClockMode, 'countdown');

    // WorkoutDayViewResponse includes restClockMode
    const dayView = await getWorkoutDayView(user.id, '2026-11-16', '2026-11-16');
    assert.equal(dayView.user.restClockMode, 'countdown');

    // Export JSON includes restClockMode
    const exported = await buildUserExportJson(fetched!);
    assert.equal(exported.user.restClockMode, 'countdown');

    // MCP get_profile includes restClockMode
    const mcpResp = await handleMcpJsonRpcRequest(fetched!, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_profile', arguments: {} },
    });
    const mcpProfile = (
      mcpResp?.result as {
        structuredContent: { profile: { restClockMode: string } };
      }
    )?.structuredContent?.profile;
    assert.equal(mcpProfile?.restClockMode, 'countdown');

    // Switch back to stopwatch via updateUserSettings
    const switchedBack = await updateUserSettings(user.id, {
      restClockMode: 'stopwatch',
    });
    assert.equal(switchedBack?.restClockMode, 'stopwatch');
  } finally {
    await closeDb();
    setTestPool(null);
  }
});

test('settings search registry matches stopwatch, countdown, rest, alerts, and notifications', () => {
  for (const term of [
    'stopwatch',
    'countdown',
    'rest',
    'alerts',
    'notifications',
  ]) {
    const matches = filterSettingsItems(term);
    assert.ok(
      matches.some((m) => m.categoryId === 'training'),
      `Expected search term "${term}" to match a Training setting`,
    );
  }
});
