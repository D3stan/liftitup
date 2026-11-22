import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const {
  DRAFT_PREFIX,
  WORKOUT_DRAFTS_CHANGED_EVENT,
  clearAllUserDrafts,
  clearUserWorkoutDraft,
  saveUserWorkoutDraft,
} = await import('@/lib/offline/outbox');

const {
  areActiveWorkoutsEqual,
  buildActiveWorkoutHref,
  findActiveUserWorkout,
  formatActiveWorkoutSubtitle,
  isDraftInProgress,
  isPathnameOnActiveWorkout,
  parseUserDraftStorageKey,
} = await import('@/lib/workouts/activeDraft');

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setRaw(key: string, raw: string) {
      map.set(key, raw);
    },
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    cid: 'cid_1',
    title: 'Push Day',
    notes: '',
    isJolly: false,
    jollyMode: null,
    startedAt: null,
    restClock: null,
    updatedAt: '2026-11-22T10:00:00.000Z',
    exercises: [
      {
        localId: 'ex_1',
        exerciseId: 'bench',
        exerciseName: 'Bench Press',
        sets: [
          { localId: 's_w1', isWarmup: true, isCompleted: false },
          { localId: 's_1', isWarmup: false, isCompleted: false },
          { localId: 's_2', isWarmup: false, isCompleted: false },
        ],
      },
    ],
    ...overrides,
  };
}

test('parseUserDraftStorageKey parses new planned/jolly keys and edit keys while rejecting invalid ones', () => {
  assert.deepEqual(
    parseUserDraftStorageKey(
      `${DRAFT_PREFIX}user:usr_1:new:2026-11-22:planned`,
      'usr_1',
    ),
    {
      kind: 'new',
      baseDraftKey: 'new:2026-11-22:planned',
      date: '2026-11-22',
      mode: 'planned',
    },
  );

  assert.deepEqual(
    parseUserDraftStorageKey(
      `${DRAFT_PREFIX}user:usr_1:new:2026-11-22:extra`,
      'usr_1',
    ),
    {
      kind: 'new',
      baseDraftKey: 'new:2026-11-22:extra',
      date: '2026-11-22',
      mode: 'extra',
    },
  );

  assert.deepEqual(
    parseUserDraftStorageKey(
      `${DRAFT_PREFIX}user:usr_1:edit:ses_123`,
      'usr_1',
    ),
    {
      kind: 'edit',
      baseDraftKey: 'edit:ses_123',
      sessionId: 'ses_123',
    },
  );

  // Wrong user, invalid calendar date, or legacy un-scoped key
  assert.equal(
    parseUserDraftStorageKey(
      `${DRAFT_PREFIX}user:usr_2:new:2026-11-22:planned`,
      'usr_1',
    ),
    null,
  );
  assert.equal(
    parseUserDraftStorageKey(
      `${DRAFT_PREFIX}user:usr_1:new:2026-02-30:planned`,
      'usr_1',
    ),
    null,
  );
  assert.equal(
    parseUserDraftStorageKey(`${DRAFT_PREFIX}new:2026-11-22:planned`, 'usr_1'),
    null,
  );
});

test('isDraftInProgress distinguishes untouched drafts from started/active workouts', () => {
  assert.equal(isDraftInProgress(null), false);
  assert.equal(isDraftInProgress(makeDraft()), false);
  assert.equal(isDraftInProgress(makeDraft({ startedAt: 'not-a-date' })), false);

  assert.equal(
    isDraftInProgress(makeDraft({ startedAt: '2026-11-22T10:05:00.000Z' })),
    true,
  );
  assert.equal(
    isDraftInProgress(
      makeDraft({
        restClock: {
          startedAt: '2026-11-22T10:05:00.000Z',
          targetSeconds: 90,
          mode: 'countdown',
          label: 'Bench Press',
          exerciseLocalId: 'ex_1',
          setLocalId: 's_1',
          stoppedAt: null,
          isActive: true,
          alertFired: false,
        },
      }),
    ),
    true,
  );
  assert.equal(
    isDraftInProgress(
      makeDraft({
        exercises: [
          {
            localId: 'ex_1',
            sets: [{ localId: 's_1', isWarmup: false, isCompleted: true }],
          },
        ],
      }),
    ),
    true,
  );
});

