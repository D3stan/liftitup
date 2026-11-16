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
  computeActualRestForWorkoutSets,
  computeSessionRestSummary,
  formatRestSeconds,
  getLastTimeRestForCompletedSet,
  parseRestInput,
} = await import('@/lib/workouts/rest');
const { closeDb, pingDb, setTestPool } = await import('@/lib/db/connection');
const { initSchema } = await import('@/lib/db/schema');
const { createUser } = await import('@/lib/db/users');
const { createAuthSession } = await import('@/lib/db/sessions');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { getLastPerformanceByExerciseIds } = await import('@/lib/db/workouts');
const { saveWorkoutSession, updateWorkoutSession } = await import(
  '@/lib/workouts/queries'
);
const { PATCH: patchSessionRoute } = await import(
  '@/app/api/workouts/sessions/[id]/route'
);
const {
  buildUserExportCsv,
  buildUserExportJson,
  CSV_HEADERS,
} = await import('@/lib/export/exportData');
const { handleMcpJsonRpcRequest } = await import('@/lib/mcp/server');

test('computeActualRestForWorkoutSets handles explicit stop, fallback, exercise boundary, final set, check-all, re-tick, out-of-order, and 15-min cutoff', () => {
  const base = Date.parse('2026-11-16T10:00:00.000Z');
  const iso = (offsetSec: number) =>
    new Date(base + offsetSec * 1000).toISOString();

  // 1) Explicit stop, fallback, exercise boundary, final set, 900s kept, 901s cutoff
  const computed = computeActualRestForWorkoutSets([
    {
      sets: [
        // Set 0: explicit stop at +90s -> 90s exact
        {
          isCompleted: true,
          completedAt: iso(0),
          restEndedAt: iso(90),
          completionSeq: 1,
        },
        // Set 1: no explicit stop; next set (Ex 1 set 0) completed at +245s (125s after +120s) -> 125s approximate across exercise boundary
        {
          isCompleted: true,
          completedAt: iso(120),
          restEndedAt: null,
          completionSeq: 2,
        },
      ],
    },
    {
      sets: [
        // Set 0 of Ex 1: completed at +245s, next set completed at +1145s (exact 900s = 15 min) -> 900s approximate
        {
          isCompleted: true,
          completedAt: iso(245),
          restEndedAt: null,
          completionSeq: 3,
        },
        // Set 1 of Ex 1: completed at +1145s, next set completed at +2046s (901s > 900s cutoff) -> null
        {
          isCompleted: true,
          completedAt: iso(1145),
          restEndedAt: null,
          completionSeq: 4,
        },
        // Final set of workout: even if restEndedAt was set, final set has no rest
        {
          isCompleted: true,
          completedAt: iso(2046),
          restEndedAt: iso(2100),
          completionSeq: 5,
        },
      ],
    },
  ]);

  assert.deepEqual(computed[0][0], {
    actualRestSeconds: 90,
    restApproximate: false,
  });
  assert.deepEqual(computed[0][1], {
    actualRestSeconds: 125,
    restApproximate: true,
  });
  assert.deepEqual(computed[1][0], {
    actualRestSeconds: 900,
    restApproximate: true,
  });
  assert.deepEqual(computed[1][1], {
    actualRestSeconds: null,
    restApproximate: false,
  });
  assert.deepEqual(computed[1][2], {
    actualRestSeconds: null,
    restApproximate: false,
  });

  // Explicit stop > 900s also becomes null
  const explicitCutoff = computeActualRestForWorkoutSets([
    {
      sets: [
        {
          isCompleted: true,
          completedAt: iso(0),
          restEndedAt: iso(901),
          completionSeq: 1,
        },
        {
          isCompleted: true,
          completedAt: iso(950),
          restEndedAt: null,
          completionSeq: 2,
        },
      ],
    },
  ]);
  assert.deepEqual(explicitCutoff[0][0], {
    actualRestSeconds: null,
    restApproximate: false,
  });

  // 2) Check-all sets get no measured rest, and fallback into check-all gets no measured rest
  const checkAllRes = computeActualRestForWorkoutSets([
    {
      sets: [
        // Set 0 completed individually with no restEndedAt; Set 1 is check-all -> null
        {
          isCompleted: true,
          completedAt: iso(0),
          restEndedAt: null,
          completionSeq: 1,
        },
        {
          isCompleted: true,
          completedAt: null,
          restEndedAt: null,
          completedViaCheckAll: true,
          completionSeq: null,
        },
        {
          isCompleted: true,
          completedAt: null,
          restEndedAt: null,
          completedViaCheckAll: true,
          completionSeq: null,
        },
        {
          isCompleted: true,
          completedAt: iso(300),
          restEndedAt: null,
          completionSeq: 2,
        },
      ],
    },
  ]);
  assert.deepEqual(checkAllRes[0], [
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
  ]);

  // 3) Un-ticked and re-ticked sets get no measured rest, and re-ticking Set 0 does not break Set 1 -> Set 2
  const retickRes = computeActualRestForWorkoutSets([
    {
      sets: [
        {
          isCompleted: true,
          completedAt: iso(500),
          wasUnchecked: true,
          completionSeq: 4,
        },
        {
          isCompleted: true,
          completedAt: iso(100),
          restEndedAt: null,
          completionSeq: 2,
        },
        {
          isCompleted: true,
          completedAt: iso(210),
          restEndedAt: null,
          completionSeq: 3,
        },
      ],
    },
  ]);
  assert.deepEqual(retickRes[0][0], {
    actualRestSeconds: null,
    restApproximate: false,
  });
  assert.deepEqual(retickRes[0][1], {
    actualRestSeconds: 110,
    restApproximate: true,
  });
  assert.deepEqual(retickRes[0][2], {
    actualRestSeconds: null,
    restApproximate: false,
  });

  // 4) Out-of-order completed sets get no measured rest (detected via completionSeq and via timestamps)
  const outOfOrderSeq = computeActualRestForWorkoutSets([
    {
      sets: [
        {
          isCompleted: true,
          completedAt: iso(0),
          completionSeq: 1,
        },
        {
          isCompleted: true,
          completedAt: iso(200),
          completionSeq: 3,
        },
        {
          isCompleted: true,
          completedAt: iso(100),
          completionSeq: 2,
        },
      ],
    },
  ]);
  assert.deepEqual(outOfOrderSeq[0], [
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
  ]);

  const outOfOrderTimestamps = computeActualRestForWorkoutSets([
    {
      sets: [
        { isCompleted: true, completedAt: iso(150) },
        { isCompleted: true, completedAt: iso(50) },
      ],
    },
  ]);
  assert.deepEqual(outOfOrderTimestamps[0], [
    { actualRestSeconds: null, restApproximate: false },
    { actualRestSeconds: null, restApproximate: false },
  ]);

  // 5) Negative explicit interval returns null
  const negativeRes = computeActualRestForWorkoutSets([
    {
      sets: [
        {
          isCompleted: true,
          completedAt: iso(100),
          restEndedAt: iso(80),
          completionSeq: 1,
        },
        {
          isCompleted: true,
          completedAt: iso(200),
          completionSeq: 2,
        },
      ],
    },
  ]);
  assert.deepEqual(negativeRes[0][0], {
    actualRestSeconds: null,
    restApproximate: false,
  });
});

