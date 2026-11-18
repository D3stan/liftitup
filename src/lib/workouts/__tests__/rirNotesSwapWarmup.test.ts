import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
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
const {
  createUser,
  getUserById,
  localDateForTimezone,
  updateUserSettings,
} = await import('@/lib/db/users');
const { createAuthSession } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { createGuestSandbox } = await import('@/lib/auth/sandbox');
const { ApiError } = await import('@/lib/api/handler');
const {
  getActiveSchedule,
  getLastPerformanceByExerciseIds,
  getWorkoutSessionById,
  listWorkoutSessions,
} = await import('@/lib/db/workouts');
const {
  addDaysYmd,
  applyExerciseSwap,
  getWorkoutDayView,
  saveWorkoutSession,
  updateWorkoutSession,
} = await import('@/lib/workouts/queries');
const {
  computeActualRestForWorkoutSets,
  computeSessionRestSummary,
} = await import('@/lib/workouts/rest');
const {
  buildUserExportCsv,
  buildUserExportJson,
  CSV_HEADERS,
} = await import('@/lib/export/exportData');
const {
  applyLiftitupRestore,
  REPLACE_CONFIRMATION_WORD,
  validateLiftitupRestore,
} = await import('@/lib/imports/liftitupRestore');
const { handleMcpJsonRpcRequest } = await import('@/lib/mcp/server');
const { GET: getSettingsRoute, PATCH: patchSettingsRoute } = await import(
  '@/app/api/settings/route'
);
const { GET: getProgressRoute } = await import('@/app/api/progress/route');
const { PUT: putScheduleRoute } = await import('@/app/api/schedule/route');

function createMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const snapshots = new Map<string, ReturnType<typeof memDb.backup>>();

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
        return params && params.length > 0
          ? client.query(sql, params)
          : client.query(sql);
      },
      release() {
        client.release();
      },
    }) as unknown as PoolClient;

  return {
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
}

function makeCookieReq(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
) {
  const headers: Record<string, string> = {
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
  let bodyStr: string | undefined;
  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
    bodyStr =
      typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  }
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });
}

test('1. Additive pg-mem migration: drops new columns, runs initSchema idempotently, preserves defaults without Corrupted alias', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();

    // Seed pre-existing rows before dropping columns so we also verify backfill defaults
    const guest = await createGuestSandbox('UTC');
    const today = localDateForTimezone('UTC');
    const { session } = await saveWorkoutSession(guest.id, {
      sessionDate: today,
      title: 'Pre-migration Session',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [{ setNumber: 1, weightKg: 60, reps: 8, isCompleted: true }],
        },
      ],
    });

    // Drop all Wave 1 columns across workout_sets, schedule_day_exercises, and users
    await pool.query('ALTER TABLE workout_sets DROP COLUMN rir');
    await pool.query('ALTER TABLE workout_sets DROP COLUMN notes');
    await pool.query('ALTER TABLE workout_sets DROP COLUMN is_warmup');
    await pool.query(
      'ALTER TABLE schedule_day_exercises DROP COLUMN target_warmup_sets',
    );
    await pool.query('ALTER TABLE users DROP COLUMN always_show_rir');
    await pool.query('ALTER TABLE users DROP COLUMN enable_set_note_tags');
    await pool.query('ALTER TABLE users DROP COLUMN enable_set_note_hint');

    // Run initSchema twice to confirm idempotent re-creation without Corrupted alias errors
    await initSchema(pool);
    await initSchema(pool);

    const userRow = await queryOne<{
      always_show_rir: number;
      enable_set_note_tags: number;
      enable_set_note_hint: number;
    }>(
      'SELECT always_show_rir, enable_set_note_tags, enable_set_note_hint FROM users WHERE id = $1',
      [guest.id],
    );
    assert.deepEqual(userRow, {
      always_show_rir: 0,
      enable_set_note_tags: 1,
      enable_set_note_hint: 1,
    });

    const sdeRow = await queryOne<{ target_warmup_sets: number }>(
      `
      SELECT sde.target_warmup_sets
      FROM schedule_day_exercises sde
      JOIN schedule_days sd ON sd.id = sde.schedule_day_id
      JOIN schedules s ON s.id = sd.schedule_id
      WHERE s.user_id = $1
      LIMIT 1
      `,
      [guest.id],
    );
    assert.ok(sdeRow);
    assert.equal(Number(sdeRow.target_warmup_sets), 0);

    const setRow = await queryOne<{
      rir: number | null;
      notes: string;
      is_warmup: number;
    }>(
      'SELECT rir, notes, is_warmup FROM workout_sets WHERE id = $1',
      [session.exercises[0].sets[0].id],
    );
    assert.deepEqual(setRow, {
      rir: null,
      notes: '',
      is_warmup: 0,
    });
  } finally {
    await closeDb();
  }
});