test('findActiveUserWorkout ignores untouched and edit drafts, isolates users, and returns most recent active workout', () => {
  const storage = createMemoryStorage();

  // Untouched draft -> ignored
  saveUserWorkoutDraft('usr_1', 'new:2026-11-22:planned', makeDraft(), storage);
  // Edit draft of an already-saved historical workout -> ignored
  saveUserWorkoutDraft(
    'usr_1',
    'edit:ses_old',
    makeDraft({
      title: 'Old Session',
      startedAt: '2026-11-01T10:00:00.000Z',
      exercises: [
        {
          localId: 'ex_old',
          sets: [{ localId: 's_old', isWarmup: false, isCompleted: true }],
        },
      ],
    }),
    storage,
  );
  // Malformed JSON -> safely ignored
  storage.setRaw(
    `${DRAFT_PREFIX}user:usr_1:new:2026-11-21:planned`,
    '{broken-json',
  );
  // Another user's active draft -> isolated
  saveUserWorkoutDraft(
    'usr_2',
    'new:2026-11-22:planned',
    makeDraft({ title: 'Bob Legs', startedAt: '2026-11-22T11:00:00.000Z' }),
    storage,
  );

  assert.equal(findActiveUserWorkout('usr_1', storage), null);

  // Start workout on 2026-11-21
  saveUserWorkoutDraft(
    'usr_1',
    'new:2026-11-21:planned',
    makeDraft({
      title: 'Pull Day',
      startedAt: '2026-11-21T18:00:00.000Z',
      updatedAt: '2026-11-21T18:15:00.000Z',
    }),
    storage,
  );

  // Start newer jolly workout on 2026-11-22
  saveUserWorkoutDraft(
    'usr_1',
    'new:2026-11-22:extra',
    makeDraft({
      title: 'Arms Pump',
      isJolly: true,
      jollyMode: 'extra',
      startedAt: '2026-11-22T12:00:00.000Z',
      updatedAt: '2026-11-22T12:10:00.000Z',
      exercises: [
        {
          localId: 'ex_1',
          sets: [
            { localId: 'w1', isWarmup: true, isCompleted: true },
            { localId: 's1', isWarmup: false, isCompleted: true },
            { localId: 's2', isWarmup: false, isCompleted: false },
          ],
        },
      ],
    }),
    storage,
  );

  const active = findActiveUserWorkout('usr_1', storage);
  assert.ok(active);
  assert.equal(active.draftKey, 'new:2026-11-22:extra');
  assert.equal(active.date, '2026-11-22');
  assert.equal(active.mode, 'extra');
  assert.equal(active.href, '/workout/2026-11-22/log?jolly=extra');
  assert.equal(active.title, 'Arms Pump');
  assert.equal(active.completedWorkingSets, 1);
  assert.equal(active.totalWorkingSets, 2);
  assert.equal(active.completedWarmupSets, 1);

  // Clearing the active draft falls back or clears cleanly
  clearUserWorkoutDraft('usr_1', 'new:2026-11-22:extra', storage);
  const nextActive = findActiveUserWorkout('usr_1', storage);
  assert.equal(nextActive?.date, '2026-11-21');
  assert.equal(nextActive?.href, '/workout/2026-11-21/log');

  clearAllUserDrafts('usr_1', storage);
  assert.equal(findActiveUserWorkout('usr_1', storage), null);
  assert.equal(findActiveUserWorkout('usr_2', storage)?.title, 'Bob Legs');
});

