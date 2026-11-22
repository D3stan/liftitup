import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const { closeDb, queryOne, setTestPool } = await import('@/lib/db/connection');
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

test('workouts query lifecycle: day view, transactional save, cid idempotency, edit, delete, swap, isolation', async () => {
  const { newDb } = await import('pg-mem');
  const pg = newDb().adapters.createPg();
  setTestPool(new pg.Pool());

  try {
    const guest = await createGuestSandbox('UTC');
    const today = localDateForTimezone('UTC');
    const otherUser = await createUser({
      username: 'other_lifter',
      displayName: 'Other',
      passwordHash: 'hash',
      timezone: 'UTC',
    });

    const schedRow = await queryOne<{ rotation_anchor_date: string }>(
      'SELECT rotation_anchor_date FROM schedules WHERE user_id = $1',
      [guest.id],
    );
    assert.ok(schedRow?.rotation_anchor_date);

    const initialView = await getWorkoutDayView(guest.id, today, today);
    assert.equal(initialView.date, today);
    assert.equal(initialView.user.enableSetQuality, false);

    // Save a session on today with notes, set quality, rep qualities, and cid
    const cid = 'test-cid-123';
    const { session, created } = await saveWorkoutSession(guest.id, {
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
    const dup = await saveWorkoutSession(guest.id, {
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
      const view = await getWorkoutDayView(guest.id, candidate, today);
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
    await assert.rejects(
      () => updateWorkoutSession(otherUser.id, session.id, { title: 'Hacked' }),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );
    await assert.rejects(
      () => deleteWorkoutSession(otherUser.id, session.id),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );

    // Validation error on invalid exerciseId -> 400 ApiError
    await assert.rejects(
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
    const updated = await updateWorkoutSession(guest.id, session.id, {
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
    const firstSlot = await queryOne<{ id: string; exercise_id: string }>(
      `
        SELECT sde.id, sde.exercise_id
        FROM schedule_day_exercises sde
        JOIN schedule_days sd ON sd.id = sde.schedule_day_id
        JOIN schedules s ON s.id = sd.schedule_id
        WHERE s.user_id = $1
        ORDER BY sd.position ASC, sde.order_index ASC
        LIMIT 1
      `,
      [guest.id],
    );
    assert.ok(firstSlot);

    const futureDate = addDaysYmd(today, 5);
    const swapSessionRes = await applyExerciseSwap(guest.id, {
      dateKey: futureDate,
      scheduleDayExerciseId: firstSlot.id,
      toExerciseId: 'flat-dumbbell-bench-press',
      scope: 'session',
    });
    assert.equal(swapSessionRes.toExercise.id, 'flat-dumbbell-bench-press');

    const swapSchedRes = await applyExerciseSwap(guest.id, {
      dateKey: futureDate,
      scheduleDayExerciseId: firstSlot.id,
      toExerciseId: 'incline-barbell-bench-press',
      scope: 'schedule',
    });
    assert.equal(swapSchedRes.toExercise.id, 'incline-barbell-bench-press');

    // Delete session
    await deleteWorkoutSession(guest.id, session.id);
    await assert.rejects(
      () => updateWorkoutSession(guest.id, session.id, { title: 'Gone' }),
      (err: unknown) => err instanceof ApiError && err.status === 404,
    );

    // Concurrent duplicate cid race resolves idempotently without PG 23505 failure
    const raceCid = 'race-cid-concurrent-1';
    const racePayload = {
      sessionDate: today,
      title: 'Concurrent Push',
      isJolly: true,
      jollyMode: 'extra' as const,
      cid: raceCid,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [{ setNumber: 1, weightKg: 80, reps: 8, isCompleted: true }],
        },
      ],
    };
    const raceResults = await Promise.all([
      saveWorkoutSession(guest.id, racePayload),
      saveWorkoutSession(guest.id, racePayload),
      saveWorkoutSession(guest.id, racePayload),
    ]);
    const createdFlags = raceResults.map((r) => r.created).sort();
    assert.deepEqual(createdFlags, [false, false, true]);
    const uniqueRaceIds = new Set(raceResults.map((r) => r.session.id));
    assert.equal(uniqueRaceIds.size, 1);
    const raceRowCount = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM workout_sessions WHERE user_id = $1 AND cid = $2',
      [guest.id, raceCid],
    );
    assert.equal(Number(raceRowCount?.cnt), 1);
  } finally {
    await closeDb();
  }
});