test('2. User settings persistence & validation for alwaysShowRir, enableSetNoteTags, enableSetNoteHint', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();
    const user = await createUser({
      username: 'settings_lifter',
      displayName: 'Settings Lifter',
      passwordHash: 'hash',
      timezone: 'UTC',
    });

    // Defaults
    assert.equal(user.alwaysShowRir, false);
    assert.equal(user.enableSetNoteTags, true);
    assert.equal(user.enableSetNoteHint, true);

    const token = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      user.id,
      hashToken(token),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    // Helper updateUserSettings
    const helperUpdated = await updateUserSettings(user.id, {
      alwaysShowRir: true,
      enableSetNoteTags: false,
    });
    assert.ok(helperUpdated);
    assert.equal(helperUpdated.alwaysShowRir, true);
    assert.equal(helperUpdated.enableSetNoteTags, false);
    assert.equal(helperUpdated.enableSetNoteHint, true);

    // PATCH /api/settings valid update
    const patchReq = makeCookieReq('http://localhost/api/settings', token, {
      method: 'PATCH',
      body: {
        alwaysShowRir: false,
        enableSetNoteTags: true,
        enableSetNoteHint: false,
      },
    });
    const patchRes = await patchSettingsRoute(patchReq, {
      params: Promise.resolve({}),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as {
      user: {
        alwaysShowRir: boolean;
        enableSetNoteTags: boolean;
        enableSetNoteHint: boolean;
      };
    };
    assert.equal(patchJson.user.alwaysShowRir, false);
    assert.equal(patchJson.user.enableSetNoteTags, true);
    assert.equal(patchJson.user.enableSetNoteHint, false);

    // GET /api/settings + getUserById + getWorkoutDayView reflect persisted values
    const getReq = makeCookieReq('http://localhost/api/settings', token);
    const getRes = await getSettingsRoute(getReq, {
      params: Promise.resolve({}),
    });
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as {
      user: {
        alwaysShowRir: boolean;
        enableSetNoteTags: boolean;
        enableSetNoteHint: boolean;
      };
    };
    assert.equal(getJson.user.alwaysShowRir, false);
    assert.equal(getJson.user.enableSetNoteTags, true);
    assert.equal(getJson.user.enableSetNoteHint, false);

    const reloaded = await getUserById(user.id);
    assert.ok(reloaded);
    assert.equal(reloaded.enableSetNoteHint, false);

    const dayView = await getWorkoutDayView(user.id, '2026-11-18', '2026-11-18');
    assert.equal(dayView.user.alwaysShowRir, false);
    assert.equal(dayView.user.enableSetNoteTags, true);
    assert.equal(dayView.user.enableSetNoteHint, false);

    // PATCH /api/settings rejects non-boolean values
    for (const badBody of [
      { alwaysShowRir: 'true' },
      { enableSetNoteTags: 1 },
      { enableSetNoteHint: null },
    ]) {
      const badReq = makeCookieReq('http://localhost/api/settings', token, {
        method: 'PATCH',
        body: badBody,
      });
      const badRes = await patchSettingsRoute(badReq, {
        params: Promise.resolve({}),
      });
      assert.equal(badRes.status, 400);
    }
  } finally {
    await closeDb();
  }
});

test('3. Workout session save/update/hydrate with rir, per-set notes, and isWarmup ordering', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();
    const user = await createUser({
      username: 'session_lifter',
      displayName: 'Session Lifter',
      passwordHash: 'hash',
      timezone: 'UTC',
    });

    const longNote = `  ${'a'.repeat(550)}  `;
    const { session } = await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-10',
      title: 'Push Day',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [
            // Deliberately submit working sets before warmup sets to verify warmup-first ordering & 1..N numbering
            {
              setNumber: 1,
              weightKg: 100,
              reps: 5,
              rir: 0,
              notes: '  max effort  ',
              isWarmup: false,
            },
            {
              setNumber: 2,
              weightKg: 80,
              reps: 8,
              rir: 2.5,
              notes: longNote,
              isWarmup: false,
            },
            {
              setNumber: 3,
              weightKg: 40,
              reps: 10,
              rir: null,
              notes: '  bar only  ',
              isWarmup: true,
            },
            {
              setNumber: 4,
              weightKg: 60,
              reps: 5,
              rir: 10,
              notes: '',
              isWarmup: true,
            },
          ],
        },
      ],
    });

    const sets = session.exercises[0].sets;
    assert.equal(sets.length, 4);
    // Warmups ordered first, set_number 1..4
    assert.deepEqual(
      sets.map((s) => ({
        setNumber: s.setNumber,
        isWarmup: s.isWarmup,
        weightKg: s.weightKg,
        rir: s.rir,
      })),
      [
        { setNumber: 1, isWarmup: true, weightKg: 40, rir: null },
        { setNumber: 2, isWarmup: true, weightKg: 60, rir: 10 },
        { setNumber: 3, isWarmup: false, weightKg: 100, rir: 0 },
        { setNumber: 4, isWarmup: false, weightKg: 80, rir: 2.5 },
      ],
    );
    assert.equal(sets[0].notes, 'bar only');
    assert.equal(sets[2].notes, 'max effort');
    assert.equal(sets[3].notes.length, 500);
    assert.equal(sets[3].notes, 'a'.repeat(500));

    // Hydrate via getWorkoutSessionById
    const hydrated = await getWorkoutSessionById(user.id, session.id);
    assert.ok(hydrated);
    assert.equal(hydrated.exercises[0].sets[0].isWarmup, true);
    assert.equal(hydrated.exercises[0].sets[2].rir, 0);
    assert.equal(hydrated.exercises[0].sets[3].rir, 2.5);
    assert.equal(hydrated.exercises[0].sets[3].notes.length, 500);

    // Invalid RIR values rejected with 400 ApiError
    for (const badRir of [-1, 11, 2.3]) {
      await assert.rejects(
        () =>
          saveWorkoutSession(user.id, {
            sessionDate: '2026-11-11',
            title: 'Bad RIR',
            exercises: [
              {
                exerciseId: 'barbell-bench-press',
                sets: [{ weightKg: 60, reps: 5, rir: badRir }],
              },
            ],
          }),
        (err: unknown) => err instanceof ApiError && err.status === 400,
      );
    }

    // Update session: change RIR, notes, and warmup flag, verify re-ordering & hydration
    const updated = await updateWorkoutSession(user.id, session.id, {
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [
            {
              setNumber: 1,
              weightKg: 95,
              reps: 6,
              rir: 1.5,
              notes: '  updated work  ',
              isWarmup: false,
            },
            {
              setNumber: 2,
              weightKg: 50,
              reps: 6,
              rir: null,
              notes: '  updated warm  ',
              isWarmup: true,
            },
          ],
        },
      ],
    });
    assert.equal(updated.exercises[0].sets.length, 2);
    assert.equal(updated.exercises[0].sets[0].setNumber, 1);
    assert.equal(updated.exercises[0].sets[0].isWarmup, true);
    assert.equal(updated.exercises[0].sets[0].notes, 'updated warm');
    assert.equal(updated.exercises[0].sets[1].setNumber, 2);
    assert.equal(updated.exercises[0].sets[1].isWarmup, false);
    assert.equal(updated.exercises[0].sets[1].rir, 1.5);
    assert.equal(updated.exercises[0].sets[1].notes, 'updated work');
  } finally {
    await closeDb();
  }
});

