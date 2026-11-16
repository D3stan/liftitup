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
  FOCUS_EDGE_SWIPE_GUARD_PX,
  adjustFocusIndexAfterDelete,
  clampFocusIndex,
  computeFocusSummaryStats,
  evaluateFocusSwipe,
  formatExercisePeekTarget,
  moveFocusExercise,
} = await import('@/lib/workouts/focus');
const {
  computeActualRestForWorkoutSets,
} = await import('@/lib/workouts/rest');
const {
  displayToKg,
  parseOptionalInt,
  parseOptionalNum,
} = await import('@/components/workout/trackingFormat');
const {
  loadUserWorkoutDraft,
  saveUserWorkoutDraft,
} = await import('@/lib/offline/outbox');
const { filterSettingsItems } = await import('@/lib/settings/registry');
const { closeDb, pingDb, setTestPool } = await import('@/lib/db/connection');
const { createUser, getUserById } = await import('@/lib/db/users');
const { createAuthSession } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { PATCH: settingsPatchRoute } = await import('@/app/api/settings/route');
const {
  getWorkoutDayView,
  saveWorkoutSession,
} = await import('@/lib/workouts/queries');
const { buildUserExportJson } = await import('@/lib/export/exportData');
const { handleMcpJsonRpcRequest } = await import('@/lib/mcp/server');

import type { LoggerExercise, WorkoutDraft } from '@/components/workout/trackingFormat';

function makeLoggerExercise(
  overrides: Partial<LoggerExercise> & { sets: LoggerExercise['sets'] },
): LoggerExercise {
  return {
    localId: overrides.localId ?? 'ex_1',
    exerciseId: overrides.exerciseId ?? 'barbell-bench-press',
    exerciseName: overrides.exerciseName ?? 'Barbell Bench Press',
    trackingType: overrides.trackingType ?? 'weight_reps',
    defaultRestSeconds: overrides.defaultRestSeconds ?? 120,
    scheduleDayExerciseId: overrides.scheduleDayExerciseId ?? null,
    notes: overrides.notes ?? '',
    sets: overrides.sets,
  };
}

test('evaluateFocusSwipe protects screen edges, vertical scroll, interactive targets, and short jitters', () => {
  const vw = 375;

  // Left edge (iOS back-swipe) rejected
  assert.equal(
    evaluateFocusSwipe({
      startX: 12,
      startY: 300,
      endX: 160,
      endY: 300,
      viewportWidth: vw,
    }),
    null,
  );
  assert.equal(
    evaluateFocusSwipe({
      startX: FOCUS_EDGE_SWIPE_GUARD_PX,
      startY: 300,
      endX: 180,
      endY: 300,
      viewportWidth: vw,
    }),
    null,
  );

  // Right edge rejected
  assert.equal(
    evaluateFocusSwipe({
      startX: vw - FOCUS_EDGE_SWIPE_GUARD_PX,
      startY: 300,
      endX: 180,
      endY: 300,
      viewportWidth: vw,
    }),
    null,
  );

  // Vertical scrolling rejected
  assert.equal(
    evaluateFocusSwipe({
      startX: 200,
      startY: 400,
      endX: 140,
      endY: 280,
      viewportWidth: vw,
    }),
    null,
  );

  // Interactive target rejected
  assert.equal(
    evaluateFocusSwipe({
      startX: 240,
      startY: 300,
      endX: 100,
      endY: 300,
      viewportWidth: vw,
      isInteractiveTarget: true,
    }),
    null,
  );

  // Short jitter (< 50px) rejected
  assert.equal(
    evaluateFocusSwipe({
      startX: 200,
      startY: 300,
      endX: 151,
      endY: 300,
      viewportWidth: vw,
    }),
    null,
  );

  // Clean horizontal left swipe -> next
  assert.equal(
    evaluateFocusSwipe({
      startX: 260,
      startY: 300,
      endX: 150,
      endY: 315,
      viewportWidth: vw,
    }),
    'next',
  );

  // Clean horizontal right swipe -> prev
  assert.equal(
    evaluateFocusSwipe({
      startX: 110,
      startY: 300,
      endX: 230,
      endY: 290,
      viewportWidth: vw,
    }),
    'prev',
  );
});

