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
const { closeDb, pingDb, query, queryOne, setTestPool } = await import(
  '@/lib/db/connection'
);
const { initSchema } = await import('@/lib/db/schema');
const { createUser, getUserById } = await import('@/lib/db/users');
const { listBodyMetrics } = await import('@/lib/db/bodyMetrics');
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { generateApiKey, hashToken, SESSION_COOKIE_NAME } = await import(
  '@/lib/auth/session'
);
const { getWorkoutSessionById } = await import('@/lib/db/workouts');
const { saveWorkoutSession } = await import('@/lib/workouts/queries');
const {
  AppleHealthValidationError,
  compareOverlapScores,
  computeIntervalOverlap,
  parseAppleHealthFileStrict,
} = await import('@/lib/integrations/appleHealthValidation');
const {
  GET: appleHealthGet,
  POST: appleHealthPost,
} = await import('@/app/api/integrations/apple-health/route');
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

function makeApiKeyReq(
  url: string,
  method: string,
  apiKey: string,
  body?: unknown,
) {
  return new NextRequest(url, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeSessionReq(
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

async function createAuthedUser(suffix: string, timezone = 'UTC') {
  const user = await createUser({
    id: `usr_ah_${suffix}`,
    username: `ahuser_${suffix}`,
    displayName: `Athlete ${suffix}`,
    passwordHash: 'hash',
    weightKg: 78,
    timezone,
  });

  const rawToken = `tok_ah_${suffix}_${crypto.randomBytes(6).toString('hex')}`;
  await createAuthSession(
    user.id,
    hashToken(rawToken),
    new Date(Date.now() + 86_400_000).toISOString(),
  );

  const apiKey = generateApiKey();
  await upsertApiKey(user.id, apiKey.keyHash, apiKey.keyPrefix);

  return { user, rawToken, rawApiKey: apiKey.rawKey };
}

const routeCtx = { params: Promise.resolve({}) };

test('strict validation names exact bad fields and performs zero partial writes on multi-item failure', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('val');

  const cases: Array<{ payload: unknown; expectedField: string }> = [
    { payload: {}, expectedField: 'workouts[0].startedAt' },
    { payload: { workouts: [] }, expectedField: 'workouts' },
    {
      payload: { workouts: [{ durationMinutes: 40 }] },
      expectedField: 'workouts[0].startedAt',
    },
    {
      payload: { workouts: [{ startedAt: 'not-a-date', durationMinutes: 40 }] },
      expectedField: 'workouts[0].startedAt',
    },
    {
      payload: { workouts: [{ startedAt: '2026-11-16T10:00:00Z' }] },
      expectedField: 'workouts[0].durationMinutes',
    },
    {
      payload: {
        workouts: [{ startedAt: '2026-11-16T10:00:00Z', durationMinutes: 0 }],
      },
      expectedField: 'workouts[0].durationMinutes',
    },
    {
      payload: {
        workouts: [{ startedAt: '2026-11-16T10:00:00Z', durationMinutes: -15 }],
      },
      expectedField: 'workouts[0].durationMinutes',
    },
    {
      payload: {
        workouts: [
          {
            startedAt: '2026-11-16T10:00:00Z',
            durationMinutes: 45,
            bodyweightKg: 999,
          },
        ],
      },
      expectedField: 'workouts[0].bodyweightKg',
    },
    {
      payload: {
        workouts: [{ bodyweightKg: 10, measuredOn: '2026-11-16' }],
      },
      expectedField: 'workouts[0].bodyweightKg',
    },
    {
      payload: {
        workouts: [{ bodyweightKg: 'bad', measuredOn: '2026-11-16' }],
      },
      expectedField: 'workouts[0].bodyweightKg',
    },
    {
      payload: {
        workouts: [{ bodyweightKg: 75.5 }],
      },
      expectedField: 'workouts[0].measuredOn',
    },
    {
      payload: {
        workouts: [{ bodyweightKg: 75.5, date: 'invalid-date' }],
      },
      expectedField: 'workouts[0].date',
    },
    // Multi-item payload where item 0 is valid and item 1 is invalid -> nothing stored!
    {
      payload: {
        workouts: [
          {
            workoutType: 'Push',
            startedAt: '2026-11-16T10:00:00Z',
            durationMinutes: 45,
          },
          {
            workoutType: 'Pull',
            startedAt: '2026-11-16T12:00:00Z',
            durationMinutes: 0,
          },
        ],
      },
      expectedField: 'workouts[1].durationMinutes',
    },
  ];

  for (const c of cases) {
    const res = await appleHealthPost(
      makeApiKeyReq(
        'http://localhost/api/integrations/apple-health',
        'POST',
        rawApiKey,
        c.payload,
      ),
      routeCtx,
    );
    assert.equal(res.status, 400, `Expected 400 for ${JSON.stringify(c.payload)}`);
    const json = (await res.json()) as { error: { message: string } };
    assert.ok(
      json.error.message.includes(c.expectedField),
      `Expected error "${json.error.message}" to mention "${c.expectedField}"`,
    );
  }

  const rows = await query(
    'SELECT * FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(rows.rowCount, 0);
  const freshUser = await getUserById(user.id);
  assert.equal(freshUser?.appleHealthLastReceivedAt, null);

  // Client strict file parser never invents 50m / 350kcal / now
  assert.throws(
    () =>
      parseAppleHealthFileStrict(
        'bad.json',
        JSON.stringify([{ workoutType: 'Run' }]),
        'UTC',
      ),
    AppleHealthValidationError,
  );
  assert.throws(
    () =>
      parseAppleHealthFileStrict(
        'bad.csv',
        'workoutType,startedAt\nRun,2026-11-16T10:00:00Z',
        'UTC',
      ),
    AppleHealthValidationError,
  );
  assert.throws(
    () =>
      parseAppleHealthFileStrict(
        'bad.xml',
        '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" /></HealthData>',
        'UTC',
      ),
    AppleHealthValidationError,
  );

  // Valid XML without totalEnergyBurned stores null activeCalories rather than 350
  const parsedXml = parseAppleHealthFileStrict(
    'export.xml',
    '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" startDate="2026-11-16T09:00:00Z" duration="42" /></HealthData>',
    'UTC',
  );
  assert.equal(parsedXml.workouts.length, 1);
  assert.equal(parsedXml.workouts[0].activeCalories, undefined);
  assert.equal(parsedXml.workouts[0].durationMinutes, 42);

  await closeDb();
});

test('workout without optional calories or heart rate stores nulls (no 350/50/now fallbacks)', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('nulls');

  const res = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T08:30:00Z',
            durationMinutes: 42,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    latestSynced: {
      activeCalories: number | null;
      avgHeartRate: number | null;
      maxHeartRate: number | null;
      durationMinutes: number;
    };
    user: {
      appleHealthLastReceivedAt: string | null;
      appleHealthLastReceivedKind: string | null;
      appleHealthLastReceivedLinked: boolean | null;
    };
  };

  assert.equal(body.latestSynced.durationMinutes, 42);
  assert.equal(body.latestSynced.activeCalories, null);
  assert.equal(body.latestSynced.avgHeartRate, null);
  assert.equal(body.latestSynced.maxHeartRate, null);
  assert.ok(body.user.appleHealthLastReceivedAt);
  assert.equal(body.user.appleHealthLastReceivedKind, 'workout');
  assert.equal(body.user.appleHealthLastReceivedLinked, false);

  const row = await queryOne<{
    active_calories: number | null;
    avg_heart_rate: number | null;
    max_heart_rate: number | null;
  }>(
    'SELECT active_calories, avg_heart_rate, max_heart_rate FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(row?.active_calories, null);
  assert.equal(row?.avg_heart_rate, null);
  assert.equal(row?.max_heart_rate, null);

  await closeDb();
});

test('weight-only item writes body_metrics, users.weight_kg, and last_received without creating workout or touching session', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('weight', 'America/New_York');

  // Existing session on the same date must remain completely untouched
  const { session } = await saveWorkoutSession(user.id, {
    sessionDate: '2026-11-15',
    title: 'Upper',
    startedAt: '2026-11-16T03:00:00.000Z', // 2026-11-15 22:00 EST
    durationMinutes: 50,
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [{ weightKg: 80, reps: 8, isCompleted: true }],
      },
    ],
  });

  // Weight-only payload using ISO timestamp in UTC that maps to 2026-11-15 in America/New_York
  const res = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        bodyweightKg: 81.34,
        startedAt: '2026-11-16T03:15:00Z',
      },
    ),
    routeCtx,
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    workoutCount: number;
    weightCount: number;
    latestSynced: unknown;
    user: {
      weightKg: number;
      appleHealthLastReceivedAt: string | null;
      appleHealthLastReceivedKind: string | null;
      appleHealthLastReceivedLinked: boolean | null;
    };
  };

  assert.equal(json.workoutCount, 0);
  assert.equal(json.weightCount, 1);
  assert.equal(json.latestSynced, null);
  assert.equal(json.user.weightKg, 81.3);
  assert.ok(json.user.appleHealthLastReceivedAt);
  assert.equal(json.user.appleHealthLastReceivedKind, 'weight');
  assert.equal(json.user.appleHealthLastReceivedLinked, null);

  const ahCount = await query(
    'SELECT id FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(ahCount.rowCount, 0);

  const metrics = await listBodyMetrics(user.id);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].weightKg, 81.3);
  assert.equal(metrics[0].source, 'apple_health');
  assert.equal(metrics[0].measuredOn, '2026-11-15');

  const untouchedSession = await getWorkoutSessionById(user.id, session.id);
  assert.equal(untouchedSession?.appleWatchKcal, null);
  assert.equal(untouchedSession?.appleWatchAvgHr, null);

  // Workout + bodyweight in same item does BOTH (kind === 'both')
  const bothRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T03:05:00Z',
            durationMinutes: 45,
            activeCalories: 295,
            bodyweightKg: 81.1,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(bothRes.status, 200);
  const bothJson = (await bothRes.json()) as {
    workoutCount: number;
    weightCount: number;
    user: {
      weightKg: number;
      appleHealthLastReceivedKind: string | null;
      appleHealthLastReceivedLinked: boolean | null;
    };
  };
  assert.equal(bothJson.workoutCount, 1);
  assert.equal(bothJson.weightCount, 1);
  assert.equal(bothJson.user.weightKg, 81.1);
  assert.equal(bothJson.user.appleHealthLastReceivedKind, 'both');
  assert.equal(bothJson.user.appleHealthLastReceivedLinked, true);

  await closeDb();
});