test('4a. Warmup isolation in getLastPerformanceByExerciseIds and GET /api/progress', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();
    const user = await createUser({
      username: 'warmup_iso_lifter',
      displayName: 'Warmup Isolation Lifter',
      passwordHash: 'hash',
      timezone: 'UTC',
    });
    const token = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      user.id,
      hashToken(token),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    // Older session (2026-11-03, Tuesday): has warmup + working sets for bench & assisted pull-up
    await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-03',
      title: 'Working Session',
      startedAt: '2026-11-03T10:00:00.000Z',
      completedAt: '2026-11-03T10:45:00.000Z',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [
            {
              weightKg: 100, // deliberately higher than working set to catch leakage into primaryValue/volume
              reps: 10,
              isWarmup: true,
              notes: 'old warmup',
            },
            {
              weightKg: 60,
              reps: 5,
              rir: 2,
              notes: 'working bench',
              isWarmup: false,
            },
            {
              weightKg: 200,
              reps: 10,
              isWarmup: false,
              isCompleted: false, // incomplete set must also be excluded
            },
          ],
        },
        {
          exerciseId: 'assisted-pull-up',
          orderIndex: 1,
          sets: [
            {
              weightKg: 5, // lowest assistance in warmup -> must NOT beat working 20 in Math.min!
              reps: 5,
              isWarmup: true,
            },
            {
              weightKg: 25,
              reps: 8,
              isWarmup: false,
            },
            {
              weightKg: 20,
              reps: 8,
              isWarmup: false,
            },
          ],
        },
      ],
    });

    // Newer session (2026-11-10, Tuesday next week): warmup-only for bench!
    await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-10',
      title: 'Warmup Only Session',
      startedAt: '2026-11-10T10:00:00.000Z',
      completedAt: '2026-11-10T10:15:00.000Z',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [
            {
              weightKg: 50,
              reps: 6,
              rir: 5,
              notes: 'recent warmup',
              isWarmup: true,
            },
          ],
        },
      ],
    });

    // getLastPerformanceByExerciseIds skips warmup-only 2026-11-10 for working sets,
    // still prefills working sets from 2026-11-03, and returns warmupSets from 2026-11-10.
    const prefill = await getLastPerformanceByExerciseIds(
      user.id,
      ['barbell-bench-press'],
      '2026-11-12',
    );
    const benchPrefill = prefill['barbell-bench-press'];
    assert.ok(benchPrefill);
    assert.equal(benchPrefill.lastSessionDate, '2026-11-03');
    assert.equal(benchPrefill.sets.length, 1);
    assert.equal(benchPrefill.sets[0].weightKg, 60);
    assert.equal(benchPrefill.sets[0].reps, 5);
    assert.equal(benchPrefill.sets[0].rir, 2);
    assert.equal(benchPrefill.sets[0].notes, 'working bench');

    assert.ok(benchPrefill.warmupSets);
    assert.equal(benchPrefill.warmupSets.length, 1);
    assert.equal(benchPrefill.warmupSets[0].weightKg, 50);
    assert.equal(benchPrefill.warmupSets[0].reps, 6);
    assert.equal(benchPrefill.warmupSets[0].rir, 5);
    assert.equal(benchPrefill.warmupSets[0].notes, 'recent warmup');

    // Also add an exercise logged ONLY with warmups (2026-11-11) to verify it is excluded from progress exercises & weeklySets while keeping weeklySessions
    await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-11',
      title: 'Squat Warmup Only',
      startedAt: '2026-11-11T10:00:00.000Z',
      completedAt: '2026-11-11T10:15:00.000Z',
      exercises: [
        {
          exerciseId: 'barbell-back-squat',
          orderIndex: 0,
          sets: [{ weightKg: 60, reps: 5, isWarmup: true }],
        },
      ],
    });

    // GET /api/progress for barbell-bench-press (end-to-end route check)
    const benchRes = await getProgressRoute(
      makeCookieReq(
        'http://localhost/api/progress?range=4w&today=2026-11-12&exerciseId=barbell-bench-press',
        token,
      ),
      { params: Promise.resolve({}) },
    );
    assert.equal(benchRes.status, 200);
    const benchProg = (await benchRes.json()) as {
      exercises: Array<{ id: string; sessionCount: number }>;
      selectedExercise: { id: string; sessionCount: number } | null;
      exerciseSeries: Array<{
        date: string;
        primaryValue: number;
        volumeKg: number | null;
        setsCount: number;
      }>;
      weeklySessions: Array<{ weekStart: string; value: number }>;
      weeklySets: Array<{ weekStart: string; value: number }>;
    };

    assert.equal(
      benchProg.exercises.some((e) => e.id === 'barbell-back-squat'),
      false,
    );
    assert.equal(benchProg.selectedExercise?.id, 'barbell-bench-press');
    assert.equal(benchProg.selectedExercise?.sessionCount, 1);
    assert.equal(benchProg.exerciseSeries.length, 1);
    assert.deepEqual(
      {
        date: benchProg.exerciseSeries[0].date,
        primaryValue: benchProg.exerciseSeries[0].primaryValue,
        volumeKg: benchProg.exerciseSeries[0].volumeKg,
        setsCount: benchProg.exerciseSeries[0].setsCount,
      },
      {
        date: '2026-11-03',
        primaryValue: 60,
        volumeKg: 300,
        setsCount: 1,
      },
    );

    // Week of 2026-11-02: 1 session, 3 completed working sets (1 bench + 2 pull-ups)
    const wk1Sessions = benchProg.weeklySessions.find(
      (w) => w.weekStart === '2026-11-02',
    );
    const wk1Sets = benchProg.weeklySets.find(
      (w) => w.weekStart === '2026-11-02',
    );
    assert.equal(wk1Sessions?.value, 1);
    assert.equal(wk1Sets?.value, 3);

    // Week of 2026-11-09: two warmup-only sessions count in weeklySessions (2) and 0 in weeklySets
    const wk2Sessions = benchProg.weeklySessions.find(
      (w) => w.weekStart === '2026-11-09',
    );
    const wk2Sets = benchProg.weeklySets.find(
      (w) => w.weekStart === '2026-11-09',
    );
    assert.equal(wk2Sessions?.value, 2);
    assert.equal(wk2Sets?.value, 0);

    // GET /api/progress for assisted-pull-up verifies Math.min ignores warmup 5kg
    const pullRes = await getProgressRoute(
      makeCookieReq(
        'http://localhost/api/progress?range=4w&today=2026-11-12&exerciseId=assisted-pull-up',
        token,
      ),
      { params: Promise.resolve({}) },
    );
    assert.equal(pullRes.status, 200);
    const pullProg = (await pullRes.json()) as {
      exerciseSeries: Array<{
        primaryValue: number;
        setsCount: number;
      }>;
    };
    assert.equal(pullProg.exerciseSeries.length, 1);
    assert.equal(pullProg.exerciseSeries[0].primaryValue, 20);
    assert.equal(pullProg.exerciseSeries[0].setsCount, 2);
  } finally {
    await closeDb();
  }
});

