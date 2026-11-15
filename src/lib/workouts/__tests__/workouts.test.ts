import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// Register @/* -> src/* resolution so Node 26 runs TS modules directly without a bundler.
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
      const parentDir = path.dirname(new URL(context.parentURL).pathname);
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
          return nextResolve(new URL(`file://${candidate}`).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { closeDb, getDb } = await import('@/lib/db/connection');
const { createGuestSandbox } = await import('@/lib/auth/sandbox');
const { createUser, localDateForTimezone } = await import('@/lib/db/users');
const {
  addDaysYmd,
  applyExerciseSwap,
  deleteWorkoutSession,
  getWorkoutDayView,
  saveWorkoutSession,
  updateWorkoutSession,
} = await import('@/lib/workouts/queries');
const { ApiError } = await import('@/lib/api/handler');

test('workouts query lifecycle: day view, transactional save, cid idempotency, edit, delete, swap, isolation', () => {
  process.env.DATABASE_PATH = ':memory:';
  closeDb();

  try {
    const guest = createGuestSandbox('UTC');
    const today = localDateForTimezone('UTC');
    const otherUser = createUser({
      username: 'other_lifter',
      displayName: 'Other',
      passwordHash: 'hash',
      timezone: 'UTC',
    });

    const db = getDb();
    const schedRow = db
      .prepare('SELECT rotation_anchor_date FROM schedules WHERE user_id = ?')
      .get(guest.id) as { rotation_anchor_date: string };
    assert.ok(schedRow?.rotation_anchor_date);

    const initialView = getWorkoutDayView(guest.id, today, today);
    assert.equal(initialView.date, today);
    assert.equal(initialView.user.enableSetQuality, false);

    // Save a session on today with notes, set quality, rep qualities, and cid
    const cid = 'test-cid-123';
    const { session, created } = saveWorkoutSession(guest.id, {
      sessionDate: today,
      title: 'Push Custom',
      isJolly: true,
      jollyMode: 'extra',
      notes: 'Felt strong on top set',
      cid,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          notes: 'Paused 1s',
          sets: [
            {
              setNumber: 1,
              weightKg: 82.5,
              reps: 6,
              restSeconds: 150,
              executionQualityPct: 90,
              isCompleted: true,
              repQualities: [{ repIndex: 6, qualityPct: 70 }],
            },
          ],
        },
      ],
    });

    assert.equal(created, true);
    assert.equal(session.notes, 'Felt strong on top set');
    assert.equal(session.exercises[0].notes, 'Paused 1s');
    assert.equal(session.exercises[0].sets[0].executionQualityPct, 90);
    assert.deepEqual(
      session.exercises[0].sets[0].repQualities?.map((r) => ({
        repIndex: r.repIndex,
        qualityPct: r.qualityPct,
      })),
      [{ repIndex: 6, qualityPct: 70 }],
    );

    // Idempotent cid returns existing session without creating duplicate
    const dup = saveWorkoutSession(guest.id, {
      sessionDate: today,
      title: 'Push Custom',
      cid,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [{ setNumber: 1, weightKg: 100, reps: 1 }],
        },
      ],
    });
    assert.equal(dup.created, false);
    assert.equal(dup.session.id, session.id);

    // Find next planned Push day after today and verify prefill picks up 82.5 x 6
    let pushView = null;
    for (let offset = 1; offset <= 10; offset += 1) {
      const candidate = addDaysYmd(today, offset);
      const view = getWorkoutDayView(guest.id, candidate, today);
      if (
        view.calendarDay.plannedDay?.exercises.some(
          (e) => e.exerciseId === 'barbell-bench-press',
        )
      ) {
        pushView = view;
        break;
      }
    }
    assert.ok(pushView, 'Expected a planned Push day within 10 days');
    const benchPrefill = pushView.prefillByExerciseId['barbell-bench-press'];
    assert.ok(benchPrefill);
    assert.equal(benchPrefill.sets[0].weightKg, 82.5);
    assert.equal(benchPrefill.sets[0].reps, 6);

    // User isolation: otherUser cannot update or delete guest's session
    assert.throws(
      () => updateWorkoutSession(otherUser.id, session.id, { title: 'Hacked' }),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );
    assert.throws(
      () => deleteWorkoutSession(otherUser.id, session.id),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );

    // Validation error on invalid exerciseId -> 400 ApiError
    assert.throws(
      () =>
        saveWorkoutSession(guest.id, {
          sessionDate: today,
          title: 'Bad',
          exercises: [
            {
              exerciseId: 'non-existent-ex',
              sets: [{ weightKg: 50, reps: 5 }],
            },
          ],
        }),
      (err: unknown) => err instanceof ApiError && err.status === 400,
    );

    // Update session
    const updated = updateWorkoutSession(guest.id, session.id, {
      title: 'Push Edited',
      notes: 'Updated note',
      exercises: [
        {
          exerciseId: 'plank',
          orderIndex: 0,
          sets: [{ setNumber: 1, timeSeconds: 75, isCompleted: true }],
        },
      ],
    });
    assert.equal(updated.title, 'Push Edited');
    assert.equal(updated.exercises[0].exerciseId, 'plank');
    assert.equal(updated.exercises[0].sets[0].timeSeconds, 75);

    // Swap session scope & schedule scope
    const firstSlot = db
      .prepare(`
        SELECT sde.id, sde.exercise_id
        FROM schedule_day_exercises sde
        JOIN schedule_days sd ON sd.id = sde.schedule_day_id
        JOIN schedules s ON s.id = sd.schedule_id
        WHERE s.user_id = ?
        ORDER BY sd.position ASC, sde.order_index ASC
        LIMIT 1
      `)
      .get(guest.id) as { id: string; exercise_id: string };

    const futureDate = addDaysYmd(today, 5);
    const swapSessionRes = applyExerciseSwap(guest.id, {
      dateKey: futureDate,
      scheduleDayExerciseId: firstSlot.id,
      toExerciseId: 'flat-dumbbell-bench-press',
      scope: 'session',
    });
    assert.equal(swapSessionRes.toExercise.id, 'flat-dumbbell-bench-press');

    const swapSchedRes = applyExerciseSwap(guest.id, {
      dateKey: futureDate,
      scheduleDayExerciseId: firstSlot.id,
      toExerciseId: 'incline-barbell-bench-press',
      scope: 'schedule',
    });
    assert.equal(swapSchedRes.toExercise.id, 'incline-barbell-bench-press');

    // Delete session
    deleteWorkoutSession(guest.id, session.id);
    assert.throws(
      () => updateWorkoutSession(guest.id, session.id, { title: 'Gone' }),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );
  } finally {
    closeDb();
  }
});