test('retries with same (user_id, started_at, workout_type) update in place without duplicates', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('retry');

  const first = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T10:00:00Z',
            durationMinutes: 48,
            activeCalories: 310,
            avgHeartRate: 132,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { latestSynced: { id: string } };

  // Retry using equivalent timezone offset formatting (+02:00 -> same UTC instant)
  const retry = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T12:00:00+02:00',
            durationMinutes: 52,
            activeCalories: 345,
            avgHeartRate: 139,
            maxHeartRate: 171,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(retry.status, 200);
  const retryBody = (await retry.json()) as {
    latestSynced: {
      id: string;
      durationMinutes: number;
      activeCalories: number;
      avgHeartRate: number;
      maxHeartRate: number;
    };
    workouts: Array<{ id: string }>;
  };

  assert.equal(retryBody.latestSynced.id, firstBody.latestSynced.id);
  assert.equal(retryBody.latestSynced.durationMinutes, 52);
  assert.equal(retryBody.latestSynced.activeCalories, 345);
  assert.equal(retryBody.latestSynced.avgHeartRate, 139);
  assert.equal(retryBody.latestSynced.maxHeartRate, 171);
  assert.equal(retryBody.workouts.length, 1);

  const countRes = await query(
    'SELECT id FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(countRes.rowCount, 1);

  await closeDb();
});