test('4b. Warmup isolation in computeActualRestForWorkoutSets & computeSessionRestSummary', () => {
  const base = Date.parse('2026-11-16T10:00:00.000Z');
  const iso = (offsetSec: number) =>
    new Date(base + offsetSec * 1000).toISOString();

  // Case 1: Leading warmups + working sets; warmups get null rest and do not interfere with working rests
  const leadingWarmups = computeActualRestForWorkoutSets([
    {
      sets: [
        {
          isCompleted: true,
          isWarmup: true,
          completedAt: iso(0),
          restEndedAt: iso(45),
          completionSeq: 1,
        },
        {
          isCompleted: true,
          isWarmup: true,
          completedAt: iso(60),
          restEndedAt: null,
          completionSeq: 2,
        },
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(120),
          restEndedAt: iso(210), // explicit 90s
          completionSeq: 3,
        },
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(240),
          restEndedAt: null, // fallback 130s to next working set
          completionSeq: 4,
        },
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(370),
          restEndedAt: null,
          completionSeq: 5,
        },
      ],
    },
  ]);

  assert.deepEqual(leadingWarmups[0], [
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: 90, restApproximate: false },
    { actualRestSeconds: 130, restApproximate: true },
    { actualRestSeconds: null, restApproximate: false },
  ]);

  // Summary excludes warmups so warmups with null rest do not cause false hasUnmeasuredRests or lose workingTimeSeconds
  const summary = computeSessionRestSummary({
    durationMinutes: 10, // 600s
    exercises: [
      {
        sets: [
          {
            isCompleted: true,
            isWarmup: true,
            actualRestSeconds: null,
            restApproximate: false,
          },
          {
            isCompleted: true,
            isWarmup: true,
            actualRestSeconds: null,
            restApproximate: false,
          },
          {
            isCompleted: true,
            isWarmup: false,
            actualRestSeconds: 90,
            restApproximate: false,
          },
          {
            isCompleted: true,
            isWarmup: false,
            actualRestSeconds: 130,
            restApproximate: true,
          },
          {
            isCompleted: true,
            isWarmup: false,
            actualRestSeconds: null,
            restApproximate: false,
          },
        ],
      },
    ],
  });

  assert.equal(summary.completedSetCount, 3);
  assert.equal(summary.nonFinalSetCount, 2);
  assert.equal(summary.measuredNonFinalCount, 2);
  assert.equal(summary.allRestsMeasured, true);
  assert.equal(summary.hasUnmeasuredRests, false);
  assert.equal(summary.totalRestSeconds, 220);
  assert.equal(summary.workingTimeSeconds, 380);

  // Case 2: Intervening warmup between working sets blocks fallback rest while preserving explicit restEndedAt
  const intervening = computeActualRestForWorkoutSets([
    {
      sets: [
        // Working set 0 with NO restEndedAt, followed by an intervening warmup -> fallback blocked (null)
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(0),
          restEndedAt: null,
          completionSeq: 1,
        },
        {
          isCompleted: true,
          isWarmup: true,
          completedAt: iso(60),
          restEndedAt: iso(110),
          completionSeq: 2,
        },
        // Working set 1 HAS explicit restEndedAt, followed by an intervening warmup -> explicit 80s preserved
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(150),
          restEndedAt: iso(230),
          completionSeq: 3,
        },
        {
          isCompleted: true,
          isWarmup: true,
          completedAt: iso(250),
          restEndedAt: null,
          completionSeq: 4,
        },
        {
          isCompleted: true,
          isWarmup: false,
          completedAt: iso(320),
          restEndedAt: null,
          completionSeq: 5,
        },
      ],
    },
  ]);

  assert.deepEqual(intervening[0], [
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: 80, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
  ]);
});

