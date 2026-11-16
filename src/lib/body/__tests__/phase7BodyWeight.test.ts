import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const { setTestPool, closeDb, pingDb, query } = await import(
  '@/lib/db/connection'
);
const { createUser, getUserById, localDateForTimezone } = await import(
  '@/lib/db/users'
);
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { generateApiKey, hashToken, SESSION_COOKIE_NAME } = await import(
  '@/lib/auth/session'
);
const {
  recordBodyMetric,
  listBodyMetrics,
  upsertManualBodyMetricInTx,
  syncUserProfileWeightFromBodyMetrics,
} = await import('@/lib/db/bodyMetrics');
const {
  getBodyMetricSourceRank,
  resolveDailyBodyWeights,
  resolveWeightForDate,
  computeMovingAverage7dSeries,
  computeBodyWeightSummary,
  filterResolvedPointsByRange,
} = await import('@/lib/body/weight');
const { DEFAULT_USER_WEIGHT_KG } = await import('@/lib/db/userDeletion');
const { ingestAppleHealthPayload } = await import(
  '@/lib/integrations/appleHealth'
);
const { applyAiImport } = await import('@/lib/ai/importService');
const { filterSettingsItems } = await import('@/lib/settings/registry');
const { GET: bodyWeightsGet, POST: bodyWeightsPost } = await import(
  '@/app/api/body-weights/route'
);
const { PATCH: bodyWeightsPatch, DELETE: bodyWeightsDelete } = await import(
  '@/app/api/body-weights/[id]/route'
);
const { PATCH: settingsPatch } = await import('@/app/api/settings/route');
const { GET: progressGet } = await import('@/app/api/progress/route');

function setupMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const pool = new pgAdapter.Pool() as unknown as Pool;
  setTestPool(pool);
  return pool;
}