test('computeSessionRestSummary, formatRestSeconds, and parseRestInput handle full vs partial sessions', () => {
  assert.equal(formatRestSeconds(130, false), '2:10');
  assert.equal(formatRestSeconds(105, true), '~1:45');
  assert.equal(formatRestSeconds(null, true), '');
  assert.equal(parseRestInput('1:45'), 105);
  assert.equal(parseRestInput('90'), 90);
  assert.equal(parseRestInput(''), null);

  // Full session: 3 completed sets -> 2 non-final rests both measured -> working time split available
  const fullSummary = computeSessionRestSummary({
    durationMinutes: 10, // 600s
    exercises: [
      {
        sets: [
          { isCompleted: true, actualRestSeconds: 90, restApproximate: false },
          { isCompleted: true, actualRestSeconds: 110, restApproximate: true },
        ],
      },
      {
        sets: [
          { isCompleted: true, actualRestSeconds: null, restApproximate: false },
        ],
      },
    ],
  });
  assert.equal(fullSummary.nonFinalSetCount, 2);
  assert.equal(fullSummary.measuredNonFinalCount, 2);
  assert.equal(fullSummary.allRestsMeasured, true);
  assert.equal(fullSummary.hasUnmeasuredRests, false);
  assert.equal(fullSummary.hasAnyApproximate, true);
  assert.equal(fullSummary.totalRestSeconds, 200);
  assert.equal(fullSummary.averageRestSeconds, 100);
  assert.equal(fullSummary.workingTimeSeconds, 400);

  // Partial session: one non-final set has actualRestSeconds = null -> no working-time split
  const partialSummary = computeSessionRestSummary({
    durationMinutes: 10,
    exercises: [
      {
        sets: [
          { isCompleted: true, actualRestSeconds: 90, restApproximate: false },
          { isCompleted: true, actualRestSeconds: null, restApproximate: false },
        ],
      },
      {
        sets: [
          { isCompleted: true, actualRestSeconds: null, restApproximate: false },
        ],
      },
    ],
  });
  assert.equal(partialSummary.nonFinalSetCount, 2);
  assert.equal(partialSummary.measuredNonFinalCount, 1);
  assert.equal(partialSummary.allRestsMeasured, false);
  assert.equal(partialSummary.hasUnmeasuredRests, true);
  assert.equal(partialSummary.totalRestSeconds, 90);
  assert.equal(partialSummary.averageRestSeconds, 90);
  assert.equal(partialSummary.workingTimeSeconds, null);
});

