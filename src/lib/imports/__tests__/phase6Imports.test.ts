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
const { createUser, getUserById } = await import('@/lib/db/users');
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { recordBodyMetric, listBodyMetrics } = await import(
  '@/lib/db/bodyMetrics'
);
const {
  createCustomExercise,
  listExercises,
  setExerciseHidden,
  setExerciseWeightStepForUser,
} = await import('@/lib/exercises/repository');
const {
  getActiveSchedule,
  listScheduleEvents,
  listWorkoutSessions,
} = await import('@/lib/db/workouts');
const { saveWorkoutSession } = await import('@/lib/workouts/queries');
const { buildUserExportJson } = await import('@/lib/export/exportData');
const {
  MAX_IMPORT_BYTES,
  applyLiftitupRestore,
  validateLiftitupRestore,
} = await import('@/lib/imports/liftitupRestore');
const { POST: postLiftitupImport } = await import(
  '@/app/api/imports/liftitup/route'
);
const { projectUserCalendar } = await import('@/lib/schedule/repo');
const { filterSettingsItems } = await import('@/lib/settings/registry');

function createMemPool(opts?: { failOnSqlSubstring?: string }) {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const snapshots = new Map<string, ReturnType<typeof memDb.backup>>();
  let failOnce = opts?.failOnSqlSubstring ?? null;

  const wrapClient = (client: PoolClient) =>
    ({
      async query(sql: string, params?: unknown[]) {
        const trimmed = sql.trim();
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
        if (failOnce && sql.includes(failOnce)) {
          failOnce = null;
          throw new Error('Injected mid-import failure');
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
      return params && params.length > 0
        ? innerPool.query(sql, params)
        : innerPool.query(sql);
    },
    async end() {
      await innerPool.end();
    },
  } as unknown as Pool;

  return { pool, setFailSubstring(sub: string | null) { failOnce = sub; } };
}

async function createAuthedUser(suffix: string, overrides?: Record<string, unknown>) {
  const user = await createUser({
    id: `usr_${suffix}`,
    username: `user_${suffix}`,
    displayName: `User ${suffix}`,
    passwordHash: 'hash',
    ...overrides,
  });
  const token = `tok_${suffix}_${crypto.randomBytes(8).toString('hex')}`;
  await createAuthSession(
    user.id,
    hashToken(token),
    new Date(Date.now() + 86_400_000).toISOString(),
  );
  return { user, token };
}

function makeCookieReq(
  token: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const jsonBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost/api/imports/liftitup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...headers,
    },
    body: jsonBody,
  });
}