test('clampFocusIndex, moveFocusExercise, and adjustFocusIndexAfterDelete track active exercise & summary cleanly', () => {
  assert.equal(clampFocusIndex(-3, 4), 0);
  assert.equal(clampFocusIndex(2, 4), 2);
  assert.equal(clampFocusIndex(4, 4), 4); // Summary step
  assert.equal(clampFocusIndex(99, 4), 4);
  assert.equal(clampFocusIndex(NaN, 4), 0);
  assert.equal(clampFocusIndex(2, 0), 0);

  const items = ['A', 'B', 'C', 'D'];
  // Moving active item B (1 -> 3) follows B to index 3
  const r1 = moveFocusExercise(items, 1, 3, 1);
  assert.deepEqual(r1.exercises, ['A', 'C', 'D', 'B']);
  assert.equal(r1.nextFocusIndex, 3);

  // Moving D (3 -> 0) while active is B (1) shifts B to index 2
  const r2 = moveFocusExercise(items, 3, 0, 1);
  assert.deepEqual(r2.exercises, ['D', 'A', 'B', 'C']);
  assert.equal(r2.nextFocusIndex, 2);

  // Moving A (0 -> 2) while active is B (1) shifts B to index 0
  const r3 = moveFocusExercise(items, 0, 2, 1);
  assert.deepEqual(r3.exercises, ['B', 'C', 'A', 'D']);
  assert.equal(r3.nextFocusIndex, 0);

  // Moving while on Summary (index 4) keeps Summary (index 4)
  const r4 = moveFocusExercise(items, 0, 2, 4);
  assert.equal(r4.nextFocusIndex, 4);

  // Deleting before current shifts down; deleting on summary stays on summary
  assert.equal(adjustFocusIndexAfterDelete(2, 0, 3), 1);
  assert.equal(adjustFocusIndexAfterDelete(2, 2, 2), 2); // last exercise deleted -> summary
  assert.equal(adjustFocusIndexAfterDelete(4, 1, 3), 3); // summary -> summary
  assert.equal(adjustFocusIndexAfterDelete(0, 0, 0), 0);
});

test('formatExercisePeekTarget formats concise preview across tracking types', () => {
  const bench = makeLoggerExercise({
    trackingType: 'weight_reps',
    sets: [
      {
        localId: 's1',
        setNumber: 1,
        weightDisplay: '80',
        reps: '8',
        timeSeconds: '',
        distanceM: '',
        restSeconds: 120,
        executionQualityPct: null,
        repQualities: [],
        isCompleted: false,
      },
      {
        localId: 's2',
        setNumber: 2,
        weightDisplay: '80',
        reps: '8',
        timeSeconds: '',
        distanceM: '',
        restSeconds: 120,
        executionQualityPct: null,
        repQualities: [],
        isCompleted: false,
      },
    ],
  });
  assert.equal(formatExercisePeekTarget(bench, 'kg'), '2 sets · 80kg × 8');

  const plank = makeLoggerExercise({
    trackingType: 'time',
    sets: [
      {
        localId: 's1',
        setNumber: 1,
        weightDisplay: '',
        reps: '',
        timeSeconds: '90',
        distanceM: '',
        restSeconds: 60,
        executionQualityPct: null,
        repQualities: [],
        isCompleted: false,
      },
    ],
  });
  assert.equal(formatExercisePeekTarget(plank, 'kg'), '1 set · 1m30s');
});

test('computeFocusSummaryStats computes working vs rest time, volume, and completed counts', () => {
  const startIso = '2026-11-16T10:00:00.000Z';
  const nowMs = Date.parse('2026-11-16T10:06:00.000Z'); // 360s elapsed

  const exercises: LoggerExercise[] = [
    makeLoggerExercise({
      localId: 'ex1',
      trackingType: 'weight_reps',
      sets: [
        {
          localId: 's1',
          setNumber: 1,
          weightDisplay: '100',
          reps: '5',
          timeSeconds: '',
          distanceM: '',
          restSeconds: 120,
          executionQualityPct: null,
          repQualities: [],
          isCompleted: true,
          completedAt: '2026-11-16T10:01:00.000Z',
          restEndedAt: '2026-11-16T10:02:30.000Z', // 90s exact rest
          completionSeq: 1,
        },
        {
          localId: 's2',
          setNumber: 2,
          weightDisplay: '100',
          reps: '5',
          timeSeconds: '',
          distanceM: '',
          restSeconds: 120,
          executionQualityPct: null,
          repQualities: [],
          isCompleted: true,
          completedAt: '2026-11-16T10:03:30.000Z',
          restEndedAt: null, // fallback to next set at 10:05:30 -> 120s ~approx
          completionSeq: 2,
        },
      ],
    }),
    makeLoggerExercise({
      localId: 'ex2',
      exerciseId: 'plank',
      exerciseName: 'Plank',
      trackingType: 'time',
      sets: [
        {
          localId: 's3',
          setNumber: 1,
          weightDisplay: '',
          reps: '',
          timeSeconds: '60',
          distanceM: '',
          restSeconds: 60,
          executionQualityPct: null,
          repQualities: [],
          isCompleted: true,
          completedAt: '2026-11-16T10:05:30.000Z',
          restEndedAt: null,
          completionSeq: 3,
        },
        {
          localId: 's4',
          setNumber: 2,
          weightDisplay: '',
          reps: '',
          timeSeconds: '60',
          distanceM: '',
          restSeconds: 60,
          executionQualityPct: null,
          repQualities: [],
          isCompleted: false,
        },
      ],
    }),
  ];

  const stats = computeFocusSummaryStats({
    exercises,
    unit: 'kg',
    startedAt: startIso,
    nowMs,
  });

  assert.equal(stats.elapsedSeconds, 360);
  assert.equal(stats.totalRestSeconds, 210); // 90 + 120
  assert.equal(stats.workingTimeSeconds, 150); // 360 - 210
  assert.equal(stats.allRestsMeasured, true);
  assert.equal(stats.hasAnyApproximate, true);
  assert.equal(stats.completedSetsCount, 3);
  assert.equal(stats.totalSetsCount, 4);
  assert.equal(stats.completedExercisesCount, 1);
  assert.equal(stats.totalExercisesCount, 2);
  assert.equal(stats.totalVolumeDisplay, 1000); // 100*5 + 100*5
  assert.equal(stats.totalVolumeKg, 1000);
});