test('disabled toggle returns 403 integration disabled while toggle and session file_import remain allowed', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawToken, rawApiKey } = await createAuthedUser('toggle');

  // Turn OFF
  const toggleOff = await appleHealthPost(
    makeSessionReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawToken,
      { action: 'toggle', enabled: false },
    ),
    routeCtx,
  );
  assert.equal(toggleOff.status, 200);

  // API-key webhook ingest must return 403 "integration disabled" and store nothing
  const rejected = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Running',
            startedAt: '2026-11-16T07:00:00Z',
            durationMinutes: 30,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(rejected.status, 403);
  const rejJson = (await rejected.json()) as { error: { message: string } };
  assert.ok(rejJson.error.message.toLowerCase().includes('integration disabled'));

  // Spoofing source: 'file_import' via API key is ALSO rejected with 403 when disabled
  const spoofedFileImport = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        source: 'file_import',
        workouts: [
          {
            workoutType: 'Running',
            startedAt: '2026-11-16T07:00:00Z',
            durationMinutes: 30,
            source: 'file_import',
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(spoofedFileImport.status, 403);

  const zeroRows = await query(
    'SELECT id FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(zeroRows.rowCount, 0);

  // Browser session file_import remains allowed while paused
  const sessionFileImport = await appleHealthPost(
    makeSessionReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawToken,
      {
        source: 'file_import',
        workouts: [
          {
            workoutType: 'Cycling',
            startedAt: '2026-11-16T07:00:00Z',
            durationMinutes: 35,
            activeCalories: 280,
            source: 'file_import',
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(sessionFileImport.status, 200);

  // Toggle back ON stays allowed
  const toggleOn = await appleHealthPost(
    makeSessionReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawToken,
      { action: 'toggle', enabled: true },
    ),
    routeCtx,
  );
  assert.equal(toggleOn.status, 200);

  await closeDb();
});

test('overlap matching handles two sessions in one day, ±15m boundary, overwrite protection, and strictly better replacement', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('overlap');

  // Pure overlap boundary checks: 15 min gap matches, 16 min gap does not
  const match15 = computeIntervalOverlap(
    { startedAt: '2026-11-16T10:15:00Z', durationMinutes: 30 },
    { startedAt: '2026-11-16T09:00:00Z', completedAt: null, durationMinutes: 60 },
  );
  assert.ok(match15 !== null);
  assert.equal(match15.gapMs, 15 * 60_000);

  const miss16 = computeIntervalOverlap(
    { startedAt: '2026-11-16T10:16:00Z', durationMinutes: 30 },
    { startedAt: '2026-11-16T09:00:00Z', completedAt: null, durationMinutes: 60 },
  );
  assert.equal(miss16, null);

  // Two sessions on the same day: morning (08:00-09:00) and evening (18:00-19:00)
  const { session: morning } = await saveWorkoutSession(user.id, {
    sessionDate: '2026-11-16',
    title: 'Morning Lift',
    startedAt: '2026-11-16T08:00:00.000Z',
    durationMinutes: 60,
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [{ weightKg: 80, reps: 5, isCompleted: true }],
      },
    ],
  });
  const { session: evening } = await saveWorkoutSession(user.id, {
    sessionDate: '2026-11-16',
    title: 'Evening Cardio',
    startedAt: '2026-11-16T18:00:00.000Z',
    durationMinutes: 60,
    exercises: [
      {
        exerciseId: 'barbell-back-squat',
        sets: [{ weightKg: 100, reps: 5, isCompleted: true }],
      },
    ],
  });

  // 1) Health workout overlapping evening (18:05-18:55) links to evening, NOT morning
  const evRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Running',
            startedAt: '2026-11-16T18:05:00Z',
            durationMinutes: 50,
            activeCalories: 520,
            avgHeartRate: 158,
            maxHeartRate: 179,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(evRes.status, 200);
  const evJson = (await evRes.json()) as {
    latestSynced: { id: string; linkedSessionId: string | null };
  };
  assert.equal(evJson.latestSynced.linkedSessionId, evening.id);

  const loadedMorning = await getWorkoutSessionById(user.id, morning.id);
  const loadedEvening = await getWorkoutSessionById(user.id, evening.id);
  assert.equal(loadedMorning?.appleWatchKcal, null);
  assert.equal(loadedEvening?.appleWatchKcal, 520);
  assert.equal(loadedEvening?.appleWatchAvgHr, 158);
  assert.equal(loadedEvening?.appleWatchMaxHr, 179);

  // 2) Health workout > 15 min away from morning & evening does NOT link
  const farRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Walking',
            startedAt: '2026-11-16T12:00:00Z',
            durationMinutes: 30,
            activeCalories: 120,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(farRes.status, 200);
  const farJson = (await farRes.json()) as {
    latestSynced: { linkedSessionId: string | null };
  };
  assert.equal(farJson.latestSynced.linkedSessionId, null);

  // 3) Overwrite rule: a second Health workout with WORSE overlap on evening (18:10-18:25 = 15m vs 50m)
  // MUST NOT overwrite evening's metrics or steal its link!
  const worseRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Cooldown',
            startedAt: '2026-11-16T18:10:00Z',
            durationMinutes: 15,
            activeCalories: 99,
            avgHeartRate: 110,
            maxHeartRate: 125,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(worseRes.status, 200);
  const worseJson = (await worseRes.json()) as {
    latestSynced: { linkedSessionId: string | null };
  };
  assert.equal(worseJson.latestSynced.linkedSessionId, null);

  const eveningAfterWorse = await getWorkoutSessionById(user.id, evening.id);
  assert.equal(eveningAfterWorse?.appleWatchKcal, 520);
  assert.equal(eveningAfterWorse?.appleWatchAvgHr, 158);

  // 4) A new Health workout with STRICTLY BETTER overlap on evening (18:00-19:00 = 60m > 50m)
  // replaces the prior link and updates evening's metrics!
  const betterRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T18:00:00Z',
            durationMinutes: 60,
            activeCalories: 610,
            avgHeartRate: 162,
            maxHeartRate: 184,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(betterRes.status, 200);
  const betterJson = (await betterRes.json()) as {
    latestSynced: { id: string; linkedSessionId: string | null };
  };
  assert.equal(betterJson.latestSynced.linkedSessionId, evening.id);

  // Old workout was unlinked
  const oldRow = await queryOne<{ linked_session_id: string | null }>(
    'SELECT linked_session_id FROM apple_health_workouts WHERE id = $1',
    [evJson.latestSynced.id],
  );
  assert.equal(oldRow?.linked_session_id, null);

  const eveningAfterBetter = await getWorkoutSessionById(user.id, evening.id);
  assert.equal(eveningAfterBetter?.appleWatchKcal, 610);
  assert.equal(eveningAfterBetter?.appleWatchAvgHr, 162);
  assert.equal(eveningAfterBetter?.appleWatchMaxHr, 184);

  // Compare tie-breaking sanity check
  const exactScore = computeIntervalOverlap(
    { startedAt: '2026-11-16T10:00:00Z', durationMinutes: 60 },
    { startedAt: '2026-11-16T10:00:00Z', completedAt: null, durationMinutes: 60 },
  )!;
  const shiftedScore = computeIntervalOverlap(
    { startedAt: '2026-11-16T09:50:00Z', durationMinutes: 80 },
    { startedAt: '2026-11-16T10:00:00Z', completedAt: null, durationMinutes: 60 },
  )!;
  assert.ok(compareOverlapScores(exactScore, shiftedScore) > 0);

  await closeDb();
});

test('reverse-side linking: saveWorkoutSession and MCP log_workout_session link to earlier unlinked Health workout', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('reverse');

  // 1) Health workout arrives FIRST (no session exists yet)
  const ahRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T14:00:00Z',
            durationMinutes: 55,
            activeCalories: 410,
            avgHeartRate: 141,
            maxHeartRate: 173,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(ahRes.status, 200);
  const ahJson = (await ahRes.json()) as {
    latestSynced: { id: string; linkedSessionId: string | null };
  };
  assert.equal(ahJson.latestSynced.linkedSessionId, null);

  // 2) User saves workout session AFTER Health workout arrived (within ±15m)
  const { session } = await saveWorkoutSession(user.id, {
    sessionDate: '2026-11-16',
    title: 'Afternoon Pull',
    startedAt: '2026-11-16T14:05:00.000Z',
    durationMinutes: 50,
    exercises: [
      {
        exerciseId: 'pull-up',
        sets: [{ reps: 10, isCompleted: true }],
      },
    ],
  });

  assert.equal(session.appleWatchKcal, 410);
  assert.equal(session.appleWatchAvgHr, 141);
  assert.equal(session.appleWatchMaxHr, 173);

  const linkedRow = await queryOne<{ linked_session_id: string | null }>(
    'SELECT linked_session_id FROM apple_health_workouts WHERE id = $1',
    [ahJson.latestSynced.id],
  );
  assert.equal(linkedRow?.linked_session_id, session.id);

  // 3) MCP log_workout_session also links to an unlinked Health workout arriving near now
  const nowIso = new Date().toISOString();
  const mcpAhRes = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Core Training',
            startedAt: nowIso,
            durationMinutes: 25,
            activeCalories: 165,
            avgHeartRate: 128,
            maxHeartRate: 152,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(mcpAhRes.status, 200);
  const mcpAhJson = (await mcpAhRes.json()) as {
    latestSynced: { id: string; linkedSessionId: string | null };
  };
  assert.equal(mcpAhJson.latestSynced.linkedSessionId, null);

  const mcpLogRes = await handleMcpJsonRpcRequest(user, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'log_workout_session',
      arguments: {
        title: 'MCP Core',
        durationMinutes: 25,
        exercises: [
          {
            exerciseId: 'plank',
            sets: [{ timeSeconds: 60, isCompleted: true }],
          },
        ],
      },
    },
  });
  const mcpStructured = (mcpLogRes?.result as {
    structuredContent: {
      session: {
        id: string;
        appleWatchKcal: number | null;
        appleWatchAvgHr: number | null;
        appleWatchMaxHr: number | null;
      };
    };
  }).structuredContent;
  assert.equal(mcpStructured.session.appleWatchKcal, 165);
  assert.equal(mcpStructured.session.appleWatchAvgHr, 128);
  assert.equal(mcpStructured.session.appleWatchMaxHr, 152);

  await closeDb();
});