test('Phase 6: Liftitup export fixture round-trip into clean account + second Merge import is a no-op', async () => {
  const { pool } = createMemPool();
  setTestPool(pool);

  try {
    const { user: userA } = await createAuthedUser('a', {
      heightCm: 182,
      weightKg: 84.5,
      age: 29,
      trainingYears: 4,
      unit: 'lb',
      timezone: 'America/New_York',
      enableSetQuality: true,
      restClockMode: 'countdown',
      defaultWeightStepKg: 2.5,
    });

    // Custom exercise with weightStepKg + aliases
    const customEx = await createCustomExercise(userA.id, {
      name: 'Zercher Squat',
      trackingType: 'weight_reps',
      equipment: 'barbell',
      category: 'legs',
      defaultRestSeconds: 150,
      weightStepKg: 1.25,
      aliases: ['zercher'],
    });

    // Hide a catalog exercise & set per-catalog step override
    await setExerciseHidden(userA.id, 'burpee', true);
    await setExerciseWeightStepForUser(userA.id, 'barbell-bench-press', 1.25);

    // Body metrics
    await recordBodyMetric({
      userId: userA.id,
      measuredOn: '2026-11-01',
      weightKg: 85.0,
      source: 'manual',
    });
    await recordBodyMetric({
      userId: userA.id,
      measuredOn: '2026-11-10',
      weightKg: 84.5,
      source: 'settings',
    });

    // Active schedule + days + exercises + schedule event
    const schedId = 'sched_src_a';
    const dayPushId = 'sday_src_push';
    const dayRestId = 'sday_src_rest';
    const nowIso = '2026-11-01T10:00:00.000Z';
    await query(
      `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
       VALUES ($1, $2, 'Upper / Rest', 1, '2026-11-01', 0, $3, $3)`,
      [schedId, userA.id, nowIso],
    );
    await query(
      `INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES
       ($1, $3, 0, 'Heavy Day', 0),
       ($2, $3, 1, 'Rest', 1)`,
      [dayPushId, dayRestId, schedId],
    );
    await query(
      `INSERT INTO schedule_day_exercises (id, schedule_day_id, exercise_id, order_index, target_sets, target_reps, rest_seconds, notes)
       VALUES ($1, $2, $3, 0, 3, 5, 150, 'Brace hard')`,
      ['sdex_src_1', dayPushId, customEx.id],
    );
    await query(
      `INSERT INTO schedule_events (id, user_id, schedule_id, event_date, event_type, shift_days, jolly_label, created_at)
       VALUES ($1, $2, $3, '2026-11-05', 'skip', NULL, NULL, $4)`,
      ['se_src_1', userA.id, schedId, nowIso],
    );

    // Logged workout session with Phase 3 actualRestSeconds/restApproximate + repQualities
    await saveWorkoutSession(userA.id, {
      sessionDate: '2026-11-02',
      scheduleDayId: dayPushId,
      title: 'Heavy Day',
      durationMinutes: 55,
      userWeightKg: 84.5,
      notes: 'Felt strong',
      startedAt: '2026-11-02T17:00:00.000Z',
      completedAt: '2026-11-02T17:55:00.000Z',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          notes: 'Paused',
          sets: [
            {
              setNumber: 1,
              weightKg: 100,
              reps: 5,
              restSeconds: 150,
              actualRestSeconds: null,
              restApproximate: false,
              executionQualityPct: 92,
              isCompleted: true,
              repQualities: [
                { repIndex: 1, qualityPct: 95 },
                { repIndex: 2, qualityPct: 90 },
              ],
            },
            {
              setNumber: 2,
              weightKg: 100,
              reps: 5,
              restSeconds: 150,
              actualRestSeconds: 148,
              restApproximate: true,
              executionQualityPct: 88,
              isCompleted: true,
            },
          ],
        },
        {
          exerciseId: customEx.id,
          orderIndex: 1,
          notes: '',
          sets: [
            {
              setNumber: 1,
              weightKg: 90,
              reps: 6,
              restSeconds: 120,
              actualRestSeconds: 125,
              restApproximate: false,
              isCompleted: true,
            },
          ],
        },
      ],
    });

    const exported = await buildUserExportJson(userA);
    const exportedJson = JSON.stringify(exported, null, 2);

    // Import into clean User B via API route
    const { user: userB, token: tokenB } = await createAuthedUser('b');

    const validateRes = await postLiftitupImport(
      makeCookieReq(tokenB, {
        action: 'validate',
        mode: 'merge',
        rawText: exportedJson,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(validateRes.status, 200);
    const validateBody = (await validateRes.json()) as {
      valid: boolean;
      preview: {
        sessionsCount: number;
        unit: string;
        bodyMetricsCount: number;
        unmatchedExercises: unknown[];
        activeScheduleSummary: { name: string; daysCount: number; eventsCount: number };
      };
    };
    assert.equal(validateBody.valid, true);
    assert.equal(validateBody.preview.sessionsCount, 1);
    assert.equal(validateBody.preview.unit, 'lb');
    assert.equal(validateBody.preview.bodyMetricsCount, 2);
    assert.equal(validateBody.preview.unmatchedExercises.length, 0);
    assert.equal(validateBody.preview.activeScheduleSummary.name, 'Upper / Rest');
    assert.equal(validateBody.preview.activeScheduleSummary.daysCount, 2);
    assert.equal(validateBody.preview.activeScheduleSummary.eventsCount, 1);

    const confirmRes = await postLiftitupImport(
      makeCookieReq(tokenB, {
        action: 'confirm',
        mode: 'merge',
        rawText: exportedJson,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(confirmRes.status, 200);
    const confirmBody = (await confirmRes.json()) as {
      sessionsCreated: number;
      sessionsSkipped: number;
      bodyMetricsCreated: number;
      customExercisesCreated: number;
      splitRestored: boolean;
      scheduleEventsCreated: number;
    };
    assert.equal(confirmBody.sessionsCreated, 1);
    assert.equal(confirmBody.sessionsSkipped, 0);
    assert.equal(confirmBody.bodyMetricsCreated, 2);
    assert.equal(confirmBody.customExercisesCreated, 1);
    assert.equal(confirmBody.splitRestored, true);
    assert.equal(confirmBody.scheduleEventsCreated, 1);

    // Verify User B DB state
    const reloadedB = await getUserById(userB.id);
    assert.ok(reloadedB);
    assert.equal(reloadedB.username, 'user_b');
    assert.equal(reloadedB.unit, 'lb');
    assert.equal(reloadedB.restClockMode, 'countdown');
    assert.equal(reloadedB.defaultWeightStepKg, 2.5);
    assert.equal(reloadedB.enableSetQuality, true);
    assert.equal(reloadedB.heightCm, 182);
    assert.equal(reloadedB.weightKg, 84.5);
    assert.equal(reloadedB.timezone, 'America/New_York');

    const bExercises = await listExercises(userB.id, { includeHidden: true });
    const bCustom = bExercises.find((e) => e.isCustom && e.name === 'Zercher Squat');
    assert.ok(bCustom);
    assert.notEqual(bCustom.id, customEx.id);
    assert.equal(bCustom.weightStepKg, 1.25);

    const bBench = bExercises.find((e) => e.id === 'barbell-bench-press');
    assert.equal(bBench?.userWeightStepKg, 1.25);
    const bBurpee = bExercises.find((e) => e.id === 'burpee');
    assert.equal(bBurpee?.isHidden, true);

    const bSchedule = await getActiveSchedule(userB.id);
    assert.ok(bSchedule);
    assert.notEqual(bSchedule.id, schedId);
    assert.equal(bSchedule.name, 'Upper / Rest');
    assert.equal(bSchedule.days[0].exercises[0].exerciseId, bCustom.id);

    const bEvents = await listScheduleEvents(userB.id, bSchedule.id);
    assert.equal(bEvents.length, 1);
    assert.equal(bEvents[0].eventType, 'skip');

    const bMetrics = await listBodyMetrics(userB.id);
    assert.equal(bMetrics.length, 2);

    const bSessions = await listWorkoutSessions(userB.id);
    assert.equal(bSessions.length, 1);
    assert.equal(bSessions[0].scheduleId, null);
    assert.equal(bSessions[0].scheduleDayId, null);
    assert.equal(bSessions[0].cid, `import:liftitup:${exported.sessions[0].id}`);
    assert.equal(bSessions[0].exercises[0].sets[1].actualRestSeconds, 148);
    assert.equal(bSessions[0].exercises[0].sets[1].restApproximate, true);
    assert.equal(bSessions[0].exercises[0].sets[0].executionQualityPct, 92);
    assert.equal(bSessions[0].exercises[0].sets[0].repQualities?.length, 2);

    // Second Merge import of same file is a no-op
    const secondMerge = await applyLiftitupRestore(reloadedB, exportedJson, {
      mode: 'merge',
    });
    assert.equal(secondMerge.sessionsCreated, 0);
    assert.equal(secondMerge.sessionsSkipped, 1);
    assert.equal(secondMerge.bodyMetricsCreated, 0);
    assert.equal(secondMerge.bodyMetricsSkipped, 2);
    assert.equal(secondMerge.customExercisesCreated, 0);
    assert.equal(secondMerge.customExercisesReused, 1);
    assert.equal(secondMerge.splitRestored, false);
    assert.equal(secondMerge.splitKeptExisting, true);

    assert.equal((await listWorkoutSessions(userB.id)).length, 1);
    assert.equal((await listBodyMetrics(userB.id)).length, 2);
    assert.equal(
      (await listExercises(userB.id, { includeHidden: true })).filter((e) => e.isCustom)
        .length,
      1,
    );
  } finally {
    await closeDb();
  }
});

test('Phase 6: Replace mode rollback on mid-import failure, successful Replace preserves account/auth/API key/Apple Health/other user', async () => {
  const { pool, setFailSubstring } = createMemPool();
  setTestPool(pool);

  try {
    const { user: targetUser, token } = await createAuthedUser('target', {
      weightKg: 79,
    });
    const { user: otherUser } = await createAuthedUser('other', {
      weightKg: 90,
    });

    await upsertApiKey(targetUser.id, 'hash_key_target', 'liuk_target12');
    const oldCustom = await createCustomExercise(targetUser.id, {
      name: 'Old Target Exercise',
      trackingType: 'weight_reps',
    });
    await recordBodyMetric({
      userId: targetUser.id,
      measuredOn: '2026-10-01',
      weightKg: 79,
      source: 'manual',
    });
    await query(
      `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
       VALUES ('sched_old_active', $1, 'Old Split', 1, '2026-10-01', 0, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
              ('sched_old_inactive', $1, 'Old Inactive', 0, '2026-09-01', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
      [targetUser.id],
    );
    const { session: oldSession } = await saveWorkoutSession(targetUser.id, {
      sessionDate: '2026-10-02',
      title: 'Old Session',
      exercises: [
        {
          exerciseId: oldCustom.id,
          sets: [{ setNumber: 1, weightKg: 50, reps: 10, isCompleted: true }],
        },
      ],
    });
    await query(
      `INSERT INTO apple_health_workouts (id, user_id, workout_type, started_at, duration_minutes, linked_session_id, source, created_at)
       VALUES ('ah_target_1', $1, 'Strength', '2026-10-02T17:00:00Z', 45, $2, 'shortcut_webhook', '2026-10-02T18:00:00Z')`,
      [targetUser.id, oldSession.id],
    );

    // Seed second user data that must remain untouched
    await saveWorkoutSession(otherUser.id, {
      sessionDate: '2026-10-03',
      title: 'Other User Session',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          sets: [{ setNumber: 1, weightKg: 80, reps: 8, isCompleted: true }],
        },
      ],
    });

    // Export payload from a clean synthetic export (containing foreign userId/username and foreign IDs)
    const foreignExportJson = JSON.stringify({
      schemaVersion: 2,
      exportedAt: '2026-11-10T10:00:00.000Z',
      userId: 'usr_evil_attacker',
      user: {
        id: 'usr_evil_attacker',
        username: 'evil_username',
        displayName: 'Evil Name',
        heightCm: 175,
        weightKg: 72,
        age: 25,
        trainingYears: 2,
        unit: 'kg',
        timezone: 'UTC',
        enableSetQuality: false,
        restClockMode: 'stopwatch',
        defaultWeightStepKg: 2.5,
        appleFitnessEnabled: true,
      },
      activeSchedule: {
        id: 'sched_foreign_id',
        name: 'Restored PPL',
        anchorDate: '2026-11-01',
        anchorIndex: 0,
        days: [
          {
            id: 'sday_foreign_1',
            position: 0,
            label: 'Push',
            isRestDay: false,
            exercises: [
              {
                id: 'sdex_foreign_1',
                scheduleDayId: 'sday_foreign_1',
                exerciseId: 'barbell-bench-press',
                exerciseName: 'Barbell Bench Press',
                trackingType: 'weight_reps',
                orderIndex: 0,
                targetSets: 3,
                targetReps: 8,
                targetRepsMin: null,
                targetRepsMax: null,
                targetTimeSeconds: null,
                targetWeightKg: 80,
                targetDistanceM: null,
                restSeconds: 120,
                notes: '',
              },
            ],
          },
        ],
      },
      exercises: {
        custom: [
          {
            id: 'ex_foreign_custom',
            userId: 'usr_evil_attacker',
            slug: 'foreign-slug',
            name: 'Restored Custom Curl',
            trackingType: 'weight_reps',
            equipment: 'dumbbell',
            category: 'pull',
            defaultRestSeconds: 90,
            weightStepKg: 1.0,
            isCustom: true,
            isHidden: false,
            aliases: ['restored curl'],
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        hiddenIds: [],
      },
      exerciseStepPrefs: [],
      bodyMetrics: [
        {
          id: 'bm_foreign_1',
          userId: 'usr_evil_attacker',
          measuredOn: '2026-11-09',
          weightKg: 72,
          source: 'manual',
          createdAt: '2026-11-09T08:00:00.000Z',
        },
      ],
      scheduleEvents: [],
      sessions: [
        {
          id: 'ses_foreign_1',
          sessionDate: '2026-11-09',
          scheduleId: 'sched_foreign_id',
          scheduleDayId: 'sday_foreign_1',
          title: 'Restored Session',
          isJolly: false,
          jollyMode: null,
          startedAt: '2026-11-09T18:00:00.000Z',
          completedAt: '2026-11-09T18:45:00.000Z',
          durationMinutes: 45,
          userWeightKg: 72,
          notes: '',
          appleHealth: { kcal: null, avgHr: null, maxHr: null },
          exercises: [
            {
              exerciseId: 'ex_foreign_custom',
              name: 'Restored Custom Curl',
              trackingType: 'weight_reps',
              orderIndex: 0,
              notes: '',
              sets: [
                {
                  setNumber: 1,
                  weightKg: 12,
                  reps: 12,
                  timeSeconds: null,
                  distanceM: null,
                  restSeconds: 90,
                  actualRestSeconds: 85,
                  restApproximate: false,
                  executionQualityPct: null,
                  isCompleted: true,
                  repQualities: [],
                },
              ],
            },
          ],
        },
      ],
    });

    // 1. Replace without confirmation word must reject BEFORE deleting anything
    await assert.rejects(
      () =>
        applyLiftitupRestore(targetUser, foreignExportJson, {
          mode: 'replace',
          confirmation: 'WRONG',
        }),
      /REPLACE/,
    );
    assert.equal((await listWorkoutSessions(targetUser.id)).length, 1);

    // 2. Forced failure mid-import (after resetUserAccountDataForRestoreInTx ran) rolls back completely
    setFailSubstring('INSERT INTO workout_sessions');
    await assert.rejects(
      () =>
        applyLiftitupRestore(targetUser, foreignExportJson, {
          mode: 'replace',
          confirmation: 'REPLACE',
        }),
      /Injected mid-import failure/,
    );
    setFailSubstring(null);

    // Original data must still be completely intact after rollback
    const sessionsAfterRollback = await listWorkoutSessions(targetUser.id);
    assert.equal(sessionsAfterRollback.length, 1);
    assert.equal(sessionsAfterRollback[0].id, oldSession.id);
    assert.equal((await getActiveSchedule(targetUser.id))?.name, 'Old Split');
    assert.equal((await listBodyMetrics(targetUser.id)).length, 1);

    // 3. Successful Replace via API route
    const replaceRes = await postLiftitupImport(
      makeCookieReq(token, {
        action: 'confirm',
        mode: 'replace',
        confirmation: 'REPLACE',
        rawText: foreignExportJson,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(replaceRes.status, 200);

    // Old data removed, restored data present with fresh IDs and owned by targetUser
    const restoredSessions = await listWorkoutSessions(targetUser.id);
    assert.equal(restoredSessions.length, 1);
    assert.equal(restoredSessions[0].title, 'Restored Session');
    assert.notEqual(restoredSessions[0].id, 'ses_foreign_1');
    assert.equal(restoredSessions[0].userId, targetUser.id);
    assert.equal(restoredSessions[0].cid, 'import:liftitup:ses_foreign_1');

    const restoredSched = await getActiveSchedule(targetUser.id);
    assert.ok(restoredSched);
    assert.notEqual(restoredSched.id, 'sched_foreign_id');
    assert.notEqual(restoredSched.days[0].id, 'sday_foreign_1');

    const allScheds = await query<{ id: string }>(
      'SELECT id FROM schedules WHERE user_id = $1',
      [targetUser.id],
    );
    assert.equal(allScheds.rows.length, 1); // old inactive split removed

    const restoredCustom = (
      await listExercises(targetUser.id, { includeHidden: true })
    ).filter((e) => e.isCustom);
    assert.equal(restoredCustom.length, 1);
    assert.notEqual(restoredCustom[0].id, 'ex_foreign_custom');
    assert.equal(restoredCustom[0].name, 'Restored Custom Curl');
    assert.equal(restoredCustom[0].weightStepKg, 1.0);

    const restoredMetrics = await listBodyMetrics(targetUser.id);
    assert.equal(restoredMetrics.length, 1);
    assert.notEqual(restoredMetrics[0].id, 'bm_foreign_1');

    // Account, username, API key, auth session, and Apple Health workout preserved (with linked_session_id = NULL)
    const userRow = await getUserById(targetUser.id);
    assert.equal(userRow?.username, 'user_target');
    const apiKeyRow = await queryOne<{ key_prefix: string }>(
      'SELECT key_prefix FROM api_keys WHERE user_id = $1',
      [targetUser.id],
    );
    assert.equal(apiKeyRow?.key_prefix, 'liuk_target12');
    const authSessRow = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM auth_sessions WHERE user_id = $1',
      [targetUser.id],
    );
    assert.equal(authSessRow?.user_id, targetUser.id);
    const ahRow = await queryOne<{ id: string; linked_session_id: string | null }>(
      'SELECT id, linked_session_id FROM apple_health_workouts WHERE user_id = $1',
      [targetUser.id],
    );
    assert.equal(ahRow?.id, 'ah_target_1');
    assert.equal(ahRow?.linked_session_id, null);

    // Evil foreign user was never created & second user's data is untouched
    assert.equal(await getUserById('usr_evil_attacker'), null);
    assert.equal((await listWorkoutSessions(otherUser.id)).length, 1);

    // Subsequent Merge import of same file after Replace is a no-op
    const postReplaceMerge = await applyLiftitupRestore(
      userRow!,
      foreignExportJson,
      { mode: 'merge' },
    );
    assert.equal(postReplaceMerge.sessionsCreated, 0);
    assert.equal(postReplaceMerge.sessionsSkipped, 1);
  } finally {
    await closeDb();
  }
});

test('Phase 6: Unmatched exercise flow (flag in preview, reject without decision, succeed with map or create_custom)', async () => {
  const { pool } = createMemPool();
  setTestPool(pool);

  try {
    const { user } = await createAuthedUser('unmatched');

    const exportWithUnknown = JSON.stringify({
      schemaVersion: 2,
      exportedAt: '2026-11-12T10:00:00.000Z',
      user: { unit: 'kg', weightKg: 75 },
      exercises: { custom: [], hiddenIds: [] },
      exerciseStepPrefs: [],
      bodyMetrics: [],
      scheduleEvents: [],
      activeSchedule: null,
      sessions: [
        {
          id: 'ses_unk_1',
          sessionDate: '2026-11-11',
          scheduleId: null,
          scheduleDayId: null,
          title: 'Mystery Workout',
          isJolly: false,
          jollyMode: null,
          startedAt: '2026-11-11T10:00:00.000Z',
          completedAt: '2026-11-11T10:30:00.000Z',
          durationMinutes: 30,
          userWeightKg: 75,
          notes: '',
          appleHealth: { kcal: null, avgHr: null, maxHr: null },
          exercises: [
            {
              exerciseId: 'unknown-slug-999',
              name: 'Unicorn Press',
              trackingType: 'weight_reps',
              orderIndex: 0,
              notes: '',
              sets: [
                {
                  setNumber: 1,
                  weightKg: 40,
                  reps: 10,
                  isCompleted: true,
                },
              ],
            },
          ],
        },
      ],
    });

    const validation = await validateLiftitupRestore(user, exportWithUnknown, {
      mode: 'merge',
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.preview?.unmatchedExercises.length, 1);
    assert.equal(validation.preview?.unmatchedExercises[0].name, 'Unicorn Press');

    // Confirm without resolution must reject
    await assert.rejects(
      () => applyLiftitupRestore(user, exportWithUnknown, { mode: 'merge' }),
      /Unmatched exercise "Unicorn Press"/,
    );
    assert.equal((await listWorkoutSessions(user.id)).length, 0);

    // Map to existing catalog exercise
    const mappedRes = await applyLiftitupRestore(user, exportWithUnknown, {
      mode: 'merge',
      exerciseResolutions: {
        'unicorn press': {
          action: 'map',
          targetExerciseId: 'barbell-bench-press',
        },
      },
    });
    assert.equal(mappedRes.sessionsCreated, 1);
    const mappedSessions = await listWorkoutSessions(user.id);
    assert.equal(
      mappedSessions[0].exercises[0].exerciseId,
      'barbell-bench-press',
    );

    // Create as custom in Replace mode
    const customRes = await applyLiftitupRestore(user, exportWithUnknown, {
      mode: 'replace',
      confirmation: 'REPLACE',
      exerciseResolutions: {
        'unicorn press': {
          action: 'create_custom',
          name: 'Unicorn Press',
          trackingType: 'weight_reps',
        },
      },
    });
    assert.equal(customRes.customExercisesCreated, 1);
    assert.equal(customRes.sessionsCreated, 1);
    const customExercises = (await listExercises(user.id)).filter(
      (e) => e.isCustom,
    );
    assert.equal(customExercises.length, 1);
    assert.equal(customExercises[0].name, 'Unicorn Press');
  } finally {
    await closeDb();
  }
});

test('Phase 6: Imported sessions carry no schedule link and do not move projectUserCalendar split rotation', async () => {
  const { pool } = createMemPool();
  setTestPool(pool);

  try {
    const { user } = await createAuthedUser('rot');
    const nowIso = '2026-11-06T08:00:00.000Z';
    await query(
      `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
       VALUES ('sched_rot', $1, 'PPL', 1, '2026-11-06', 0, $2, $2)`,
      [user.id, nowIso],
    );
    await query(
      `INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day) VALUES
       ('d_push', 'sched_rot', 0, 'Push', 0),
       ('d_pull', 'sched_rot', 1, 'Pull', 0),
       ('d_legs', 'sched_rot', 2, 'Legs', 0)`,
    );

    const exportJson = JSON.stringify({
      schemaVersion: 2,
      user: { unit: 'kg', weightKg: 75 },
      activeSchedule: {
        id: 'sched_exported',
        name: 'Exported Split',
        anchorDate: '2026-11-01',
        anchorIndex: 0,
        days: [
          {
            id: 'd_exp_1',
            position: 0,
            label: 'Full Body',
            isRestDay: false,
            exercises: [],
          },
        ],
      },
      exercises: { custom: [], hiddenIds: [] },
      exerciseStepPrefs: [],
      bodyMetrics: [],
      scheduleEvents: [],
      sessions: [
        {
          id: 'ses_hist_1',
          sessionDate: '2026-11-06',
          scheduleId: 'sched_other',
          scheduleDayId: 'd_other',
          title: 'Old Imported Push',
          isJolly: false,
          jollyMode: null,
          startedAt: '2026-11-06T12:00:00.000Z',
          completedAt: '2026-11-06T12:45:00.000Z',
          exercises: [
            {
              exerciseId: 'barbell-bench-press',
              name: 'Barbell Bench Press',
              trackingType: 'weight_reps',
              orderIndex: 0,
              sets: [{ setNumber: 1, weightKg: 60, reps: 8, isCompleted: true }],
            },
          ],
        },
      ],
    });

    const applied = await applyLiftitupRestore(user, exportJson, {
      mode: 'merge',
    });
    assert.equal(applied.splitKeptExisting, true);
    assert.equal(applied.splitRestored, false);
    assert.equal(applied.sessionsCreated, 1);

    const cal = await projectUserCalendar({
      userId: user.id,
      today: '2026-11-07',
      rangeStart: '2026-11-06',
      rangeEnd: '2026-11-08',
    });
    // 2026-11-06 Push was NOT completed by the imported session, so today 2026-11-07 is still Push!
    assert.equal(cal.days[0].status, 'skipped');
    assert.equal(cal.days[0].sessions.length, 1);
    assert.equal(cal.days[0].sessions[0].scheduleId, null);
    assert.equal(cal.days[0].sessions[0].scheduleDayId, null);
    assert.equal(cal.days[0].sessions[0].cid, 'import:liftitup:ses_hist_1');
    assert.equal(cal.days[1].status, 'planned');
    assert.equal(cal.days[1].plannedDay?.label, 'Push');
    assert.equal(cal.days[2].plannedDay?.label, 'Pull');
  } finally {
    await closeDb();
  }
});

test('Phase 6: Rejects oversize (> 8 MB) and malformed JSON files cleanly with 400 + settings search includes restore and AI import', async () => {
  const { pool } = createMemPool();
  setTestPool(pool);

  try {
    const { token } = await createAuthedUser('limit');

    // 1. Content-Length > 8 MB rejected with 400
    const clRes = await postLiftitupImport(
      makeCookieReq(
        token,
        { action: 'validate', rawText: '{}' },
        { 'content-length': String(MAX_IMPORT_BYTES + 1) },
      ),
      { params: Promise.resolve({}) },
    );
    assert.equal(clRes.status, 400);

    // 2. Actual raw body > 8 MB rejected with 400 even without Content-Length header
    const oversizedBody = JSON.stringify({
      action: 'validate',
      rawText: 'x'.repeat(MAX_IMPORT_BYTES + 100),
    });
    const bigRes = await postLiftitupImport(
      new NextRequest('http://localhost/api/imports/liftitup', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
        body: oversizedBody,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(bigRes.status, 400);

    // 3. Malformed JSON inside rawText rejected with 400
    const badJsonRes = await postLiftitupImport(
      makeCookieReq(token, { action: 'validate', rawText: '{bad json' }),
      { params: Promise.resolve({}) },
    );
    assert.equal(badJsonRes.status, 400);

    // 4. Wrong schemaVersion rejected with 400
    const badSchemaRes = await postLiftitupImport(
      makeCookieReq(token, {
        action: 'validate',
        rawText: JSON.stringify({ schemaVersion: 99, sessions: [] }),
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(badSchemaRes.status, 400);

    // 5. Settings search items include Restore & AI Plan Import
    const restoreMatches = filterSettingsItems('restore');
    assert.ok(restoreMatches.some((i) => i.href === '/settings/data#restore'));
    const aiMatches = filterSettingsItems('ai import');
    assert.ok(aiMatches.some((i) => i.href === '/settings/data/ai'));
  } finally {
    await closeDb();
  }
});