test('5. Split swap (session/schedule/revert) & PUT /api/schedule preserve notes and clean up stale session_swaps', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();
    const guest = await createGuestSandbox('UTC');
    const today = localDateForTimezone('UTC');
    const yesterday = addDaysYmd(today, -1);
    const tomorrow = addDaysYmd(today, 1);

    const token = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      guest.id,
      hashToken(token),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    const schedule = await getActiveSchedule(guest.id);
    assert.ok(schedule);
    const firstNonRestDay = schedule.days.find((d) => !d.isRestDay && d.exercises.length > 0);
    assert.ok(firstNonRestDay);
    const slot = firstNonRestDay.exercises[0];
    const originalExId = slot.exerciseId;
    const originalExName = slot.exerciseName;

    // Give the slot a split note and targetWarmupSets via DB update
    await query(
      'UPDATE schedule_day_exercises SET notes = $1, target_warmup_sets = $2 WHERE id = $3',
      ['Keep elbows tucked', 2, slot.id],
    );

    // Find a date where firstNonRestDay is planned
    let plannedDate: string | null = null;
    for (let offset = 0; offset <= 10; offset += 1) {
      const candidate = addDaysYmd(today, offset);
      const view = await getWorkoutDayView(guest.id, candidate, today);
      if (view.calendarDay.plannedDay?.id === firstNonRestDay.id) {
        plannedDate = candidate;
        break;
      }
    }
    assert.ok(plannedDate, 'Expected planned day within 10 days');

    // 5a) Session swap preserves notes & sets swappedFromExerciseId / swappedFromExerciseName
    const altExerciseId =
      originalExId === 'flat-dumbbell-bench-press'
        ? 'incline-barbell-bench-press'
        : 'flat-dumbbell-bench-press';
    const sessionSwapRes = await applyExerciseSwap(guest.id, {
      dateKey: plannedDate,
      scheduleDayExerciseId: slot.id,
      toExerciseId: altExerciseId,
      scope: 'session',
    });
    assert.equal(sessionSwapRes.toExercise.id, altExerciseId);

    const swappedView = await getWorkoutDayView(guest.id, plannedDate, today);
    const swappedSlot = swappedView.calendarDay.plannedDay?.exercises.find(
      (e) => e.id === slot.id,
    );
    assert.ok(swappedSlot);
    assert.equal(swappedSlot.exerciseId, altExerciseId);
    assert.equal(swappedSlot.swappedFromExerciseId, originalExId);
    assert.equal(swappedSlot.swappedFromExerciseName, originalExName);
    assert.equal(swappedSlot.notes, 'Keep elbows tucked');
    assert.equal(swappedSlot.targetWarmupSets, 2);

    // 5b) Revert swap deletes session_swaps row, restores original exercise, and preserves notes
    const revertRes = await applyExerciseSwap(guest.id, {
      dateKey: plannedDate,
      scheduleDayExerciseId: slot.id,
      scope: 'revert',
    });
    assert.equal(revertRes.toExercise.id, originalExId);

    const swapRowAfterRevert = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
      [guest.id, plannedDate, slot.id],
    );
    assert.equal(swapRowAfterRevert, null);

    const revertedView = await getWorkoutDayView(guest.id, plannedDate, today);
    const revertedSlot = revertedView.calendarDay.plannedDay?.exercises.find(
      (e) => e.id === slot.id,
    );
    assert.ok(revertedSlot);
    assert.equal(revertedSlot.exerciseId, originalExId);
    assert.equal(revertedSlot.swappedFromExerciseId, undefined);
    assert.equal(revertedSlot.notes, 'Keep elbows tucked');

    // 5c) Schedule swap updates schedule_day_exercises, deletes session_swap for dateKey, preserves notes
    await applyExerciseSwap(guest.id, {
      dateKey: plannedDate,
      scheduleDayExerciseId: slot.id,
      toExerciseId: altExerciseId,
      scope: 'session',
    });
    const thirdExerciseId =
      originalExId === 'incline-dumbbell-bench-press'
        ? 'cable-chest-fly'
        : 'incline-dumbbell-bench-press';
    await applyExerciseSwap(guest.id, {
      dateKey: plannedDate,
      scheduleDayExerciseId: slot.id,
      toExerciseId: thirdExerciseId,
      scope: 'schedule',
    });

    const slotAfterScheduleSwap = await queryOne<{
      exercise_id: string;
      notes: string;
    }>('SELECT exercise_id, notes FROM schedule_day_exercises WHERE id = $1', [
      slot.id,
    ]);
    assert.deepEqual(slotAfterScheduleSwap, {
      exercise_id: thirdExerciseId,
      notes: 'Keep elbows tucked',
    });
    const swapRowAfterSched = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
      [guest.id, plannedDate, slot.id],
    );
    assert.equal(swapRowAfterSched, null);

    // 5d) PUT /api/schedule updating exerciseId on existing slot preserves notes & cleans stale session_swaps for date_key >= today
    for (const dk of [yesterday, today, tomorrow]) {
      await query(
        'INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id) VALUES ($1, $2, $3, $4)',
        [guest.id, dk, slot.id, altExerciseId],
      );
    }

    const updatedExerciseId = originalExId;
    const putBody = {
      name: schedule.name,
      today,
      days: schedule.days.map((d) => ({
        id: d.id,
        label: d.label,
        isRestDay: d.isRestDay,
        exercises: d.exercises.map((e) =>
          e.id === slot.id
            ? {
                id: e.id,
                exerciseId: updatedExerciseId,
                targetSets: e.targetSets,
                targetWarmupSets: 3,
                targetReps: e.targetReps,
                targetRepsMin: e.targetRepsMin,
                targetRepsMax: e.targetRepsMax,
                targetTimeSeconds: e.targetTimeSeconds,
                targetWeightKg: e.targetWeightKg,
                targetDistanceM: e.targetDistanceM,
                restSeconds: e.restSeconds,
                notes: 'Keep elbows tucked',
              }
            : {
                id: e.id,
                exerciseId: e.exerciseId,
                targetSets: e.targetSets,
                targetWarmupSets: e.targetWarmupSets,
                targetReps: e.targetReps,
                targetRepsMin: e.targetRepsMin,
                targetRepsMax: e.targetRepsMax,
                targetTimeSeconds: e.targetTimeSeconds,
                targetWeightKg: e.targetWeightKg,
                targetDistanceM: e.targetDistanceM,
                restSeconds: e.restSeconds,
                notes: e.notes,
              },
        ),
      })),
    };

    const putRes = await putScheduleRoute(
      makeCookieReq('http://localhost/api/schedule', token, {
        method: 'PUT',
        body: putBody,
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(putRes.status, 200);

    const slotAfterPut = await queryOne<{
      exercise_id: string;
      notes: string;
      target_warmup_sets: number;
    }>(
      'SELECT exercise_id, notes, target_warmup_sets FROM schedule_day_exercises WHERE id = $1',
      [slot.id],
    );
    assert.deepEqual(slotAfterPut, {
      exercise_id: updatedExerciseId,
      notes: 'Keep elbows tucked',
      target_warmup_sets: 3,
    });

    const remainingSwaps = await query<{ date_key: string }>(
      'SELECT date_key FROM session_swaps WHERE user_id = $1 AND schedule_day_exercise_id = $2 ORDER BY date_key ASC',
      [guest.id, slot.id],
    );
    assert.deepEqual(
      remainingSwaps.rows.map((r) => r.date_key),
      [yesterday],
    );
  } finally {
    await closeDb();
  }
});