test('dry run validates key and payload and writes zero rows including last_received', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawApiKey } = await createAuthedUser('dryrun');

  const res = await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        dryRun: true,
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T09:00:00Z',
            durationMinutes: 45,
            bodyweightKg: 79.4,
          },
        ],
      },
    ),
    routeCtx,
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    ok: boolean;
    dryRun: boolean;
    message: string;
  };
  assert.equal(json.ok, true);
  assert.equal(json.dryRun, true);
  assert.equal(json.message, `ok, key belongs to ${user.displayName}, payload valid`);

  const ahRows = await query(
    'SELECT id FROM apple_health_workouts WHERE user_id = $1',
    [user.id],
  );
  assert.equal(ahRows.rowCount, 0);

  const bmRows = await listBodyMetrics(user.id);
  assert.equal(bmRows.length, 0);

  const freshUser = await getUserById(user.id);
  assert.equal(freshUser?.weightKg, 78);
  assert.equal(freshUser?.appleHealthLastReceivedAt, null);
  assert.equal(freshUser?.appleHealthLastReceivedKind, null);
  assert.equal(freshUser?.appleHealthLastReceivedLinked, null);

  await closeDb();
});

test('duplicate clean-up migration removes duplicates keeping newest, logs count, and is idempotent', async () => {
  const { pool } = setupMemPool();

  // Seed legacy pre-Phase-5 schema (active_calories NOT NULL, no unique index, duplicates present)
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
    CREATE TABLE workout_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      title TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_minutes INTEGER,
      user_weight_kg DOUBLE PRECISION,
      notes TEXT NOT NULL DEFAULT '',
      apple_watch_kcal INTEGER,
      apple_watch_avg_hr INTEGER,
      apple_watch_max_hr INTEGER,
      cid TEXT
    );
    CREATE TABLE workout_sets (
      id TEXT PRIMARY KEY,
      workout_exercise_id TEXT NOT NULL,
      set_number INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE apple_health_workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workout_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      active_calories INTEGER NOT NULL,
      avg_heart_rate INTEGER,
      max_heart_rate INTEGER,
      bodyweight_kg DOUBLE PRECISION,
      linked_session_id TEXT,
      source TEXT NOT NULL DEFAULT 'shortcut_webhook',
      created_at TEXT NOT NULL
    );
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  await pool.query(
    `INSERT INTO users (id, username, display_name, password_hash, last_active_at, created_at)
     VALUES ('u1', 'u1', 'User 1', 'hash', '2026-11-16T00:00:00Z', '2026-11-16T00:00:00Z')`,
  );

  // Insert 3 duplicates for (u1, 2026-11-15T10:00:00.000Z, Running) + 2 duplicates with equal created_at (tie-broken by id DESC) + 1 unique row
  await pool.query(
    `INSERT INTO apple_health_workouts (id, user_id, workout_type, started_at, duration_minutes, active_calories, created_at)
     VALUES
       ('ah_old_1', 'u1', 'Running', '2026-11-15T10:00:00.000Z', 30, 300, '2026-11-15T11:00:00.000Z'),
       ('ah_mid_2', 'u1', 'Running', '2026-11-15T10:00:00.000Z', 31, 310, '2026-11-15T11:05:00.000Z'),
       ('ah_new_3', 'u1', 'Running', '2026-11-15T10:00:00.000Z', 32, 320, '2026-11-15T11:10:00.000Z'),
       ('ah_tie_a', 'u1', 'Cycling', '2026-11-15T12:00:00.000Z', 40, 400, '2026-11-15T13:00:00.000Z'),
       ('ah_tie_b', 'u1', 'Cycling', '2026-11-15T12:00:00.000Z', 45, 450, '2026-11-15T13:00:00.000Z'),
       ('ah_keep_unique', 'u1', 'Strength', '2026-11-16T10:00:00.000Z', 50, 350, '2026-11-16T11:00:00.000Z')`,
  );

  const loggedLines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    loggedLines.push(args.map(String).join(' '));
  };
  try {
    await initSchema(pool);
  } finally {
    console.log = origLog;
  }

  const remaining = await pool.query(
    'SELECT id FROM apple_health_workouts ORDER BY id ASC',
  );
  assert.deepEqual(
    (remaining.rows as Array<{ id: string }>).map((r) => r.id),
    ['ah_keep_unique', 'ah_new_3', 'ah_tie_b'],
  );

  const cleanupLog = loggedLines.find((line) =>
    line.includes('removed duplicate apple_health_workouts rows'),
  );
  assert.ok(cleanupLog, 'Expected duplicate cleanup log line');
  assert.ok(
    cleanupLog.includes('"removedCount":3'),
    `Expected removedCount:3 in log, got ${cleanupLog}`,
  );

  // Repeat run is idempotent
  await initSchema(pool);
  const remainingAfterRepeat = await pool.query(
    'SELECT id FROM apple_health_workouts ORDER BY id ASC',
  );
  assert.equal(remainingAfterRepeat.rowCount, 3);

  // active_calories is now nullable
  await pool.query(
    `INSERT INTO apple_health_workouts (id, user_id, workout_type, started_at, duration_minutes, active_calories, created_at)
     VALUES ('ah_null_cal', 'u1', 'Yoga', '2026-11-16T15:00:00.000Z', 30, NULL, '2026-11-16T16:00:00.000Z')`,
  );

  // Unique index rejects duplicate inserts
  await assert.rejects(
    pool.query(
      `INSERT INTO apple_health_workouts (id, user_id, workout_type, started_at, duration_minutes, active_calories, created_at)
       VALUES ('ah_dup_fail', 'u1', 'Yoga', '2026-11-16T15:00:00.000Z', 30, NULL, '2026-11-16T16:01:00.000Z')`,
    ),
  );

  await closeDb();
});