async function createAuthedUser(
  username: string,
  opts?: { timezone?: string; unit?: 'kg' | 'lb'; weightKg?: number },
) {
  const user = await createUser({
    username,
    displayName: username,
    passwordHash: 'hash',
    timezone: opts?.timezone ?? 'UTC',
    unit: opts?.unit ?? 'kg',
    weightKg: opts?.weightKg ?? 75,
  });
  const rawToken = `tok_${username}_${crypto.randomBytes(8).toString('hex')}`;
  await createAuthSession(
    user.id,
    hashToken(rawToken),
    new Date(Date.now() + 86_400_000).toISOString(),
  );
  const apiKey = generateApiKey();
  await upsertApiKey(user.id, apiKey.keyHash, apiKey.keyPrefix);
  return { user, rawToken, rawApiKey: apiKey.rawKey };
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

const emptyCtx = { params: Promise.resolve({}) };

test('canonical resolver precedence: manual/settings > apple_health > import, latest createdAt within tier', () => {
  assert.equal(getBodyMetricSourceRank('manual'), 3);
  assert.equal(getBodyMetricSourceRank('settings'), 3);
  assert.equal(getBodyMetricSourceRank('apple_health'), 2);
  assert.equal(getBodyMetricSourceRank('import'), 1);
  assert.equal(getBodyMetricSourceRank('ai_import'), 1);
  assert.equal(getBodyMetricSourceRank('liftitup_restore'), 1);
  assert.equal(getBodyMetricSourceRank('sample'), 1);

  const metrics = [
    // Day 1: import vs apple_health vs manual (manual created earlier than apple_health still wins)
    {
      id: 'bm_1',
      userId: 'u1',
      measuredOn: '2026-11-10',
      weightKg: 82.0,
      source: 'import',
      createdAt: '2026-11-10T20:00:00.000Z',
    },
    {
      id: 'bm_2',
      userId: 'u1',
      measuredOn: '2026-11-10',
      weightKg: 81.2,
      source: 'apple_health',
      createdAt: '2026-11-10T18:00:00.000Z',
    },
    {
      id: 'bm_3',
      userId: 'u1',
      measuredOn: '2026-11-10',
      weightKg: 80.5,
      source: 'manual',
      createdAt: '2026-11-10T08:00:00.000Z',
    },
    // Day 2: settings (earlier) vs manual (later) -> manual wins by createdAt
    {
      id: 'bm_4',
      userId: 'u1',
      measuredOn: '2026-11-11',
      weightKg: 80.9,
      source: 'settings',
      createdAt: '2026-11-11T07:00:00.000Z',
    },
    {
      id: 'bm_5',
      userId: 'u1',
      measuredOn: '2026-11-11',
      weightKg: 80.3,
      source: 'manual',
      createdAt: '2026-11-11T09:00:00.000Z',
    },
    // Day 3 (earlier date out of order): apple_health beats ai_import
    {
      id: 'bm_6',
      userId: 'u1',
      measuredOn: '2026-11-09',
      weightKg: 83.0,
      source: 'ai_import',
      createdAt: '2026-11-09T12:00:00.000Z',
    },
    {
      id: 'bm_7',
      userId: 'u1',
      measuredOn: '2026-11-09',
      weightKg: 81.8,
      source: 'apple_health',
      createdAt: '2026-11-09T09:00:00.000Z',
    },
  ];

  const resolved = resolveDailyBodyWeights(metrics);
  assert.deepEqual(
    resolved.map((m) => ({
      date: m.measuredOn,
      id: m.id,
      weightKg: m.weightKg,
    })),
    [
      { date: '2026-11-09', id: 'bm_7', weightKg: 81.8 },
      { date: '2026-11-10', id: 'bm_3', weightKg: 80.5 },
      { date: '2026-11-11', id: 'bm_5', weightKg: 80.3 },
    ],
  );

  assert.equal(resolveWeightForDate(metrics, '2026-11-10')?.id, 'bm_3');
  assert.equal(resolveWeightForDate(metrics, '2026-11-12'), null);
});

test('7-day moving average, summary deltas, and range filtering', () => {
  const daily = [
    { id: '1', userId: 'u1', measuredOn: '2026-10-01', weightKg: 82.0, source: 'manual', createdAt: '2026-10-01T08:00:00Z' },
    { id: '2', userId: 'u1', measuredOn: '2026-11-01', weightKg: 80.0, source: 'manual', createdAt: '2026-11-01T08:00:00Z' },
    { id: '3', userId: 'u1', measuredOn: '2026-11-03', weightKg: 79.4, source: 'manual', createdAt: '2026-11-03T08:00:00Z' },
    { id: '4', userId: 'u1', measuredOn: '2026-11-06', weightKg: 79.0, source: 'manual', createdAt: '2026-11-06T08:00:00Z' },
    // 2026-11-09 window is [2026-11-03, 2026-11-09], so 2026-11-01 drops out!
    { id: '5', userId: 'u1', measuredOn: '2026-11-09', weightKg: 78.6, source: 'manual', createdAt: '2026-11-09T08:00:00Z' },
  ];

  const series = computeMovingAverage7dSeries(daily);
  assert.equal(series.length, 5);
  assert.equal(series[0].movingAvg7dKg, 82);
  assert.equal(series[1].movingAvg7dKg, 80); // 2026-10-01 is outside [2026-10-26, 2026-11-01]
  assert.equal(series[2].movingAvg7dKg, 79.7); // avg(80.0, 79.4)
  assert.equal(series[3].movingAvg7dKg, 79.47); // avg(80.0, 79.4, 79.0)
  assert.equal(series[4].movingAvg7dKg, 79); // avg(79.4, 79.0, 78.6)

  const summary = computeBodyWeightSummary(daily, 7);
  assert.equal(summary.currentWeightKg, 78.6);
  assert.equal(summary.currentMeasuredOn, '2026-11-09');
  // 7d baseline: closest on or before 2026-11-02 -> 2026-11-01 (80.0) => -1.4
  assert.equal(summary.change7dKg, -1.4);
  // 30d baseline: closest on or before 2026-10-10 -> 2026-10-01 (82.0) => -3.4
  assert.equal(summary.change30dKg, -3.4);
  assert.equal(summary.entryCount, 7);
  assert.equal(summary.resolvedDayCount, 5);

  // Insufficient history returns null deltas
  const shortSummary = computeBodyWeightSummary(daily.slice(2));
  assert.equal(shortSummary.change7dKg, null);
  assert.equal(shortSummary.change30dKg, null);

  // Range filter preserves precomputed movingAvg7dKg
  const last1m = filterResolvedPointsByRange(series, '1m', '2026-11-09');
  assert.deepEqual(
    last1m.map((p) => p.date),
    ['2026-11-01', '2026-11-03', '2026-11-06', '2026-11-09'],
  );
  assert.equal(last1m[3].movingAvg7dKg, 79);
});

test('manual in-place upsert, Apple Health & AI non-clobbering, edit/delete profile sync, Progress series, and isolation', async () => {
  setupMemPool();
  try {
    await pingDb();
    const { user: userA, rawToken: tokenA } = await createAuthedUser('alice', {
      timezone: 'UTC',
      weightKg: 75,
    });
    const { user: userB, rawToken: tokenB } = await createAuthedUser('bob', {
      timezone: 'UTC',
      weightKg: 90,
    });

    const today = localDateForTimezone('UTC');

    // 1. Existing settings entry on today -> Body tab POST updates that row IN PLACE
    const settingsRes = await settingsPatch(
      makeCookieReq('http://localhost/api/settings', 'PATCH', tokenA, {
        weightKg: 78.5,
      }),
      emptyCtx,
    );
    assert.equal(settingsRes.status, 200);
    let rowsA = await listBodyMetrics(userA.id);
    assert.equal(rowsA.length, 1);
    const originalId = rowsA[0].id;
    assert.equal(rowsA[0].source, 'settings');
    assert.equal((await getUserById(userA.id))?.weightKg, 78.5);

    // 2. Body tab POST for today updates the settings row IN PLACE as 'manual'
    const postToday1 = await bodyWeightsPost(
      makeCookieReq('http://localhost/api/body-weights', 'POST', tokenA, {
        weightKg: 79.1,
        measuredOn: today,
      }),
      emptyCtx,
    );
    assert.equal(postToday1.status, 200);
    const postBody1 = (await postToday1.json()) as {
      metric: { id: string; weightKg: number; source: string };
      updatedInPlace: boolean;
      profileWeightKg: number;
    };
    assert.equal(postBody1.updatedInPlace, true);
    assert.equal(postBody1.metric.id, originalId);
    assert.equal(postBody1.metric.source, 'manual');
    assert.equal(postBody1.profileWeightKg, 79.1);
    rowsA = await listBodyMetrics(userA.id);
    assert.equal(rowsA.length, 1);
    assert.equal((await getUserById(userA.id))?.weightKg, 79.1);

    // 3. Past date POST creates a separate row, while profile weight stays at latest date (today: 79.1)
    const pastPost = await bodyWeightsPost(
      makeCookieReq('http://localhost/api/body-weights', 'POST', tokenA, {
        weightKg: 81.0,
        measuredOn: '2026-10-01',
      }),
      emptyCtx,
    );
    assert.equal(pastPost.status, 201);
    const pastBody = (await pastPost.json()) as {
      metric: { id: string };
      updatedInPlace: boolean;
      profileWeightKg: number;
    };
    assert.equal(pastBody.updatedInPlace, false);
    assert.equal(pastBody.profileWeightKg, 79.1);
    assert.equal((await getUserById(userA.id))?.weightKg, 79.1);

    // 4. Apple Health sends a weight on today AND on a past date -> must NOT clobber today's manual 79.1
    const ahResult = await ingestAppleHealthPayload(userA, {
      workouts: [
        { bodyweightKg: 77.2, startedAt: `${today}T07:00:00Z` },
        { bodyweightKg: 80.4, startedAt: '2026-10-15T07:00:00Z' },
      ],
    });
    assert.equal(ahResult.dryRun, false);
    assert.equal((await getUserById(userA.id))?.weightKg, 79.1);

    // 5. AI import on today must NOT clobber today's manual 79.1
    const aiImportRes = await applyAiImport(
      (await getUserById(userA.id))!,
      JSON.stringify({
        profile: {
          heightCm: 175,
          weightKg: 76.0,
          age: 29,
          trainingYears: 3,
          unit: 'kg',
        },
        schedule: {
          name: 'Test Split',
          days: [
            {
              label: 'Upper',
              isRestDay: false,
              exercises: [
                {
                  name: 'Barbell Bench Press',
                  trackingType: 'weight_reps',
                  targetSets: 3,
                  targetReps: 8,
                  restSeconds: 120,
                },
              ],
            },
          ],
        },
      }),
    );
    assert.equal(aiImportRes.valid, true);
    assert.equal((await getUserById(userA.id))?.weightKg, 79.1);

    // 6. GET /api/progress bodyWeightSeries collapses same-day rows to 1 point per day
    const progRes = await progressGet(
      makeCookieReq(
        `http://localhost/api/progress?range=all&today=${today}`,
        'GET',
        tokenA,
      ),
      emptyCtx,
    );
    assert.equal(progRes.status, 200);
    const progJson = (await progRes.json()) as {
      bodyWeightSeries: Array<{ date: string; weightKg: number; source: string }>;
    };
    assert.deepEqual(
      progJson.bodyWeightSeries.map((p) => p.date),
      ['2026-10-01', '2026-10-15', today],
    );
    assert.equal(progJson.bodyWeightSeries[2].weightKg, 79.1);
    assert.equal(progJson.bodyWeightSeries[2].source, 'manual');

    // 7. GET /api/body-weights returns series + history with isWinningForDay
    const bwRes = await bodyWeightsGet(
      makeCookieReq('http://localhost/api/body-weights?range=all', 'GET', tokenA),
      emptyCtx,
    );
    assert.equal(bwRes.status, 200);
    const bwJson = (await bwRes.json()) as {
      history: Array<{
        id: string;
        measuredOn: string;
        source: string;
        isWinningForDay: boolean;
      }>;
      series: Array<{ date: string; weightKg: number }>;
    };
    assert.equal(bwJson.series.length, 3);
    const todayRows = bwJson.history.filter((h) => h.measuredOn === today);
    assert.equal(todayRows.length, 3); // manual, apple_health, ai_import
    assert.equal(todayRows.filter((h) => h.isWinningForDay).length, 1);
    assert.equal(todayRows.find((h) => h.isWinningForDay)?.id, originalId);

    // 8. User isolation: Bob cannot PATCH or DELETE Alice's entry
    const bobPatch = await bodyWeightsPatch(
      makeCookieReq(
        `http://localhost/api/body-weights/${originalId}`,
        'PATCH',
        tokenB,
        { weightKg: 60 },
      ),
      { params: Promise.resolve({ id: originalId }) },
    );
    assert.equal(bobPatch.status, 404);
    const bobDel = await bodyWeightsDelete(
      makeCookieReq(
        `http://localhost/api/body-weights/${originalId}`,
        'DELETE',
        tokenB,
      ),
      { params: Promise.resolve({ id: originalId }) },
    );
    assert.equal(bobDel.status, 404);

    // 9. Editing today's manual entry updates users.weight_kg
    const editRes = await bodyWeightsPatch(
      makeCookieReq(
        `http://localhost/api/body-weights/${originalId}`,
        'PATCH',
        tokenA,
        { weightKg: 79.8 },
      ),
      { params: Promise.resolve({ id: originalId }) },
    );
    assert.equal(editRes.status, 200);
    assert.equal((await getUserById(userA.id))?.weightKg, 79.8);

    // 10. Deleting today's manual entry falls back to today's Apple Health (77.2)
    const delManualRes = await bodyWeightsDelete(
      makeCookieReq(
        `http://localhost/api/body-weights/${originalId}`,
        'DELETE',
        tokenA,
      ),
      { params: Promise.resolve({ id: originalId }) },
    );
    assert.equal(delManualRes.status, 200);
    assert.equal((await getUserById(userA.id))?.weightKg, 77.2);

    // 11. Deleting ALL remaining rows resets users.weight_kg to DEFAULT_USER_WEIGHT_KG (75)
    const remaining = await listBodyMetrics(userA.id);
    for (const row of remaining) {
      const dRes = await bodyWeightsDelete(
        makeCookieReq(
          `http://localhost/api/body-weights/${row.id}`,
          'DELETE',
          tokenA,
        ),
        { params: Promise.resolve({ id: row.id }) },
      );
      assert.equal(dRes.status, 200);
    }
    assert.equal((await listBodyMetrics(userA.id)).length, 0);
    assert.equal((await getUserById(userA.id))?.weightKg, DEFAULT_USER_WEIGHT_KG);

    // 12. Registry points weight search to /body
    const weightSearch = filterSettingsItems('body weight');
    assert.ok(weightSearch.some((item) => item.href === '/body'));

    // Direct upsert helper works inside explicit caller transaction too
    await upsertManualBodyMetricInTx({
      userId: userB.id,
      measuredOn: '2026-11-16',
      weightKg: 88.4,
      source: 'manual',
    });
    const syncedB = await syncUserProfileWeightFromBodyMetrics(userB.id);
    assert.equal(syncedB, 88.4);
    assert.equal((await getUserById(userB.id))?.weightKg, 88.4);
  } finally {
    await closeDb();
  }
});