test('Focus draft state (viewMode & focusExerciseIndex) survives user-scoped reload', () => {
  const backing = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key) {
      return backing.get(key) ?? null;
    },
    key(index) {
      return Array.from(backing.keys())[index] ?? null;
    },
    removeItem(key) {
      backing.delete(key);
    },
    setItem(key, value) {
      backing.set(key, value);
    },
  };

  const draft: WorkoutDraft = {
    cid: 'cid_focus_1',
    title: 'Push Day',
    notes: '',
    isJolly: false,
    jollyMode: null,
    startedAt: '2026-11-16T10:00:00.000Z',
    sessionStartSource: 'first_set',
    viewMode: 'focus',
    focusExerciseIndex: 2,
    exercises: [],
    updatedAt: '2026-11-16T10:05:00.000Z',
  };

  saveUserWorkoutDraft('usr_focus', 'new:2026-11-16:planned', draft, storage);
  const restored = loadUserWorkoutDraft<WorkoutDraft>(
    'usr_focus',
    'new:2026-11-16:planned',
    storage,
  );
  assert.equal(restored?.viewMode, 'focus');
  assert.equal(restored?.focusExerciseIndex, 2);
  assert.equal(restored?.cid, 'cid_focus_1');
});

test('settings search registry finds Default Workout View by focus/list keywords', () => {
  const focusHits = filterSettingsItems('focus');
  assert.ok(
    focusHits.some(
      (i) =>
        i.id === 'training-default-workout-view' &&
        i.href === '/settings/training#workout-view',
    ),
  );
  const viewHits = filterSettingsItems('workout view');
  assert.ok(viewHits.some((i) => i.id === 'training-default-workout-view'));
});

