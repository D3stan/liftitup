import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newDb } from 'pg-mem';

// Register @/* -> src/* resolution so Node runs TS modules directly without a bundler.
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
  computeSteppedValue,
  deriveCatalogWeightStepKg,
  displayStepToKg,
  LB_WEIGHT_STEP_OPTIONS,
  resolveDisplayWeightStep,
  resolveWeightStepKg,
  snapLbStep,
  stepKgToDisplay,
} = await import('@/lib/workouts/stepSize');
const { closeDb, pingDb, query, queryOne, setTestPool } = await import(
  '@/lib/db/connection'
);
const { initSchema, syncExerciseCatalog } = await import('@/lib/db/schema');
const { createUser, getUserById } = await import('@/lib/db/users');
const { deleteUserAccount } = await import('@/lib/db/userDeletion');
const { createAuthSession } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const {
  createCustomExercise,
  getExerciseById,
  getUserExercisePref,
  listUserExercisePrefs,
} = await import('@/lib/exercises/repository');
const { getWorkoutDayView } = await import('@/lib/workouts/queries');
const { PATCH: patchSettingsRoute } = await import('@/app/api/settings/route');
const { PUT: putStepRoute, DELETE: deleteStepRoute } = await import(
  '@/app/api/exercises/[id]/step/route'
);
const { POST: postExerciseRoute } = await import('@/app/api/exercises/route');
const { PATCH: patchExerciseRoute } = await import(
  '@/app/api/exercises/[id]/route'
);
const { buildUserExportJson } = await import('@/lib/export/exportData');
const { handleMcpJsonRpcRequest } = await import('@/lib/mcp/server');
const { filterSettingsItems } = await import('@/lib/settings/registry');

function setupMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const pool = new pgAdapter.Pool();
  setTestPool(pool);
  return { memDb, pool };
}

function makeCookieReq(
  url: string,
  method: string,
  token: string,
  body?: unknown,
) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test('step arithmetic prevents float noise, enforces zero floor, and uses empty fallback', () => {
  // Basic kg & lb steps
  assert.equal(
    computeSteppedValue({ currentRaw: '60', direction: 1, step: 2.5 }),
    '62.5',
  );
  assert.equal(
    computeSteppedValue({ currentRaw: '62.5', direction: -1, step: 2.5 }),
    '60',
  );

  // Classic IEEE-754 float noise cases (0.1 + 0.2 and 62.50000001)
  assert.equal(
    computeSteppedValue({ currentRaw: '0.1', direction: 1, step: 0.2 }),
    '0.3',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: String(60 + 2.5 + 0.00000001),
      direction: 1,
      step: 2.5,
    }),
    '65',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: '61.25',
      direction: 1,
      step: 1.25,
    }),
    '62.5',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: '61.25',
      direction: 1,
      step: 2.5,
    }),
    '63.75',
  );

  // Zero floor
  assert.equal(
    computeSteppedValue({ currentRaw: '1', direction: -1, step: 2.5 }),
    '0',
  );
  assert.equal(
    computeSteppedValue({ currentRaw: '0', direction: -1, step: 1 }),
    '0',
  );
  assert.equal(
    computeSteppedValue({ currentRaw: '', direction: -1, step: 5 }),
    '0',
  );

  // Empty field starts from fallback (prefill / previous set) when provided, else 0
  assert.equal(
    computeSteppedValue({
      currentRaw: '',
      direction: 1,
      step: 2.5,
      fallbackValue: 80,
    }),
    '82.5',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: '',
      direction: -1,
      step: 2.5,
      fallbackValue: 80,
    }),
    '77.5',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: '',
      direction: 1,
      step: 5,
      fallbackValue: null,
    }),
    '5',
  );
  assert.equal(
    computeSteppedValue({
      currentRaw: '  ',
      direction: 1,
      step: 1,
      fallbackValue: 8,
    }),
    '9',
  );
});