test('isPathnameOnActiveWorkout accurately distinguishes active logger from other routes and edit mode', () => {
  const planned = { date: '2026-11-22', mode: 'planned' as const };
  const jollyExtra = { date: '2026-11-22', mode: 'extra' as const };

  const makeParams = (entries: Record<string, string>) => ({
    get: (name: string) => entries[name] ?? null,
  });

  assert.equal(
    isPathnameOnActiveWorkout(planned, '/workout/2026-11-22/log', makeParams({})),
    true,
  );
  assert.equal(
    isPathnameOnActiveWorkout(planned, '/workout/2026-11-22/log/', makeParams({})),
    true,
  );
  // Day summary page, home, exercises, other date, edit mode, or mismatched jolly mode -> false
  assert.equal(
    isPathnameOnActiveWorkout(planned, '/workout/2026-11-22', makeParams({})),
    false,
  );
  assert.equal(
    isPathnameOnActiveWorkout(planned, '/exercises', makeParams({})),
    false,
  );
  assert.equal(
    isPathnameOnActiveWorkout(planned, '/', makeParams({})),
    false,
  );
  assert.equal(
    isPathnameOnActiveWorkout(
      planned,
      '/workout/2026-11-23/log',
      makeParams({}),
    ),
    false,
  );
  assert.equal(
    isPathnameOnActiveWorkout(
      planned,
      '/workout/2026-11-22/log',
      makeParams({ sessionId: 'ses_1' }),
    ),
    false,
  );
  assert.equal(
    isPathnameOnActiveWorkout(
      planned,
      '/workout/2026-11-22/log',
      makeParams({ jolly: 'extra' }),
    ),
    false,
  );

  assert.equal(
    isPathnameOnActiveWorkout(
      jollyExtra,
      '/workout/2026-11-22/log',
      makeParams({ jolly: 'extra' }),
    ),
    true,
  );
  assert.equal(
    isPathnameOnActiveWorkout(
      jollyExtra,
      '/workout/2026-11-22/log',
      makeParams({}),
    ),
    false,
  );
});

test('formatActiveWorkoutSubtitle, buildActiveWorkoutHref, and areActiveWorkoutsEqual work cleanly', () => {
  assert.equal(
    buildActiveWorkoutHref('2026-11-22', 'planned'),
    '/workout/2026-11-22/log',
  );
  assert.equal(
    buildActiveWorkoutHref('2026-11-22', 'instead'),
    '/workout/2026-11-22/log?jolly=instead',
  );

  const startMs = Date.parse('2026-11-22T10:00:00.000Z');
  const active = {
    draftKey: 'new:2026-11-22:planned',
    date: '2026-11-22',
    mode: 'planned' as const,
    href: '/workout/2026-11-22/log',
    title: 'Push Day',
    startedAt: '2026-11-22T09:50:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    completedWorkingSets: 2,
    totalWorkingSets: 8,
    completedWarmupSets: 0,
    restClock: {
      startedAt: '2026-11-22T10:00:00.000Z',
      targetSeconds: 90,
      mode: 'countdown' as const,
      label: 'Bench',
      exerciseLocalId: 'ex_1',
      setLocalId: 's_2',
      stoppedAt: null,
      isActive: true,
      alertFired: false,
    },
  };

  assert.equal(
    formatActiveWorkoutSubtitle(active, '2026-11-22', startMs + 30_000),
    'Rest 01:00 · 2/8 sets',
  );

  const diffDaySubtitle = formatActiveWorkoutSubtitle(
    { ...active, restClock: null },
    '2026-11-23',
    startMs + 30_000,
  );
  assert.ok(diffDaySubtitle.includes('2/8 sets'));
  assert.ok(diffDaySubtitle.includes('22'));

  assert.equal(areActiveWorkoutsEqual(active, { ...active }), true);
  assert.equal(
    areActiveWorkoutsEqual(active, { ...active, completedWorkingSets: 3 }),
    false,
  );
});

test('outbox mutations dispatch WORKOUT_DRAFTS_CHANGED_EVENT when using window.localStorage', () => {
  const storage = createMemoryStorage();
  const events: string[] = [];
  const prevWindow = (globalThis as { window?: unknown }).window;

  try {
    (globalThis as { window?: unknown }).window = {
      localStorage: storage,
      dispatchEvent(ev: { type: string }) {
        events.push(ev.type);
        return true;
      },
    };

    saveUserWorkoutDraft('usr_evt', 'new:2026-11-22:planned', makeDraft());
    clearUserWorkoutDraft('usr_evt', 'new:2026-11-22:planned');
    saveUserWorkoutDraft('usr_evt', 'new:2026-11-22:planned', makeDraft());
    clearAllUserDrafts('usr_evt');

    assert.deepEqual(events, [
      WORKOUT_DRAFTS_CHANGED_EVENT,
      WORKOUT_DRAFTS_CHANGED_EVENT,
      WORKOUT_DRAFTS_CHANGED_EVENT,
      WORKOUT_DRAFTS_CHANGED_EVENT,
    ]);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = prevWindow;
    }
  }
});