test('GET apple-health, JSON export, MCP get_profile, and settings search expose Phase 5 fields', async () => {
  setupMemPool();
  await pingDb();
  const { user, rawToken, rawApiKey } = await createAuthedUser('expose');

  await appleHealthPost(
    makeApiKeyReq(
      'http://localhost/api/integrations/apple-health',
      'POST',
      rawApiKey,
      {
        workouts: [
          {
            workoutType: 'Traditional Strength Training',
            startedAt: '2026-11-16T09:00:00Z',
            durationMinutes: 45,
          },
        ],
      },
    ),
    routeCtx,
  );

  const getRes = await appleHealthGet(
    makeSessionReq(
      'http://localhost/api/integrations/apple-health',
      'GET',
      rawToken,
    ),
    routeCtx,
  );
  assert.equal(getRes.status, 200);
  const getJson = (await getRes.json()) as {
    enabled: boolean;
    lastReceivedAt: string | null;
    lastReceivedKind: string | null;
    lastReceivedLinked: boolean | null;
    workouts: Array<{ activeCalories: number | null }>;
  };
  assert.equal(getJson.enabled, true);
  assert.ok(getJson.lastReceivedAt);
  assert.equal(getJson.lastReceivedKind, 'workout');
  assert.equal(getJson.lastReceivedLinked, false);
  assert.equal(getJson.workouts[0].activeCalories, null);

  const freshUser = (await getUserById(user.id))!;
  const exported = await buildUserExportJson(freshUser);
  assert.equal(exported.user.appleFitnessEnabled, true);
  assert.equal(
    exported.user.appleHealthLastReceivedAt,
    freshUser.appleHealthLastReceivedAt,
  );
  assert.equal(exported.user.appleHealthLastReceivedKind, 'workout');
  assert.equal(exported.user.appleHealthLastReceivedLinked, false);

  const mcpProfile = await handleMcpJsonRpcRequest(freshUser, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'get_profile', arguments: {} },
  });
  const profileObj = (mcpProfile?.result as {
    structuredContent: {
      profile: {
        appleHealthLastReceivedAt: string | null;
        appleHealthLastReceivedKind: string | null;
        appleHealthLastReceivedLinked: boolean | null;
      };
    };
  }).structuredContent.profile;
  assert.equal(
    profileObj.appleHealthLastReceivedAt,
    freshUser.appleHealthLastReceivedAt,
  );
  assert.equal(profileObj.appleHealthLastReceivedKind, 'workout');
  assert.equal(profileObj.appleHealthLastReceivedLinked, false);

  assert.ok(
    filterSettingsItems('dry run').some(
      (item) => item.id === 'apple-health-integration',
    ),
  );
  assert.ok(
    filterSettingsItems('last received').some(
      (item) => item.id === 'apple-health-integration',
    ),
  );

  await closeDb();
});