test('lb fixed-list snapping never shows 2.7558 for 1.25 kg and stores clean kg values', () => {
  assert.deepEqual([...LB_WEIGHT_STEP_OPTIONS], [1, 2.5, 5, 10]);

  // 1.25 kg dumbbell default -> 2.7558 lb -> snaps cleanly to 2.5 lb
  assert.equal(stepKgToDisplay(1.25, 'lb'), 2.5);
  assert.equal(stepKgToDisplay(0.5, 'lb'), 1);
  assert.equal(stepKgToDisplay(2.5, 'lb'), 5);
  assert.equal(stepKgToDisplay(5, 'lb'), 10);
  assert.equal(stepKgToDisplay(null, 'lb'), 5);
  assert.equal(stepKgToDisplay(null, 'kg'), 2.5);
  assert.equal(snapLbStep(2.7558), 2.5);

  // Round-trip every fixed lb choice to clean kg and back to the exact lb option
  for (const lbOption of LB_WEIGHT_STEP_OPTIONS) {
    const cleanKg = displayStepToKg(lbOption, 'lb');
    assert.equal(cleanKg, Math.round(cleanKg * 100) / 100);
    assert.equal(stepKgToDisplay(cleanKg, 'lb'), lbOption);
  }
});

test('three-level step lookup order: override > exercise > global > unit fallback', () => {
  // Level 1: override wins over everything
  assert.deepEqual(
    resolveDisplayWeightStep({
      userOverrideKg: 0.5,
      exerciseDefaultKg: 1.25,
      userGlobalDefaultKg: 5,
      unit: 'kg',
    }),
    { stepKg: 0.5, source: 'override', displayStep: 0.5 },
  );

  // Level 2: exercise default wins over global default
  assert.deepEqual(
    resolveDisplayWeightStep({
      userOverrideKg: null,
      exerciseDefaultKg: 1.25,
      userGlobalDefaultKg: 5,
      unit: 'lb',
    }),
    { stepKg: 1.25, source: 'exercise', displayStep: 2.5 },
  );

  // Level 3: user global default wins over unit fallback
  assert.deepEqual(
    resolveDisplayWeightStep({
      userOverrideKg: null,
      exerciseDefaultKg: null,
      userGlobalDefaultKg: 5,
      unit: 'kg',
    }),
    { stepKg: 5, source: 'global', displayStep: 5 },
  );

  // Level 4: unit fallback when all three are null
  assert.deepEqual(
    resolveDisplayWeightStep({
      userOverrideKg: null,
      exerciseDefaultKg: null,
      userGlobalDefaultKg: null,
      unit: 'kg',
    }),
    { stepKg: null, source: 'default', displayStep: 2.5 },
  );
  assert.deepEqual(
    resolveDisplayWeightStep({
      userOverrideKg: null,
      exerciseDefaultKg: null,
      userGlobalDefaultKg: null,
      unit: 'lb',
    }),
    { stepKg: null, source: 'default', displayStep: 5 },
  );
  assert.equal(
    resolveWeightStepKg({
      userOverrideKg: undefined,
      exerciseDefaultKg: undefined,
      userGlobalDefaultKg: undefined,
    }).source,
    'default',
  );
});