test('Phase 3 DB persistence, additive migration, edit round-trip, last-time positional matching, export, and MCP', async () => {
  const memDb = newDb();
  const pg = memDb.adapters.createPg();
  const pool = new pg.Pool();
  setTestPool(pool);

  try {
    // 1) Additive migration check: start from workout_sets table missing actual_rest_seconds and rest_approximate
    await pingDb();
    await pool.query('ALTER TABLE workout_sets DROP COLUMN rest_approximate');
    await pool.query('ALTER TABLE workout_sets DROP COLUMN actual_rest_seconds');
    await initSchema(pool);

    const user = await createUser({
      username: 'phase3_lifter',
      displayName: 'Phase 3 Lifter',
      passwordHash: 'hash',
      timezone: 'UTC',
    });

    const token = 'phase3-session-token';
    await createAuthSession(
      user.id,
      hashToken(token),
      new Date(Date.now() + 3600_000).toISOString(),
    );

    // 2) Save older completed session (2026-11-10) where Set 1 & Set 2 had rest
    await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-10',
      title: 'Push Older',
      startedAt: '2026-11-10T10:00:00.000Z',
      completedAt: '2026-11-10T10:40:00.000Z',
      durationMinutes: 40,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          sets: [
            {
              setNumber: 1,
              weightKg: 80,
              reps: 8,
              restSeconds: 120,
              actualRestSeconds: 115,
              restApproximate: false,
            },
            {
              setNumber: 2,
              weightKg: 80,
              reps: 8,
              restSeconds: 120,
              actualRestSeconds: 140,
              restApproximate: false,
            },
          ],
        },
      ],
    });

    // 3) Save most recent completed session (2026-11-14) where Set 1 had ~130s and Set 2 had null (no rest measured)
    const { session: saved } = await saveWorkoutSession(user.id, {
      sessionDate: '2026-11-14',
      title: 'Push Recent',
      startedAt: '2026-11-14T11:00:00.000Z',
      completedAt: '2026-11-14T11:45:00.000Z',
      durationMinutes: 45,
      notes: 'Initial note',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          orderIndex: 0,
          notes: 'Paused reps',
          sets: [
            {
              setNumber: 1,
              weightKg: 85,
              reps: 6,
              restSeconds: 120,
              actualRestSeconds: 130,
              restApproximate: true,
              executionQualityPct: 90,
              repQualities: [{ repIndex: 6, qualityPct: 75 }],
            },
            {
              setNumber: 2,
              weightKg: 85,
              reps: 6,
              restSeconds: 120,
              actualRestSeconds: null,
              restApproximate: false,
            },
          ],
        },
      ],
    });

    assert.equal(saved.exercises[0].sets[0].actualRestSeconds, 130);
    assert.equal(saved.exercises[0].sets[0].restApproximate, true);
    assert.equal(saved.exercises[0].sets[1].actualRestSeconds, null);
    assert.equal(saved.exercises[0].sets[1].restApproximate, false);

    // 4) "last time" positional matching: matches 2026-11-14, returns ~130s for pos 0 and null for pos 1 (does NOT fall back to 2026-11-10's 140s!)
    const prefillMap = await getLastPerformanceByExerciseIds(
      user.id,
      ['barbell-bench-press'],
      '2026-11-15',
    );
    const benchPrefill = prefillMap['barbell-bench-press'];
    assert.ok(benchPrefill);
    assert.equal(benchPrefill.lastSessionDate, '2026-11-14');
    assert.deepEqual(getLastTimeRestForCompletedSet(benchPrefill, 0), {
      actualRestSeconds: 130,
      restApproximate: true,
    });
    assert.equal(getLastTimeRestForCompletedSet(benchPrefill, 1), null);
    assert.equal(getLastTimeRestForCompletedSet(benchPrefill, 2), null);

    // 5) Edit ONLY a note via updateWorkoutSession -> preserves actualRestSeconds, restApproximate, startedAt, durationMinutes, quality
    const noteOnlyUpdate = await updateWorkoutSession(user.id, saved.id, {
      notes: 'Fixed typo in note',
      exercises: saved.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        orderIndex: ex.orderIndex,
        notes: ex.notes,
        sets: ex.sets.map((s) => ({
          setNumber: s.setNumber,
          weightKg: s.weightKg,
          reps: s.reps,
          timeSeconds: s.timeSeconds,
          distanceM: s.distanceM,
          restSeconds: s.restSeconds,
          actualRestSeconds: s.actualRestSeconds,
          restApproximate: s.restApproximate,
          executionQualityPct: s.executionQualityPct,
          isCompleted: s.isCompleted,
          repQualities: s.repQualities?.map((rq) => ({
            repIndex: rq.repIndex,
            qualityPct: rq.qualityPct,
          })),
        })),
      })),
    });

    assert.equal(noteOnlyUpdate.notes, 'Fixed typo in note');
    assert.equal(noteOnlyUpdate.startedAt, '2026-11-14T11:00:00.000Z');
    assert.equal(noteOnlyUpdate.durationMinutes, 45);
    assert.equal(noteOnlyUpdate.exercises[0].sets[0].actualRestSeconds, 130);
    assert.equal(noteOnlyUpdate.exercises[0].sets[0].restApproximate, true);
    assert.equal(noteOnlyUpdate.exercises[0].sets[0].executionQualityPct, 90);
    assert.equal(
      noteOnlyUpdate.exercises[0].sets[0].repQualities?.[0]?.qualityPct,
      75,
    );

    // 6) Edit date, start time, duration, user-edited actual rest (exact -> restApproximate = false), and clearing actual rest (null) via PATCH route
    const patchReq = new NextRequest(
      `http://localhost/api/workouts/sessions/${saved.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
        body: JSON.stringify({
          sessionDate: '2026-11-13',
          startedAt: '2026-11-13T09:15:00.000Z',
          durationMinutes: 52,
          exercises: [
            {
              exerciseId: 'barbell-bench-press',
              orderIndex: 0,
              notes: 'Edited note',
              sets: [
                {
                  setNumber: 1,
                  weightKg: 85,
                  reps: 6,
                  restSeconds: 120,
                  actualRestSeconds: 95,
                  restApproximate: false,
                },
                {
                  setNumber: 2,
                  weightKg: 85,
                  reps: 6,
                  restSeconds: 120,
                  actualRestSeconds: null,
                  restApproximate: true, // must be forced to false when actualRestSeconds is null
                },
              ],
            },
          ],
        }),
      },
    );
    const patchRes = await patchSessionRoute(patchReq, {
      params: Promise.resolve({ id: saved.id }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as { session: typeof saved };
    assert.equal(patchJson.session.sessionDate, '2026-11-13');
    assert.equal(patchJson.session.startedAt, '2026-11-13T09:15:00.000Z');
    assert.equal(patchJson.session.durationMinutes, 52);
    assert.equal(patchJson.session.exercises[0].sets[0].actualRestSeconds, 95);
    assert.equal(patchJson.session.exercises[0].sets[0].restApproximate, false);
    assert.equal(patchJson.session.exercises[0].sets[1].actualRestSeconds, null);
    assert.equal(patchJson.session.exercises[0].sets[1].restApproximate, false);

    // 7) Export JSON + CSV include actualRestSeconds and restApproximate
    const exportedJson = await buildUserExportJson(user);
    const recentExported = exportedJson.sessions.find((s) => s.id === saved.id);
    assert.ok(recentExported);
    assert.equal(recentExported.exercises[0].sets[0].actualRestSeconds, 95);
    assert.equal(recentExported.exercises[0].sets[0].restApproximate, false);
    assert.equal(recentExported.exercises[0].sets[1].actualRestSeconds, null);

    assert.ok(CSV_HEADERS.includes('actual_rest_seconds'));
    assert.ok(CSV_HEADERS.includes('rest_approximate'));
    const csv = await buildUserExportCsv(user);
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    const actualIdx = headers.indexOf('actual_rest_seconds');
    const approxIdx = headers.indexOf('rest_approximate');
    assert.ok(actualIdx >= 0 && approxIdx >= 0);
    const editedRow = lines.find(
      (line) => line.startsWith(`${saved.id},`) && line.includes(',1,85,6,'),
    );
    assert.ok(editedRow);
    const cols = editedRow.split(',');
    assert.equal(cols[actualIdx], '95');
    assert.equal(cols[approxIdx], '0');

    // 8) MCP get_workout_history and log_workout_session include actualRestSeconds & restApproximate
    const mcpHist = await handleMcpJsonRpcRequest(user, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_workout_history',
        arguments: { from: '2026-11-13', to: '2026-11-13' },
      },
    });
    const histContent = (
      mcpHist?.result as {
        structuredContent: {
          sessions: Array<{
            exercises: Array<{
              sets: Array<{
                actualRestSeconds: number | null;
                restApproximate: boolean;
              }>;
            }>;
          }>;
        };
      }
    ).structuredContent;
    assert.equal(
      histContent.sessions[0].exercises[0].sets[0].actualRestSeconds,
      95,
    );
    assert.equal(
      histContent.sessions[0].exercises[0].sets[0].restApproximate,
      false,
    );

    const mcpLog = await handleMcpJsonRpcRequest(user, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'log_workout_session',
        arguments: {
          sessionDate: '2026-11-15',
          title: 'MCP Session',
          exercises: [
            {
              exerciseId: 'barbell-bench-press',
              sets: [
                {
                  weightKg: 90,
                  reps: 5,
                  restSeconds: 120,
                  actualRestSeconds: 105,
                  restApproximate: true,
                },
                {
                  weightKg: 90,
                  reps: 5,
                  restSeconds: 120,
                  actualRestSeconds: 950, // > 900s cutoff -> stored as null
                  restApproximate: true,
                },
              ],
            },
          ],
        },
      },
    });
    const loggedMcp = (
      mcpLog?.result as {
        structuredContent: {
          session: {
            id: string;
            exercises: Array<{
              sets: Array<{
                actualRestSeconds: number | null;
                restApproximate: boolean;
              }>;
            }>;
          };
        };
      }
    ).structuredContent.session;
    assert.equal(loggedMcp.exercises[0].sets[0].actualRestSeconds, 105);
    assert.equal(loggedMcp.exercises[0].sets[0].restApproximate, true);
    assert.equal(loggedMcp.exercises[0].sets[1].actualRestSeconds, null);
    assert.equal(loggedMcp.exercises[0].sets[1].restApproximate, false);
    assert.ok(crypto.randomUUID());
  } finally {
    await closeDb();
  }
});