test('defaultWorkoutView persists in DB, additive migration, PATCH /api/settings, dayView, exportData, MCP get_profile, and Focus/List saves produce identical DB sessions', async () => {
  const memDb = newDb();
  const pg = memDb.adapters.createPg();
  const pool = new pg.Pool();

  try {
    // Legacy users table without default_workout_view before initSchema
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
      ['usr_leg9', 'legacy_p9', 'Legacy P9', 'hash', now],
    );

    setTestPool(pool);
    await pingDb();

    // Legacy user defaults to 'list'
    const legacyUser = await getUserById('usr_leg9');
    assert.equal(legacyUser?.defaultWorkoutView, 'list');

    // New user defaults to 'list'
    const user = await createUser({
      id: 'usr_p9',
      username: 'focus_tester',
      displayName: 'Focus Tester',
      passwordHash: 'hash',
    });
    assert.equal(user.defaultWorkoutView, 'list');

    const rawToken = `tok_${crypto.randomBytes(8).toString('hex')}`;
    await createAuthSession(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + 3600_000).toISOString(),
    );

    // PATCH /api/settings updates defaultWorkoutView -> 'focus'
    const patchReq = new NextRequest('http://localhost/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
      },
      body: JSON.stringify({ defaultWorkoutView: 'focus' }),
    });
    const patchRes = await settingsPatchRoute(patchReq, {
      params: Promise.resolve({}),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as {
      user: { defaultWorkoutView: string };
    };
    assert.equal(patchJson.user.defaultWorkoutView, 'focus');

    // Invalid defaultWorkoutView -> 400
    const badReq = new NextRequest('http://localhost/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
      },
      body: JSON.stringify({ defaultWorkoutView: 'cards' }),
    });
    const badRes = await settingsPatchRoute(badReq, {
      params: Promise.resolve({}),
    });
    assert.equal(badRes.status, 400);

    const updatedUser = await getUserById(user.id);
    assert.equal(updatedUser?.defaultWorkoutView, 'focus');

    // Day view exposes defaultWorkoutView
    const dayView = await getWorkoutDayView(user.id, '2026-11-16', '2026-11-16');
    assert.equal(dayView.user.defaultWorkoutView, 'focus');

    // Export JSON exposes defaultWorkoutView
    const exported = await buildUserExportJson(updatedUser!);
    assert.equal(exported.user.defaultWorkoutView, 'focus');

    // MCP get_profile exposes defaultWorkoutView
    const mcpRes = await handleMcpJsonRpcRequest(updatedUser!, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_profile', arguments: {} },
    });
    const mcpResult = mcpRes?.result as
      | { structuredContent?: { profile?: { defaultWorkoutView?: string } } }
      | undefined;
    assert.equal(mcpResult?.structuredContent?.profile?.defaultWorkoutView, 'focus');

    // Saving identical draft exercises from Focus vs List produces identical saved sets & rest data
    const draftExercises: LoggerExercise[] = [
      makeLoggerExercise({
        localId: 'ex_bench',
        exerciseId: 'barbell-bench-press',
        exerciseName: 'Barbell Bench Press',
        defaultRestSeconds: 120,
        sets: [
          {
            localId: 's1',
            setNumber: 1,
            weightDisplay: '80',
            reps: '8',
            timeSeconds: '',
            distanceM: '',
            restSeconds: 120,
            executionQualityPct: null,
            repQualities: [],
            isCompleted: true,
            completedAt: '2026-11-16T10:00:00.000Z',
            restEndedAt: '2026-11-16T10:02:00.000Z',
            completionSeq: 1,
          },
          {
            localId: 's2',
            setNumber: 2,
            weightDisplay: '80',
            reps: '8',
            timeSeconds: '',
            distanceM: '',
            restSeconds: 120,
            executionQualityPct: null,
            repQualities: [],
            isCompleted: true,
            completedAt: '2026-11-16T10:02:45.000Z',
            restEndedAt: null,
            completionSeq: 2,
          },
        ],
      }),
    ];

    const buildSaveExercises = (exercises: LoggerExercise[]) => {
      const restMatrix = computeActualRestForWorkoutSets(exercises);
      return exercises.map((ex, exIdx) => ({
        exerciseId: ex.exerciseId,
        orderIndex: exIdx,
        notes: ex.notes.trim(),
        sets: ex.sets
          .filter((s) => s.isCompleted)
          .map((s, sIdx) => ({
            setNumber: sIdx + 1,
            weightKg: displayToKg(parseOptionalNum(s.weightDisplay), 'kg'),
            reps: parseOptionalInt(s.reps),
            timeSeconds: parseOptionalInt(s.timeSeconds),
            distanceM: parseOptionalNum(s.distanceM),
            restSeconds: s.restSeconds ?? ex.defaultRestSeconds,
            actualRestSeconds: restMatrix[exIdx]?.[sIdx]?.actualRestSeconds ?? null,
            restApproximate: restMatrix[exIdx]?.[sIdx]?.restApproximate ?? false,
            executionQualityPct: null,
            isCompleted: true,
            repQualities: [],
          })),
      }));
    };

    const savedFocus = await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-15',
      title: 'Push (Focus)',
      startedAt: '2026-11-15T10:00:00.000Z',
      completedAt: '2026-11-15T10:30:00.000Z',
      durationMinutes: 30,
      exercises: buildSaveExercises(draftExercises),
    });

    const savedList = await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-16',
      title: 'Push (List)',
      startedAt: '2026-11-16T10:00:00.000Z',
      completedAt: '2026-11-16T10:30:00.000Z',
      durationMinutes: 30,
      exercises: buildSaveExercises(draftExercises),
    });

    const normalizeSets = (s: typeof savedFocus.session) =>
      s.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        sets: ex.sets.map((row) => ({
          setNumber: row.setNumber,
          weightKg: row.weightKg,
          reps: row.reps,
          restSeconds: row.restSeconds,
          actualRestSeconds: row.actualRestSeconds,
          restApproximate: row.restApproximate,
        })),
      }));

    assert.deepEqual(
      normalizeSets(savedFocus.session),
      normalizeSets(savedList.session),
    );
    assert.equal(savedFocus.session.exercises[0].sets[0].actualRestSeconds, 120);
    assert.equal(savedFocus.session.exercises[0].sets[0].restApproximate, false);
    assert.equal(savedFocus.session.exercises[0].sets[1].actualRestSeconds, null);
  } finally {
    await closeDb();
    setTestPool(null);
  }
});