test('catalog sync, user_exercise_prefs isolation, reset deletes row, deletion cleanup, export, and MCP', async () => {
  setupMemPool();
  try {
    await pingDb();

    // 1. Verify catalog defaults from syncExerciseCatalog
    const dbDumbbell = await getExerciseById('any', 'flat-dumbbell-bench-press');
    assert.ok(dbDumbbell);
    assert.equal(dbDumbbell.weightStepKg, 1.25);

    const legPress = await getExerciseById('any', 'leg-press');
    assert.ok(legPress);
    assert.equal(legPress.weightStepKg, 5);

    const barbellBench = await getExerciseById('any', 'barbell-bench-press');
    assert.ok(barbellBench);
    assert.equal(barbellBench.weightStepKg, null);

    // 2. Create two users + session cookies
    const userA = await createUser({
      id: 'usr_p4_a',
      username: 'phase4_a',
      displayName: 'Phase 4 A',
      passwordHash: 'hash',
      unit: 'kg',
    });
    const userB = await createUser({
      id: 'usr_p4_b',
      username: 'phase4_b',
      displayName: 'Phase 4 B',
      passwordHash: 'hash',
      unit: 'lb',
    });

    const tokenA = 'tok_phase4_a';
    await createAuthSession(
      userA.id,
      hashToken(tokenA),
      new Date(Date.now() + 3600_000).toISOString(),
    );

    // 3. PATCH /api/settings sets global defaultWeightStepKg
    const settingsRes = await patchSettingsRoute(
      makeCookieReq('http://localhost/api/settings', 'PATCH', tokenA, {
        defaultWeightStepKg: 5,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(settingsRes.status, 200);
    const settingsBody = await settingsRes.json();
    assert.equal(settingsBody.user.defaultWeightStepKg, 5);
    assert.equal((await getUserById(userA.id))?.defaultWeightStepKg, 5);

    // 4. Changing step on a catalog exercise creates user_exercise_prefs row,
    // leaves shared exercises row untouched, and leaves user B unaffected
    const putCatalogRes = await putStepRoute(
      makeCookieReq(
        'http://localhost/api/exercises/flat-dumbbell-bench-press/step',
        'PUT',
        tokenA,
        { weightStepKg: 0.5 },
      ),
      { params: Promise.resolve({ id: 'flat-dumbbell-bench-press' }) },
    );
    assert.equal(putCatalogRes.status, 200);
    const putCatalogJson = await putCatalogRes.json();
    assert.equal(putCatalogJson.exercise.weightStepKg, 1.25); // shared catalog unchanged
    assert.equal(putCatalogJson.exercise.userWeightStepKg, 0.5);

    const sharedRow = await queryOne<{ weight_step_kg: number | null }>(
      'SELECT weight_step_kg FROM exercises WHERE id = $1',
      ['flat-dumbbell-bench-press'],
    );
    assert.equal(sharedRow?.weight_step_kg, 1.25);

    const prefA = await getUserExercisePref(
      userA.id,
      'flat-dumbbell-bench-press',
    );
    assert.equal(prefA?.weightStepKg, 0.5);

    const exForB = await getExerciseById(userB.id, 'flat-dumbbell-bench-press');
    assert.equal(exForB?.weightStepKg, 1.25);
    assert.equal(exForB?.userWeightStepKg, null);

    // 5. Custom exercise: created with weightStepKg and edited via step route
    // updates exercises.weight_step_kg directly WITHOUT creating a user_exercise_prefs row
    const createCustomRes = await postExerciseRoute(
      makeCookieReq('http://localhost/api/exercises', 'POST', tokenA, {
        name: 'My Cable Fly',
        trackingType: 'weight_reps',
        equipment: 'cable',
        category: 'push',
        defaultRestSeconds: 90,
        weightStepKg: 1.25,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(createCustomRes.status, 201);
    const customEx = (await createCustomRes.json()).exercise;
    assert.equal(customEx.weightStepKg, 1.25);
    assert.equal(customEx.userWeightStepKg, null);

    const updateCustomStepRes = await putStepRoute(
      makeCookieReq(
        `http://localhost/api/exercises/${customEx.id}/step`,
        'PUT',
        tokenA,
        { weightStepKg: 2.5 },
      ),
      { params: Promise.resolve({ id: customEx.id }) },
    );
    assert.equal(updateCustomStepRes.status, 200);
    const updatedCustom = (await updateCustomStepRes.json()).exercise;
    assert.equal(updatedCustom.weightStepKg, 2.5);
    assert.equal(updatedCustom.userWeightStepKg, null);
    assert.equal(await getUserExercisePref(userA.id, customEx.id), null);

    // Patch custom exercise via PATCH /api/exercises/[id]
    const patchCustomRes = await patchExerciseRoute(
      makeCookieReq(
        `http://localhost/api/exercises/${customEx.id}`,
        'PATCH',
        tokenA,
        { weightStepKg: 1 },
      ),
      { params: Promise.resolve({ id: customEx.id }) },
    );
    assert.equal(patchCustomRes.status, 200);
    assert.equal((await patchCustomRes.json()).exercise.weightStepKg, 1);

    // 6. Reset deletes the user_exercise_prefs row so catalog changes reach the user again
    const delCatalogStepRes = await deleteStepRoute(
      makeCookieReq(
        'http://localhost/api/exercises/flat-dumbbell-bench-press/step',
        'DELETE',
        tokenA,
      ),
      { params: Promise.resolve({ id: 'flat-dumbbell-bench-press' }) },
    );
    assert.equal(delCatalogStepRes.status, 200);
    const resetCatalog = (await delCatalogStepRes.json()).exercise;
    assert.equal(resetCatalog.userWeightStepKg, null);
    assert.equal(resetCatalog.weightStepKg, 1.25);
    assert.equal(
      await getUserExercisePref(userA.id, 'flat-dumbbell-bench-press'),
      null,
    );

    // Add override back on leg-press so export & deletion tests see an active pref row
    await putStepRoute(
      makeCookieReq(
        'http://localhost/api/exercises/leg-press/step',
        'PUT',
        tokenA,
        { weightStepKg: 2.5 },
      ),
      { params: Promise.resolve({ id: 'leg-press' }) },
    );

    // 8. Day view includes user.defaultWeightStepKg
    const dayView = await getWorkoutDayView(userA.id, '2026-11-16', '2026-11-16');
    assert.equal(dayView.user.defaultWeightStepKg, 5);

    // 9. Export includes user.defaultWeightStepKg, custom exercise weightStepKg, and exerciseStepPrefs
    const freshUserA = (await getUserById(userA.id))!;
    const exported = await buildUserExportJson(freshUserA);
    assert.equal(exported.user.defaultWeightStepKg, 5);
    const exportedCustom = exported.exercises.custom.find(
      (e) => e.id === customEx.id,
    );
    assert.equal(exportedCustom?.weightStepKg, 1);
    assert.deepEqual(
      exported.exerciseStepPrefs.map((p) => ({
        exerciseId: p.exerciseId,
        weightStepKg: p.weightStepKg,
      })),
      [{ exerciseId: 'leg-press', weightStepKg: 2.5 }],
    );

    // 10. MCP get_profile, list_exercises, upsert_custom_exercise
    const profileRpc = await handleMcpJsonRpcRequest(freshUserA, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_profile', arguments: {} },
    });
    const profileResult = profileRpc?.result as {
      structuredContent: { profile: { defaultWeightStepKg: number | null } };
    };
    assert.equal(profileResult.structuredContent.profile.defaultWeightStepKg, 5);

    const listRpc = await handleMcpJsonRpcRequest(freshUserA, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'list_exercises',
        arguments: { query: 'leg press' },
      },
    });
    const listResult = listRpc?.result as {
      structuredContent: {
        exercises: Array<{
          id: string;
          weightStepKg: number | null;
          userWeightStepKg?: number | null;
        }>;
      };
    };
    const mcpLegPress = listResult.structuredContent.exercises.find(
      (e) => e.id === 'leg-press',
    );
    assert.equal(mcpLegPress?.weightStepKg, 5);
    assert.equal(mcpLegPress?.userWeightStepKg, 2.5);

    const upsertRpc = await handleMcpJsonRpcRequest(freshUserA, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'upsert_custom_exercise',
        arguments: {
          name: 'MCP Belt Squat',
          trackingType: 'weight_reps',
          equipment: 'machine',
          category: 'legs',
          weightStepKg: 5,
        },
      },
    });
    const upsertResult = upsertRpc?.result as {
      structuredContent: {
        created: boolean;
        exercise: { weightStepKg: number | null };
      };
    };
    assert.equal(upsertResult.structuredContent.created, true);
    assert.equal(upsertResult.structuredContent.exercise.weightStepKg, 5);

    // 11. deleteUserAccount removes user_exercise_prefs rows cleanly
    assert.equal((await listUserExercisePrefs(userA.id)).length, 1);
    const deleted = await deleteUserAccount(userA.id);
    assert.equal(deleted, true);
    assert.equal((await listUserExercisePrefs(userA.id)).length, 0);
  } finally {
    await closeDb();
  }
});

test('syncExerciseCatalog updates catalog weight_step_kg while preserving user_exercise_prefs and custom exercises', async () => {
  const { pool } = setupMemPool();
  try {
    await initSchema(pool);

    const user = await createUser({
      id: `usr_${crypto.randomUUID()}`,
      username: 'sync_test',
      displayName: 'Sync Test',
      passwordHash: 'hash',
    });
    const custom = await createCustomExercise(user.id, {
      name: 'Custom DB Press',
      trackingType: 'weight_reps',
      equipment: 'dumbbell',
      category: 'push',
      weightStepKg: 3.5,
    });

    // User overrides flat-dumbbell-bench-press
    const { upsertUserExerciseStepPref } = await import(
      '@/lib/exercises/repository'
    );
    await upsertUserExerciseStepPref(user.id, 'flat-dumbbell-bench-press', 0.5);

    // Simulate stale catalog weight_step_kg in DB, then re-run syncExerciseCatalog
    await query(
      'UPDATE exercises SET weight_step_kg = 99 WHERE id = $1',
      ['flat-dumbbell-bench-press'],
    );
    await syncExerciseCatalog(pool);

    const syncedDumbbell = await getExerciseById(
      user.id,
      'flat-dumbbell-bench-press',
    );
    assert.equal(syncedDumbbell?.weightStepKg, 1.25);
    assert.equal(syncedDumbbell?.userWeightStepKg, 0.5);

    const customAfter = await getExerciseById(user.id, custom.id);
    assert.equal(customAfter?.weightStepKg, 3.5);

    assert.equal(deriveCatalogWeightStepKg({ equipment: 'dumbbell' }), 1.25);
    assert.equal(deriveCatalogWeightStepKg({ equipment: 'barbell' }), null);
    assert.equal(
      deriveCatalogWeightStepKg({ equipment: 'machine', weightStepKg: 5 }),
      5,
    );
  } finally {
    await closeDb();
  }
});

test('additive migration adds step columns and user_exercise_prefs on legacy v2 DB', async () => {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const pool = new pgAdapter.Pool();
  setTestPool(pool);

  try {
    // Create minimal pre-Phase-4 users & exercises tables
    await pool.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        weight_kg DOUBLE PRECISION NOT NULL DEFAULT 75,
        unit TEXT NOT NULL DEFAULT 'kg',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        enable_set_quality INTEGER NOT NULL DEFAULT 0,
        apple_fitness_enabled INTEGER NOT NULL DEFAULT 1,
        is_guest INTEGER NOT NULL DEFAULT 0,
        last_active_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE exercises (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        tracking_type TEXT NOT NULL,
        equipment TEXT NOT NULL DEFAULT 'other',
        category TEXT NOT NULL DEFAULT 'other',
        default_rest_seconds INTEGER NOT NULL DEFAULT 120,
        is_custom INTEGER NOT NULL DEFAULT 0,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO users (id, username, display_name, password_hash, last_active_at, created_at)
      VALUES ('usr_legacy', 'legacy', 'Legacy', 'h', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);

    await initSchema(pool);

    const legacyUser = await getUserById('usr_legacy');
    assert.ok(legacyUser);
    assert.equal(legacyUser.defaultWeightStepKg, null);

    const legPress = await getExerciseById('usr_legacy', 'leg-press');
    assert.equal(legPress?.weightStepKg, 5);
  } finally {
    await closeDb();
  }
});

test('settings search registry finds Default Weight Step by keywords', () => {
  const stepHits = filterSettingsItems('weight step');
  assert.ok(stepHits.some((item) => item.id === 'training-default-weight-step'));

  const stepperHits = filterSettingsItems('stepper');
  assert.ok(
    stepperHits.some((item) => item.id === 'training-default-weight-step'),
  );
});