test('6. Export & Restore backward compatibility: JSON, CSV appended columns, v2 round-trip, and legacy v2 restore', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();

    // Source user with non-default settings, split with targetWarmupSets, and session with warmup + RIR + per-set notes
    const srcUser = await createUser({
      username: 'export_src',
      displayName: 'Export Source',
      passwordHash: 'hash',
      timezone: 'UTC',
      alwaysShowRir: true,
      enableSetNoteTags: false,
      enableSetNoteHint: false,
    });

    const schedId = `sch_${crypto.randomUUID()}`;
    const dayId = `sd_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    await query(
      `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
       VALUES ($1, $2, 'Test Split', 1, '2026-11-01', 0, $3, $3)`,
      [schedId, srcUser.id, nowIso],
    );
    await query(
      `INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
       VALUES ($1, $2, 0, 'Push', 0)`,
      [dayId, schedId],
    );
    await query(
      `INSERT INTO schedule_day_exercises (id, schedule_day_id, exercise_id, order_index, target_sets, target_warmup_sets, target_reps, rest_seconds, notes)
       VALUES ($1, $2, 'barbell-bench-press', 0, 3, 2, 6, 150, 'Pause on chest')`,
      [`sde_${crypto.randomUUID()}`, dayId],
    );

    await saveWorkoutSession(srcUser.id, {
      sessionDate: '2026-11-05',
      scheduleDayId: dayId,
      title: 'Push Export Test',
      startedAt: '2026-11-05T10:00:00.000Z',
      completedAt: '2026-11-05T10:45:00.000Z',
      durationMinutes: 45,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          notes: 'Felt dialed in',
          sets: [
            {
              setNumber: 1,
              weightKg: 40,
              reps: 8,
              rir: null,
              notes: 'Warmup, fast bar',
              isWarmup: true,
              isCompleted: true,
            },
            {
              setNumber: 2,
              weightKg: 90,
              reps: 6,
              rir: 2.5,
              notes: 'Clean pause',
              isWarmup: false,
              isCompleted: true,
            },
          ],
        },
      ],
    });

    // 6a) Export JSON includes new user, schedule, and set fields
    const exportedJson = await buildUserExportJson(srcUser);
    assert.equal(exportedJson.user.alwaysShowRir, true);
    assert.equal(exportedJson.user.enableSetNoteTags, false);
    assert.equal(exportedJson.user.enableSetNoteHint, false);
    assert.equal(
      exportedJson.activeSchedule?.days[0].exercises[0].targetWarmupSets,
      2,
    );
    assert.deepEqual(
      exportedJson.sessions[0].exercises[0].sets.map((s) => ({
        setNumber: s.setNumber,
        isWarmup: s.isWarmup,
        rir: s.rir,
        notes: s.notes,
      })),
      [
        {
          setNumber: 1,
          isWarmup: true,
          rir: null,
          notes: 'Warmup, fast bar',
        },
        {
          setNumber: 2,
          isWarmup: false,
          rir: 2.5,
          notes: 'Clean pause',
        },
      ],
    );

    // 6b) Export CSV appends is_warmup, rir, set_notes after is_completed without shifting existing indices
    assert.equal(CSV_HEADERS[23], 'is_completed');
    assert.deepEqual(CSV_HEADERS.slice(24), ['is_warmup', 'rir', 'set_notes']);
    const csv = await buildUserExportCsv(srcUser);
    const csvLines = csv.trim().split('\n');
    assert.equal(csvLines.length, 3); // header + 2 sets
    assert.equal(csvLines[0], CSV_HEADERS.join(','));
    // First data row is warmup set (note has comma -> quoted)
    assert.ok(csvLines[1].endsWith(',1,1,,"Warmup, fast bar"'));
    // Second data row is working set
    assert.ok(csvLines[2].endsWith(',1,0,2.5,Clean pause'));

    // 6c) Round-trip restore into target user
    const targetUser = await createUser({
      username: 'restore_target',
      displayName: 'Restore Target',
      passwordHash: 'hash',
      timezone: 'UTC',
      alwaysShowRir: false,
      enableSetNoteTags: true,
      enableSetNoteHint: true,
    });

    const rawNewBackup = JSON.stringify(exportedJson);
    const valNew = await validateLiftitupRestore(targetUser, rawNewBackup, {
      mode: 'replace',
    });
    assert.equal(valNew.valid, true);

    await applyLiftitupRestore(targetUser, rawNewBackup, {
      mode: 'replace',
      confirmation: REPLACE_CONFIRMATION_WORD,
    });

    const restoredUser = await getUserById(targetUser.id);
    assert.ok(restoredUser);
    assert.equal(restoredUser.alwaysShowRir, true);
    assert.equal(restoredUser.enableSetNoteTags, false);
    assert.equal(restoredUser.enableSetNoteHint, false);

    const restoredSched = await getActiveSchedule(targetUser.id);
    assert.ok(restoredSched);
    assert.equal(restoredSched.days[0].exercises[0].targetWarmupSets, 2);
    assert.equal(restoredSched.days[0].exercises[0].notes, 'Pause on chest');

    const restoredSessions = await listWorkoutSessions(targetUser.id);
    assert.equal(restoredSessions.length, 1);
    const restoredSets = restoredSessions[0].exercises[0].sets;
    assert.equal(restoredSets.length, 2);
    assert.equal(restoredSets[0].isWarmup, true);
    assert.equal(restoredSets[0].rir, null);
    assert.equal(restoredSets[0].notes, 'Warmup, fast bar');
    assert.equal(restoredSets[1].isWarmup, false);
    assert.equal(restoredSets[1].rir, 2.5);
    assert.equal(restoredSets[1].notes, 'Clean pause');

    // 6d) Legacy v2 JSON without any of the new fields restores cleanly with defaults
    const legacyPayload = {
      schemaVersion: 2,
      exportedAt: exportedJson.exportedAt,
      user: {
        username: 'legacy_user',
        displayName: 'Legacy User',
        heightCm: null,
        weightKg: 75,
        age: null,
        trainingYears: null,
        unit: 'kg',
        timezone: 'UTC',
        enableSetQuality: false,
        restClockMode: 'stopwatch',
        defaultWeightStepKg: null,
        appleFitnessEnabled: true,
      },
      activeSchedule: {
        id: 'old_sched',
        name: 'Legacy Split',
        anchorDate: '2026-11-01',
        anchorIndex: 0,
        days: [
          {
            id: 'old_day',
            position: 0,
            label: 'Push',
            isRestDay: false,
            exercises: [
              {
                id: 'old_sde',
                scheduleDayId: 'old_day',
                exerciseId: 'barbell-bench-press',
                exerciseName: 'Barbell Bench Press',
                trackingType: 'weight_reps',
                orderIndex: 0,
                targetSets: 3,
                targetReps: 8,
                targetRepsMin: null,
                targetRepsMax: null,
                targetTimeSeconds: null,
                targetWeightKg: null,
                targetDistanceM: null,
                restSeconds: 120,
                notes: 'Legacy note',
              },
            ],
          },
        ],
      },
      exercises: { custom: [], hiddenIds: [] },
      exerciseStepPrefs: [],
      bodyMetrics: [],
      scheduleEvents: [],
      sessions: [
        {
          id: 'legacy_sess_1',
          sessionDate: '2026-11-02',
          scheduleId: null,
          scheduleDayId: null,
          title: 'Legacy Session',
          isJolly: false,
          jollyMode: null,
          startedAt: '2026-11-02T10:00:00.000Z',
          completedAt: '2026-11-02T10:40:00.000Z',
          durationMinutes: 40,
          userWeightKg: 75,
          notes: '',
          appleHealth: { kcal: null, avgHr: null, maxHr: null },
          exercises: [
            {
              exerciseId: 'barbell-bench-press',
              name: 'Barbell Bench Press',
              trackingType: 'weight_reps',
              orderIndex: 0,
              notes: '',
              sets: [
                {
                  setNumber: 1,
                  weightKg: 70,
                  reps: 8,
                  timeSeconds: null,
                  distanceM: null,
                  restSeconds: 120,
                  actualRestSeconds: null,
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
    };

    const legacyUser = await createUser({
      username: 'legacy_target',
      displayName: 'Legacy Target',
      passwordHash: 'hash',
      timezone: 'UTC',
      alwaysShowRir: true,
      enableSetNoteTags: false,
      enableSetNoteHint: false,
    });
    const rawLegacy = JSON.stringify(legacyPayload);
    const valLegacy = await validateLiftitupRestore(legacyUser, rawLegacy, {
      mode: 'replace',
    });
    assert.equal(valLegacy.valid, true);

    await applyLiftitupRestore(legacyUser, rawLegacy, {
      mode: 'replace',
      confirmation: REPLACE_CONFIRMATION_WORD,
    });

    const restoredLegacyUser = await getUserById(legacyUser.id);
    assert.ok(restoredLegacyUser);
    assert.equal(restoredLegacyUser.alwaysShowRir, false);
    assert.equal(restoredLegacyUser.enableSetNoteTags, true);
    assert.equal(restoredLegacyUser.enableSetNoteHint, true);

    const restoredLegacySched = await getActiveSchedule(legacyUser.id);
    assert.ok(restoredLegacySched);
    assert.equal(restoredLegacySched.days[0].exercises[0].targetWarmupSets, 0);
    assert.equal(restoredLegacySched.days[0].exercises[0].notes, 'Legacy note');

    const restoredLegacySessions = await listWorkoutSessions(legacyUser.id);
    assert.equal(restoredLegacySessions.length, 1);
    const legacySet = restoredLegacySessions[0].exercises[0].sets[0];
    assert.equal(legacySet.rir, null);
    assert.equal(legacySet.notes, '');
    assert.equal(legacySet.isWarmup, false);
  } finally {
    await closeDb();
  }
});

test('7. Review fixes: self-swap delete, schedule-swap & slot-deletion session_swaps cleanup, warmup-only prefill, and MCP get_profile / log_workout_session ordering', async () => {
  const pool = createMemPool();
  setTestPool(pool);

  try {
    await pingDb();
    const guest = await createGuestSandbox('UTC');
    const today = localDateForTimezone('UTC');
    const yesterday = addDaysYmd(today, -1);
    const tomorrow = addDaysYmd(today, 1);

    const token = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      guest.id,
      hashToken(token),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    const schedule = await getActiveSchedule(guest.id);
    assert.ok(schedule);
    const nonRestDays = schedule.days.filter(
      (d) => !d.isRestDay && d.exercises.length > 0,
    );
    assert.ok(nonRestDays.length >= 2);
    const day0 = nonRestDays[0];
    const day1 = nonRestDays[1];
    const slot0 = day0.exercises[0];
    const slot1 = day1.exercises[0];
    const altExerciseId =
      slot0.exerciseId === 'flat-dumbbell-bench-press'
        ? 'incline-barbell-bench-press'
        : 'flat-dumbbell-bench-press';

    // 7a) applyExerciseSwap scope:'session' with toExerciseId === slot.exerciseId deletes existing session_swaps row (no self-swap)
    await applyExerciseSwap(guest.id, {
      dateKey: today,
      scheduleDayExerciseId: slot0.id,
      toExerciseId: altExerciseId,
      scope: 'session',
    });
    const insertedSwap = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
      [guest.id, today, slot0.id],
    );
    assert.ok(insertedSwap);

    await applyExerciseSwap(guest.id, {
      dateKey: today,
      scheduleDayExerciseId: slot0.id,
      toExerciseId: slot0.exerciseId,
      scope: 'session',
    });
    const afterSelfSwap = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND date_key = $2 AND schedule_day_exercise_id = $3',
      [guest.id, today, slot0.id],
    );
    assert.equal(afterSelfSwap, null);

    // 7b) applyExerciseSwap scope:'schedule' deletes session_swaps for date_key >= input.dateKey (keeping earlier dates)
    for (const dk of [yesterday, today, tomorrow]) {
      await query(
        'INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id) VALUES ($1, $2, $3, $4)',
        [guest.id, dk, slot0.id, altExerciseId],
      );
    }
    const thirdExId =
      slot0.exerciseId === 'incline-dumbbell-bench-press'
        ? 'cable-chest-fly'
        : 'incline-dumbbell-bench-press';
    await applyExerciseSwap(guest.id, {
      dateKey: today,
      scheduleDayExerciseId: slot0.id,
      toExerciseId: thirdExId,
      scope: 'schedule',
    });
    const remainingSlot0Swaps = await query<{ date_key: string }>(
      'SELECT date_key FROM session_swaps WHERE user_id = $1 AND schedule_day_exercise_id = $2 ORDER BY date_key ASC',
      [guest.id, slot0.id],
    );
    assert.deepEqual(
      remainingSlot0Swaps.rows.map((r) => r.date_key),
      [yesterday],
    );

    // 7c) PUT /api/schedule cleans up session_swaps when deleting removed days/exercise slots
    const removedSlotInDay0 = day0.exercises[1];
    assert.ok(removedSlotInDay0, 'Expected at least 2 exercises in first day');
    await query(
      'INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id) VALUES ($1, $2, $3, $4)',
      [guest.id, today, removedSlotInDay0.id, altExerciseId],
    );
    await query(
      'INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id) VALUES ($1, $2, $3, $4)',
      [guest.id, today, slot1.id, altExerciseId],
    );

    // Replace schedule: drop day1 entirely AND drop removedSlotInDay0 from day0
    const latestSchedule = await getActiveSchedule(guest.id);
    assert.ok(latestSchedule);
    const putRes = await putScheduleRoute(
      makeCookieReq('http://localhost/api/schedule', token, {
        method: 'PUT',
        body: {
          name: latestSchedule.name,
          today,
          days: latestSchedule.days
            .filter((d) => d.id !== day1.id)
            .map((d) => ({
              id: d.id,
              label: d.label,
              isRestDay: d.isRestDay,
              exercises:
                d.id === day0.id
                  ? d.exercises
                      .filter((e) => e.id !== removedSlotInDay0.id)
                      .map((e) => ({
                        id: e.id,
                        exerciseId: e.exerciseId,
                        targetSets: e.targetSets,
                        targetWarmupSets: e.targetWarmupSets,
                        targetReps: e.targetReps,
                        targetRepsMin: e.targetRepsMin,
                        targetRepsMax: e.targetRepsMax,
                        targetTimeSeconds: e.targetTimeSeconds,
                        targetWeightKg: e.targetWeightKg,
                        targetDistanceM: e.targetDistanceM,
                        restSeconds: e.restSeconds,
                        notes: e.notes,
                      }))
                  : d.exercises.map((e) => ({
                      id: e.id,
                      exerciseId: e.exerciseId,
                      targetSets: e.targetSets,
                      targetWarmupSets: e.targetWarmupSets,
                      targetReps: e.targetReps,
                      targetRepsMin: e.targetRepsMin,
                      targetRepsMax: e.targetRepsMax,
                      targetTimeSeconds: e.targetTimeSeconds,
                      targetWeightKg: e.targetWeightKg,
                      targetDistanceM: e.targetDistanceM,
                      restSeconds: e.restSeconds,
                      notes: e.notes,
                    })),
            })),
        },
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(putRes.status, 200);

    const orphanSlot0Swap = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND schedule_day_exercise_id = $2',
      [guest.id, removedSlotInDay0.id],
    );
    const orphanDay1Swap = await queryOne(
      'SELECT * FROM session_swaps WHERE user_id = $1 AND schedule_day_exercise_id = $2',
      [guest.id, slot1.id],
    );
    assert.equal(orphanSlot0Swap, null);
    assert.equal(orphanDay1Swap, null);

    // 7d) getLastPerformanceByExerciseIds returns warmupSets & sets: [] when only warmups are logged
    await saveWorkoutSession(guest.id, {
      sessionDate: '2026-11-01',
      title: 'Warmup Only History',
      startedAt: '2026-11-01T09:00:00.000Z',
      completedAt: '2026-11-01T09:20:00.000Z',
      exercises: [
        {
          exerciseId: 'conventional-deadlift',
          orderIndex: 0,
          sets: [
            {
              weightKg: 70,
              reps: 5,
              rir: null,
              notes: 'light bar',
              isWarmup: true,
              isCompleted: true,
            },
          ],
        },
      ],
    });
    const deadliftPrefill = await getLastPerformanceByExerciseIds(
      guest.id,
      ['conventional-deadlift'],
      '2026-11-10',
    );
    const dl = deadliftPrefill['conventional-deadlift'];
    assert.ok(dl);
    assert.equal(dl.lastSessionDate, '2026-11-01');
    assert.deepEqual(dl.sets, []);
    assert.ok(dl.warmupSets && dl.warmupSets.length === 1);
    assert.equal(dl.warmupSets[0].weightKg, 70);
    assert.equal(dl.warmupSets[0].notes, 'light bar');

    // 7e) MCP get_profile includes new training flags & log_workout_session orders warmups before working sets
    const updatedGuest = await updateUserSettings(guest.id, {
      alwaysShowRir: true,
      enableSetNoteTags: false,
      enableSetNoteHint: false,
    });
    assert.ok(updatedGuest);

    const profileRes = await handleMcpJsonRpcRequest(updatedGuest, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'get_profile',
        arguments: {},
      },
    });
    const profilePayload = (
      profileRes?.result as {
        structuredContent: {
          profile: {
            alwaysShowRir: boolean;
            enableSetNoteTags: boolean;
            enableSetNoteHint: boolean;
          };
        };
      }
    ).structuredContent.profile;
    assert.equal(profilePayload.alwaysShowRir, true);
    assert.equal(profilePayload.enableSetNoteTags, false);
    assert.equal(profilePayload.enableSetNoteHint, false);

    const mcpLogRes = await handleMcpJsonRpcRequest(updatedGuest, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'log_workout_session',
        arguments: {
          sessionDate: '2026-11-14',
          title: 'MCP Warmup Ordering',
          exercises: [
            {
              exerciseId: 'barbell-bench-press',
              sets: [
                {
                  weightKg: 95,
                  reps: 5,
                  rir: 1.5,
                  notes: 'top set',
                  isWarmup: false,
                },
                {
                  weightKg: 50,
                  reps: 6,
                  rir: null,
                  notes: 'warm set',
                  isWarmup: true,
                },
              ],
            },
          ],
        },
      },
    });
    const loggedSets = (
      mcpLogRes?.result as {
        structuredContent: {
          session: {
            exercises: Array<{
              sets: Array<{
                setNumber: number;
                isWarmup: boolean;
                weightKg: number | null;
                rir: number | null;
                notes: string;
              }>;
            }>;
          };
        };
      }
    ).structuredContent.session.exercises[0].sets;
    assert.deepEqual(
      loggedSets.map((s) => ({
        setNumber: s.setNumber,
        isWarmup: s.isWarmup,
        weightKg: s.weightKg,
        rir: s.rir,
        notes: s.notes,
      })),
      [
        {
          setNumber: 1,
          isWarmup: true,
          weightKg: 50,
          rir: null,
          notes: 'warm set',
        },
        {
          setNumber: 2,
          isWarmup: false,
          weightKg: 95,
          rir: 1.5,
          notes: 'top set',
        },
      ],
    );
  } finally {
    await closeDb();
  }
});
