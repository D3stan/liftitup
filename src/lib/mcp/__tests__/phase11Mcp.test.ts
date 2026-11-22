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
      !specifier.endsWith('.tsx') &&
      !specifier.endsWith('.mjs')
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
const { initSchema } = await import('@/lib/db/schema');
const { createUser, getUserById } = await import('@/lib/db/users');
const { recordBodyMetric } = await import('@/lib/db/bodyMetrics');
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { createProgressPhoto, countUserPhotos } = await import(
  '@/lib/db/photos'
);
const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
const { generateApiKey, hashToken } = await import('@/lib/auth/session');
const {
  listAuditLog,
  recordEvent,
  recordRequestMetric,
  resetActivityThrottleForTests,
  resetMetricsBufferForTests,
  resetSnapshotThrottleForTests,
  setUserDisabledState,
} = await import('@/lib/admin');
const { recordAppleHealthIngestOutcome, sanitizeErrorMessage } = await import(
  '@/lib/admin/metrics'
);
const { resetRateLimitForTests } = await import('@/lib/api/rateLimit');
const { logger, redactSensitiveText } = await import('@/lib/logger');
const { getMcpClientConfigSnippet, getMcpTokenEndpointUrl } = await import(
  '@/lib/mcp/config'
);
const { ingestAppleHealthPayload } = await import(
  '@/lib/integrations/appleHealth'
);
const { createSignedPhotoToken, resetPhotoLinkRateLimitForTests } = await import(
  '@/lib/mcp/photoLinks'
);
const { ORIGINAL_USER_TOOL_NAMES } = await import('@/lib/mcp/userTools');
const { POST: mcpPost } = await import('@/app/api/mcp/route');
const { GET: signedPhotoGet } = await import(
  '@/app/api/photos/signed/[token]/route'
);

function createMemPool(): Pool {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();

  const wrapClient = (client: PoolClient) =>
    ({
      async query(sql: string, params?: unknown[]) {
        const trimmed = sql.trim();
        if (
          trimmed === 'BEGIN' ||
          trimmed === 'COMMIT' ||
          trimmed === 'ROLLBACK'
        ) {
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
    constructor: innerPool.constructor,
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

async function setupMemDb() {
  const pool = createMemPool();
  setTestPool(pool);
  await initSchema(pool);
  resetActivityThrottleForTests();
  resetMetricsBufferForTests();
  resetSnapshotThrottleForTests();
  resetPhotoLinkRateLimitForTests();
  resetRateLimitForTests();
  return pool;
}

async function issueUserWithKey(opts: {
  id?: string;
  username: string;
  isGuest?: boolean;
}) {
  const user = await createUser({
    id: opts.id,
    username: opts.username,
    displayName: opts.username,
    passwordHash: await hashPassword('password123'),
    unit: 'kg',
    timezone: 'UTC',
    isGuest: opts.isGuest ?? false,
  });
  const key = generateApiKey();
  const keyInfo = await upsertApiKey(user.id, key.keyHash, key.keyPrefix);
  return { user, rawKey: key.rawKey, keyInfo };
}

async function callMcpHttp(
  rawKey: string,
  method: string,
  params: Record<string, unknown> = {},
  id: number | string = 1,
) {
  const req = new NextRequest('https://lift.example.test/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${rawKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const res = await mcpPost(req, { params: Promise.resolve({}) });
  const json = (await res.json()) as {
    jsonrpc: string;
    id: number | string | null;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  return { status: res.status, json };
}

async function callMcpTool(
  rawKey: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { status, json } = await callMcpHttp(rawKey, 'tools/call', {
    name,
    arguments: args,
  });
  return {
    httpStatus: status,
    rpcError: json.error ?? null,
    result: json.result as
      | {
          content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
          structuredContent?: Record<string, unknown>;
          isError: boolean;
        }
      | undefined,
  };
}

test('Phase 11 MCP: dynamic admin gate, guest restriction, disabled user gate, and tool annotations', async (t) => {
  await setupMemDb();
  const prevAdmins = process.env.ADMIN_USER_IDS;
  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdmins;
    await closeDb();
  });

  const admin = await issueUserWithKey({ id: 'usr_p11_admin', username: 'p11admin' });
  const member = await issueUserWithKey({ id: 'usr_p11_user', username: 'p11member' });
  const guest = await issueUserWithKey({
    id: 'usr_p11_guest',
    username: 'p11guest',
    isGuest: true,
  });

  // Even if guest ID is mistakenly in ADMIN_USER_IDS, guests can never be admin
  process.env.ADMIN_USER_IDS = `${admin.user.id},${guest.user.id}`;

  // 1. Admin tools/list includes Part A + Part B and all have full MCP annotations
  const adminListRes = await callMcpHttp(admin.rawKey, 'tools/list');
  assert.equal(adminListRes.status, 200);
  const adminTools = (adminListRes.json.result?.tools ?? []) as Array<{
    name: string;
    description: string;
    annotations?: Record<string, unknown>;
  }>;
  assert.ok(adminTools.some((tool) => tool.name === 'update_settings'));
  assert.ok(adminTools.some((tool) => tool.name === 'admin_get_overview'));
  assert.ok(adminTools.some((tool) => tool.name === 'admin_query_reporting_view'));

  for (const tool of adminTools) {
    assert.ok(tool.annotations, `Missing annotations on ${tool.name}`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
    assert.equal(typeof tool.annotations.idempotentHint, 'boolean');
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
  }

  // Spot check annotations & sensitive description warnings
  const byName = new Map(adminTools.map((x) => [x.name, x]));
  assert.equal(byName.get('get_profile')?.annotations?.readOnlyHint, true);
  assert.equal(byName.get('get_profile')?.annotations?.destructiveHint, false);
  assert.equal(byName.get('danger_zone')?.annotations?.destructiveHint, true);
  assert.equal(byName.get('danger_zone')?.annotations?.readOnlyHint, false);
  assert.equal(byName.get('admin_delete_user')?.annotations?.destructiveHint, true);
  assert.match(
    byName.get('browse_photo_thumbnails')?.description ?? '',
    /provider|context|conversation/i,
  );
  assert.match(
    byName.get('admin_reset_password')?.description ?? '',
    /reset-password\.mjs/i,
  );
  assert.match(
    byName.get('admin_reset_password')?.description ?? '',
    /conversation/i,
  );

  // 2. Non-admin registered user sees Part A only, zero admin tools
  const userListRes = await callMcpHttp(member.rawKey, 'tools/list');
  const memberTools = (userListRes.json.result?.tools ?? []) as Array<{ name: string }>;
  assert.ok(memberTools.some((x) => x.name === 'update_settings'));
  assert.ok(memberTools.some((x) => x.name === 'list_photos'));
  assert.equal(
    memberTools.some((x) => x.name.startsWith('admin_')),
    false,
  );

  // Calling any admin tool as non-admin returns -32601 Unknown tool
  for (const adminToolName of [
    'admin_get_overview',
    'admin_query_reporting_view',
    'admin_delete_user',
    'admin_run_maintenance',
  ]) {
    const res = await callMcpTool(member.rawKey, adminToolName, {});
    assert.equal(res.rpcError?.code, -32601);
  }

  // 3. Guest user ONLY sees original 9 tools and cannot call new Part A or Part B tools
  const guestListRes = await callMcpHttp(guest.rawKey, 'tools/list');
  const guestTools = (guestListRes.json.result?.tools ?? []) as Array<{ name: string }>;
  assert.deepEqual(
    new Set(guestTools.map((x) => x.name)),
    ORIGINAL_USER_TOOL_NAMES,
  );
  for (const blockedTool of [
    'update_settings',
    'list_photos',
    'danger_zone',
    'admin_get_overview',
  ]) {
    const res = await callMcpTool(guest.rawKey, blockedTool, {});
    assert.equal(res.rpcError?.code, -32601);
  }

  // 4. Dynamic ADMIN_USER_IDS revocation takes effect immediately
  process.env.ADMIN_USER_IDS = '';
  const afterRemovalList = await callMcpHttp(admin.rawKey, 'tools/list');
  const afterRemovalTools = (afterRemovalList.json.result?.tools ?? []) as Array<{
    name: string;
  }>;
  assert.equal(
    afterRemovalTools.some((x) => x.name.startsWith('admin_')),
    false,
  );
  const deniedAdminCall = await callMcpTool(admin.rawKey, 'admin_get_overview', {});
  assert.equal(deniedAdminCall.rpcError?.code, -32601);

  // 5. Disabled user cannot access /api/mcp (401)
  process.env.ADMIN_USER_IDS = admin.user.id;
  await setUserDisabledState({
    targetUserId: member.user.id,
    disabled: true,
    reason: 'test',
    actor: {
      actorUserId: admin.user.id,
      actorLabel: admin.user.username,
      source: 'admin_web',
    },
  });
  const disabledCall = await callMcpHttp(member.rawKey, 'tools/list');
  assert.equal(disabledCall.status, 401);
});

test('Phase 11 MCP Part A: settings, split/calendar, sessions (log/read/full edit/delete/bulk), rest+progress, steppers, body weights, Apple Health, and user isolation', async (t) => {
  await setupMemDb();
  t.after(async () => {
    await closeDb();
  });

  const userA = await issueUserWithKey({ id: 'usr_p11_a', username: 'alice_p11' });
  const userB = await issueUserWithKey({ id: 'usr_p11_b', username: 'bob_p11' });

  // 1. update_settings
  const updSettings = await callMcpTool(userA.rawKey, 'update_settings', {
    displayName: 'Alice Updated',
    unit: 'lb',
    timezone: 'America/New_York',
    theme: 'cutecore',
    themeVariant: 'dark',
    enableSetQuality: true,
    restClockMode: 'countdown',
    defaultWorkoutView: 'focus',
    defaultWeightStepKg: 1.25,
    appleFitnessEnabled: true,
  });
  assert.equal(updSettings.result?.isError, false);
  const prof = await callMcpTool(userA.rawKey, 'get_profile');
  const profData = prof.result?.structuredContent?.profile as Record<string, unknown>;
  assert.equal(profData.displayName, 'Alice Updated');
  assert.equal(profData.unit, 'lb');
  assert.equal(profData.theme, 'cutecore');
  assert.equal(profData.restClockMode, 'countdown');
  assert.equal(profData.defaultWorkoutView, 'focus');
  assert.equal(profData.defaultWeightStepKg, 1.25);

  // 2. manage_schedule: update_schedule, skip, postpone, jolly, swap, undo
  const setSched = await callMcpTool(userA.rawKey, 'manage_schedule', {
    action: 'update_schedule',
    name: 'Push Pull',
    days: [
      {
        label: 'Push',
        isRestDay: false,
        exercises: [
          {
            exerciseId: 'barbell-bench-press',
            targetSets: 3,
            targetReps: 8,
            restSeconds: 120,
          },
        ],
      },
      { label: 'Rest', isRestDay: true, exercises: [] },
    ],
  });
  assert.equal(setSched.result?.isError, false);
  const schedObj = setSched.result?.structuredContent?.schedule as {
    id: string;
    days: Array<{ id: string; exercises: Array<{ id: string }> }>;
  };
  assert.equal(schedObj.days.length, 2);
  const pushSlotId = schedObj.days[0]!.exercises[0]!.id;

  const swapRes = await callMcpTool(userA.rawKey, 'manage_schedule', {
    action: 'swap',
    dateKey: '2026-11-16',
    scheduleDayExerciseId: pushSlotId,
    toExerciseId: 'incline-dumbbell-bench-press',
    scope: 'session',
  });
  assert.equal(swapRes.result?.isError, false);

  const jollyRes = await callMcpTool(userA.rawKey, 'manage_schedule', {
    action: 'start_jolly_session',
    eventDate: '2026-11-16',
    jollyMode: 'extra',
    jollyLabel: 'Arms Pump',
  });
  assert.equal(jollyRes.result?.isError, false);

  const skipRes = await callMcpTool(userA.rawKey, 'manage_schedule', {
    action: 'skip',
    eventDate: '2026-11-18',
  });
  assert.equal(skipRes.result?.isError, false);

  const undoRes = await callMcpTool(userA.rawKey, 'manage_schedule', {
    action: 'undo_event',
    eventDate: '2026-11-18',
  });
  assert.equal(undoRes.result?.isError, false);
  assert.equal(undoRes.result?.structuredContent?.deleted, 1);

  const schedRead = await callMcpTool(userA.rawKey, 'get_schedule', {
    startDate: '2026-11-16',
    endDate: '2026-11-19',
  });
  assert.equal(schedRead.result?.isError, false);

  // 3. log_workout_session, get_workout_session, edit_workout_session (including actualRest, repQualities, startedAt)
  const log1 = await callMcpTool(userA.rawKey, 'log_workout_session', {
    sessionDate: '2026-11-14',
    title: 'Push 1',
    durationMinutes: 45,
    notes: 'Original note',
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [
          { setNumber: 1, weightKg: 80, reps: 8, restSeconds: 120, actualRestSeconds: 110 },
          { setNumber: 2, weightKg: 80, reps: 8, restSeconds: 120 },
        ],
      },
    ],
  });
  assert.equal(log1.result?.isError, false);
  const sessionId1 = (log1.result?.structuredContent?.session as { id: string }).id;

  const editRes = await callMcpTool(userA.rawKey, 'edit_workout_session', {
    sessionId: sessionId1,
    sessionDate: '2026-11-15',
    title: 'Push 1 Edited',
    startedAt: '2026-11-15T10:00:00.000Z',
    completedAt: '2026-11-15T10:55:00.000Z',
    durationMinutes: 55,
    notes: 'Updated session note',
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        notes: 'Paused reps',
        sets: [
          {
            setNumber: 1,
            weightKg: 85,
            reps: 6,
            restSeconds: 150,
            actualRestSeconds: 140,
            restApproximate: true,
            repQualities: [
              { repIndex: 1, qualityPct: 90 },
              { repIndex: 2, qualityPct: 80 },
            ],
          },
          {
            setNumber: 2,
            weightKg: 85,
            reps: 6,
            restSeconds: 150,
            actualRestSeconds: null,
            executionQualityPct: 88,
          },
        ],
      },
    ],
  });
  assert.equal(editRes.result?.isError, false);
  const editedSession = editRes.result?.structuredContent?.session as {
    title: string;
    sessionDate: string;
    startedAt: string;
    durationMinutes: number;
    notes: string;
    exercises: Array<{
      notes: string;
      sets: Array<{
        weightKg: number;
        restSeconds: number;
        actualRestSeconds: number | null;
        restApproximate: boolean;
        executionQualityPct: number | null;
        repQualities?: Array<{ repIndex: number; qualityPct: number }>;
      }>;
    }>;
  };
  assert.equal(editedSession.title, 'Push 1 Edited');
  assert.equal(editedSession.sessionDate, '2026-11-15');
  assert.equal(editedSession.startedAt, '2026-11-15T10:00:00.000Z');
  assert.equal(editedSession.durationMinutes, 55);
  assert.equal(editedSession.notes, 'Updated session note');
  assert.equal(editedSession.exercises[0]!.sets[0]!.actualRestSeconds, 140);
  assert.equal(editedSession.exercises[0]!.sets[0]!.restApproximate, true);
  assert.equal(editedSession.exercises[0]!.sets[0]!.executionQualityPct, 85);
  assert.equal(editedSession.exercises[0]!.sets[0]!.repQualities?.length, 2);

  const readSess = await callMcpTool(userA.rawKey, 'get_workout_session', {
    sessionId: sessionId1,
  });
  assert.equal(readSess.result?.isError, false);
  assert.equal(
    (readSess.result?.structuredContent?.restSummary as { totalRestSeconds: number })
      .totalRestSeconds,
    140,
  );

  // User B cannot read or edit User A's session
  const foreignRead = await callMcpTool(userB.rawKey, 'get_workout_session', {
    sessionId: sessionId1,
  });
  assert.equal(foreignRead.result?.isError, true);
  const foreignEdit = await callMcpTool(userB.rawKey, 'edit_workout_session', {
    sessionId: sessionId1,
    title: 'Hijacked',
  });
  assert.equal(foreignEdit.result?.isError, true);

  // 4. get_progress_and_rest
  const progRes = await callMcpTool(userA.rawKey, 'get_progress_and_rest', {
    range: 'all',
  });
  assert.equal(progRes.result?.isError, false);
  const progData = progRes.result?.structuredContent as {
    personalRecords: Array<{ exerciseId: string; bestWeightKg: number | null }>;
    restSummary: { totalMeasuredSets: number };
  };
  assert.equal(progData.personalRecords[0]?.bestWeightKg, 85);
  assert.equal(progData.restSummary.totalMeasuredSets, 1);

  // 5. manage_exercise_step
  const stepSet = await callMcpTool(userA.rawKey, 'manage_exercise_step', {
    action: 'set',
    exerciseId: 'barbell-bench-press',
    weightStepKg: 0.5,
  });
  assert.equal(stepSet.result?.isError, false);
  assert.equal(
    (stepSet.result?.structuredContent?.resolvedStep as { stepKg: number }).stepKg,
    0.5,
  );
  const stepReset = await callMcpTool(userA.rawKey, 'manage_exercise_step', {
    action: 'reset',
    exerciseId: 'barbell-bench-press',
  });
  assert.equal(stepReset.result?.isError, false);

  // 6. list_body_weights & manage_body_weight
  const logBw = await callMcpTool(userA.rawKey, 'manage_body_weight', {
    action: 'log',
    weightKg: 82.4,
    measuredOn: '2026-11-15',
  });
  assert.equal(logBw.result?.isError, false);
  const bmId = (logBw.result?.structuredContent?.metric as { id: string }).id;
  const editBw = await callMcpTool(userA.rawKey, 'manage_body_weight', {
    action: 'edit',
    id: bmId,
    weightKg: 81.9,
  });
  assert.equal(editBw.result?.isError, false);
  assert.equal(editBw.result?.structuredContent?.profileWeightKg, 81.9);

  // User B cannot edit or delete User A's body metric
  const foreignBw = await callMcpTool(userB.rawKey, 'manage_body_weight', {
    action: 'delete',
    id: bmId,
  });
  assert.equal(foreignBw.result?.isError, true);

  const listBw = await callMcpTool(userA.rawKey, 'list_body_weights', {
    range: 'all',
  });
  assert.equal(listBw.result?.isError, false);
  assert.equal(
    (listBw.result?.structuredContent?.summary as { currentWeightKg: number })
      .currentWeightKg,
    81.9,
  );

  const delBw = await callMcpTool(userA.rawKey, 'manage_body_weight', {
    action: 'delete',
    id: bmId,
  });
  assert.equal(delBw.result?.isError, false);

  // 7. apple_health_tools: dry_run_import, ingest, list_workouts, relink_workout
  const dryRunBad = await callMcpTool(userA.rawKey, 'apple_health_tools', {
    action: 'dry_run_import',
    payload: { workouts: [{ durationMinutes: 30 }] },
  });
  assert.equal(dryRunBad.result?.isError, true);

  const dryRunGood = await callMcpTool(userA.rawKey, 'apple_health_tools', {
    action: 'dry_run_import',
    payload: {
      workouts: [
        {
          workoutType: 'Traditional Strength Training',
          startedAt: '2026-11-15T10:02:00.000Z',
          durationMinutes: 50,
          activeCalories: 410,
          avgHeartRate: 132,
          maxHeartRate: 165,
        },
      ],
    },
  });
  assert.equal(dryRunGood.result?.isError, false);
  assert.equal(dryRunGood.result?.structuredContent?.dryRun, true);

  const freshA = (await getUserById(userA.user.id))!;
  const ingested = await ingestAppleHealthPayload(freshA, {
    workouts: [
      {
        workoutType: 'Traditional Strength Training',
        startedAt: '2026-11-15T10:02:00.000Z',
        durationMinutes: 50,
        activeCalories: 410,
        avgHeartRate: 132,
        maxHeartRate: 165,
      },
    ],
  });
  assert.equal(ingested.dryRun, false);
  const ahWorkoutId = ingested.dryRun === false ? ingested.workouts[0]!.id : '';

  const unlinkRes = await callMcpTool(userA.rawKey, 'apple_health_tools', {
    action: 'relink_workout',
    healthWorkoutId: ahWorkoutId,
    sessionId: null,
  });
  assert.equal(unlinkRes.result?.isError, false);
  assert.equal(
    (unlinkRes.result?.structuredContent?.workout as { linkedSessionId: string | null })
      .linkedSessionId,
    null,
  );

  const relinkRes = await callMcpTool(userA.rawKey, 'apple_health_tools', {
    action: 'relink_workout',
    healthWorkoutId: ahWorkoutId,
    sessionId: sessionId1,
  });
  assert.equal(relinkRes.result?.isError, false);
  assert.equal(
    (relinkRes.result?.structuredContent?.workout as { linkedSessionId: string | null })
      .linkedSessionId,
    sessionId1,
  );

  // 8. Single delete + bulk delete (2-step) + audit
  const log2 = await callMcpTool(userA.rawKey, 'log_workout_session', {
    sessionDate: '2026-11-16',
    title: 'Pull 1',
    exercises: [{ exerciseId: 'barbell-bent-over-row', sets: [{ weightKg: 70, reps: 8 }] }],
  });
  const log3 = await callMcpTool(userA.rawKey, 'log_workout_session', {
    sessionDate: '2026-11-17',
    title: 'Legs 1',
    exercises: [{ exerciseId: 'barbell-back-squat', sets: [{ weightKg: 100, reps: 5 }] }],
  });
  const id2 = (log2.result?.structuredContent?.session as { id: string }).id;
  const id3 = (log3.result?.structuredContent?.session as { id: string }).id;

  const singleDel = await callMcpTool(userA.rawKey, 'delete_workout_session', {
    sessionId: sessionId1,
  });
  assert.equal(singleDel.result?.isError, false);

  const bulkStep1 = await callMcpTool(userA.rawKey, 'delete_workout_sessions_bulk', {
    sessionIds: [id2, id3],
  });
  assert.equal(bulkStep1.result?.isError, false);
  assert.equal(bulkStep1.result?.structuredContent?.requiresConfirmation, true);
  const bulkToken = bulkStep1.result?.structuredContent?.confirmationToken as string;
  assert.ok(bulkToken);

  // Mismatched target/payload refused
  const bulkMismatch = await callMcpTool(userA.rawKey, 'delete_workout_sessions_bulk', {
    sessionIds: [id2],
    confirmationToken: bulkToken,
  });
  assert.equal(bulkMismatch.result?.isError, true);

  // Valid confirmation deletes both
  const bulkStep2 = await callMcpTool(userA.rawKey, 'delete_workout_sessions_bulk', {
    sessionIds: [id2, id3],
    confirmationToken: bulkToken,
  });
  assert.equal(bulkStep2.result?.isError, false);
  assert.equal(bulkStep2.result?.structuredContent?.deletedCount, 2);

  // Reused confirmation refused
  const bulkReuse = await callMcpTool(userA.rawKey, 'delete_workout_sessions_bulk', {
    sessionIds: [id2, id3],
    confirmationToken: bulkToken,
  });
  assert.equal(bulkReuse.result?.isError, true);
});

test('Phase 11 MCP Photos: 3-step flow, PHOTO_DOWNLOAD_SECRET requirement, signed route without auth, rate limit, expiry/tamper 404, and owner-only isolation (even for admin)', async (t) => {
  await setupMemDb();
  const prevAdmins = process.env.ADMIN_USER_IDS;
  const prevSecret = process.env.PHOTO_DOWNLOAD_SECRET;
  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdmins;
    if (prevSecret === undefined) delete process.env.PHOTO_DOWNLOAD_SECRET;
    else process.env.PHOTO_DOWNLOAD_SECRET = prevSecret;
    await closeDb();
  });

  const adminOwner = await issueUserWithKey({ id: 'usr_p11_ph_a', username: 'photo_admin' });
  const otherUser = await issueUserWithKey({ id: 'usr_p11_ph_b', username: 'photo_other' });
  process.env.ADMIN_USER_IDS = adminOwner.user.id;

  // Use ASCII-safe test bytes in pg-mem (binary 0x00..0xFF bytea round-trip is covered in phase11RealPostgres.test.ts)
  const fullA1 = Buffer.from('ascii-jpeg-full-a1');
  const thumbA1 = Buffer.from('ascii-jpeg-thumb-a1');
  const fullB = Buffer.from('ascii-jpeg-full-b');
  const thumbB = Buffer.from('ascii-jpeg-thumb-b');

  const createdPhotosA: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const p = await createProgressPhoto({
      userId: adminOwner.user.id,
      takenOn: `2026-11-0${i + 1}`,
      pose: i % 2 === 0 ? 'front' : 'side',
      weightKg: 80 + i,
      fullBytes: fullA1,
      thumbBytes: thumbA1,
    });
    createdPhotosA.push(p.photo.id);
  }
  const photoB = await createProgressPhoto({
    userId: otherUser.user.id,
    takenOn: '2026-11-10',
    pose: 'back',
    weightKg: 70,
    fullBytes: fullB,
    thumbBytes: thumbB,
  });

  // Step 1: list_photos returns metadata only, filtered cleanly
  const listRes = await callMcpTool(adminOwner.rawKey, 'list_photos', {
    from: '2026-11-01',
    to: '2026-11-03',
    pose: 'front',
  });
  assert.equal(listRes.result?.isError, false);
  const listed = listRes.result?.structuredContent?.photos as Array<Record<string, unknown>>;
  assert.equal(listed.length, 2);
  assert.equal(listed[0]?.fullBytes, undefined);
  assert.equal(listed[0]?.thumbBytes, undefined);

  // Step 2: browse_photo_thumbnails capped at 5, rejects foreign ID even for admin, returns thumb bytes
  const tooManyThumbs = await callMcpTool(
    adminOwner.rawKey,
    'browse_photo_thumbnails',
    { photoIds: createdPhotosA },
  );
  assert.equal(tooManyThumbs.result?.isError, true);

  const foreignThumb = await callMcpTool(
    adminOwner.rawKey,
    'browse_photo_thumbnails',
    { photoIds: [photoB.photo.id] },
  );
  assert.equal(foreignThumb.result?.isError, true);
  assert.match(foreignThumb.result?.content[0]?.text ?? '', /not found/i);

  const thumbsOk = await callMcpTool(adminOwner.rawKey, 'browse_photo_thumbnails', {
    photoIds: [createdPhotosA[0]!],
  });
  assert.equal(thumbsOk.result?.isError, false);
  const imgBlock = thumbsOk.result?.content.find((c) => c.type === 'image');
  assert.ok(imgBlock);
  assert.equal(imgBlock.mimeType, 'image/jpeg');
  assert.equal(imgBlock.data, thumbA1.toString('base64'));
  assert.notEqual(imgBlock.data, fullA1.toString('base64'));

  // Step 3: get_photo_download_links refuses when PHOTO_DOWNLOAD_SECRET is unset/blank
  delete process.env.PHOTO_DOWNLOAD_SECRET;
  const noSecretRes = await callMcpTool(
    adminOwner.rawKey,
    'get_photo_download_links',
    { photoIds: [createdPhotosA[0]!] },
  );
  assert.equal(noSecretRes.result?.isError, true);
  assert.match(noSecretRes.result?.content[0]?.text ?? '', /PHOTO_DOWNLOAD_SECRET/);

  process.env.PHOTO_DOWNLOAD_SECRET = '   ';
  const blankSecretRes = await callMcpTool(
    adminOwner.rawKey,
    'get_photo_download_links',
    { photoIds: [createdPhotosA[0]!] },
  );
  assert.equal(blankSecretRes.result?.isError, true);

  // Set real secret
  process.env.PHOTO_DOWNLOAD_SECRET = 'test-photo-secret-0123456789abcdef';

  // Rejects > 5 and rejects foreign photo even for admin
  const tooManyLinks = await callMcpTool(
    adminOwner.rawKey,
    'get_photo_download_links',
    { photoIds: createdPhotosA },
  );
  assert.equal(tooManyLinks.result?.isError, true);

  const foreignLink = await callMcpTool(
    adminOwner.rawKey,
    'get_photo_download_links',
    { photoIds: [photoB.photo.id] },
  );
  assert.equal(foreignLink.result?.isError, true);
  assert.match(foreignLink.result?.content[0]?.text ?? '', /not found/i);

  const linkRes = await callMcpTool(adminOwner.rawKey, 'get_photo_download_links', {
    photoIds: [createdPhotosA[0]!],
  });
  assert.equal(linkRes.result?.isError, false);
  const links = linkRes.result?.structuredContent?.links as Array<{
    photoId: string;
    path: string;
    url: string;
  }>;
  assert.equal(links.length, 1);
  const token = links[0]!.path.split('/').pop()!;
  // Token must reveal nothing about userId or photoId
  const decodedPreview = Buffer.from(token, 'base64url').toString('utf8');
  assert.equal(decodedPreview.includes(adminOwner.user.id), false);
  assert.equal(decodedPreview.includes(createdPhotosA[0]!), false);
  assert.equal(links[0]!.path.includes(adminOwner.user.id), false);
  assert.equal(links[0]!.path.includes(createdPhotosA[0]!), false);

  // GET /api/photos/signed/[token] works WITHOUT cookie or API key
  const dlReq = new NextRequest(`https://lift.example.test${links[0]!.path}`, {
    method: 'GET',
  });
  const dlRes = await signedPhotoGet(dlReq, {
    params: Promise.resolve({ token }),
  });
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get('content-type'), 'image/jpeg');
  assert.equal(dlRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(dlRes.headers.get('cache-control'), 'private, no-store');
  const dlBytes = Buffer.from(await dlRes.arrayBuffer());
  assert.deepEqual(dlBytes, fullA1);

  // Tampered token returns 404
  const tamperedToken = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
  const tamperedRes = await signedPhotoGet(
    new NextRequest(`https://lift.example.test/api/photos/signed/${tamperedToken}`),
    { params: Promise.resolve({ token: tamperedToken }) },
  );
  assert.equal(tamperedRes.status, 404);

  // Expired token returns 404
  const expired = createSignedPhotoToken(
    adminOwner.user.id,
    createdPhotosA[0]!,
    Date.now() - 10 * 60_000,
  );
  const expiredRes = await signedPhotoGet(
    new NextRequest(`https://lift.example.test/api/photos/signed/${expired.token}`),
    { params: Promise.resolve({ token: expired.token }) },
  );
  assert.equal(expiredRes.status, 404);

  // Unset secret causes signed endpoint to return 404
  const savedSecret = process.env.PHOTO_DOWNLOAD_SECRET;
  delete process.env.PHOTO_DOWNLOAD_SECRET;
  const secretMissingRes = await signedPhotoGet(dlReq, {
    params: Promise.resolve({ token }),
  });
  assert.equal(secretMissingRes.status, 404);
  process.env.PHOTO_DOWNLOAD_SECRET = savedSecret;

  // Rate limit enforced (>20 links in window)
  for (let i = 0; i < 4; i += 1) {
    const batch = await callMcpTool(adminOwner.rawKey, 'get_photo_download_links', {
      photoIds: createdPhotosA.slice(0, 5),
    });
    if (i < 3) {
      assert.equal(batch.result?.isError, false);
    } else {
      assert.equal(batch.result?.isError, true);
      assert.match(batch.result?.content[0]?.text ?? '', /rate limit/i);
    }
  }

  // Delete photo via 2-step confirmation (and signed link immediately returns 404 after delete)
  const delForeign = await callMcpTool(adminOwner.rawKey, 'delete_photo', {
    photoId: photoB.photo.id,
  });
  assert.equal(delForeign.result?.isError, true);

  const delStep1 = await callMcpTool(adminOwner.rawKey, 'delete_photo', {
    photoId: createdPhotosA[0]!,
  });
  assert.equal(delStep1.result?.structuredContent?.requiresConfirmation, true);
  const delToken = delStep1.result?.structuredContent?.confirmationToken as string;

  const delStep2 = await callMcpTool(adminOwner.rawKey, 'delete_photo', {
    photoId: createdPhotosA[0]!,
    confirmationToken: delToken,
  });
  assert.equal(delStep2.result?.isError, false);
  assert.equal(await countUserPhotos(adminOwner.user.id), 5);

  const afterDeleteRes = await signedPhotoGet(dlReq, {
    params: Promise.resolve({ token }),
  });
  assert.equal(afterDeleteRes.status, 404);
});

test('Phase 11 MCP: API key regeneration invalidates pending confirmation tokens, restore replace & danger_zone', async (t) => {
  await setupMemDb();
  t.after(async () => {
    await closeDb();
  });

  const u = await issueUserWithKey({ id: 'usr_p11_dz', username: 'dz_user' });

  // Log session + export backup
  await callMcpTool(u.rawKey, 'log_workout_session', {
    sessionDate: '2026-11-10',
    title: 'Backup Session',
    exercises: [{ exerciseId: 'barbell-bench-press', sets: [{ weightKg: 90, reps: 5 }] }],
  });
  const exported = await callMcpTool(u.rawKey, 'export_data');
  const exportJson = exported.result?.structuredContent!;

  // Start replace-mode restore (step 1) with Key 1
  const replaceStep1 = await callMcpTool(u.rawKey, 'restore_liftitup_backup', {
    mode: 'replace',
    exportData: exportJson,
  });
  assert.equal(replaceStep1.result?.structuredContent?.requiresConfirmation, true);
  const oldConfirmToken = replaceStep1.result?.structuredContent
    ?.confirmationToken as string;

  // Regenerate API key (Key 2) -> Key 1 fails 401 AND Key 2 rejects oldConfirmToken!
  const key2 = generateApiKey();
  await upsertApiKey(u.user.id, key2.keyHash, key2.keyPrefix);

  const oldKeyCall = await callMcpHttp(u.rawKey, 'tools/list');
  assert.equal(oldKeyCall.status, 401);

  const staleTokenWithNewKey = await callMcpTool(
    key2.rawKey,
    'restore_liftitup_backup',
    {
      mode: 'replace',
      exportData: exportJson,
      confirmationToken: oldConfirmToken,
    },
  );
  assert.equal(staleTokenWithNewKey.result?.isError, true);
  assert.match(staleTokenWithNewKey.result?.content[0]?.text ?? '', /API key/i);

  // New confirmation with Key 2 succeeds
  const replaceNew1 = await callMcpTool(key2.rawKey, 'restore_liftitup_backup', {
    mode: 'replace',
    exportData: exportJson,
  });
  const newToken = replaceNew1.result?.structuredContent?.confirmationToken as string;
  const replaceNew2 = await callMcpTool(key2.rawKey, 'restore_liftitup_backup', {
    mode: 'replace',
    exportData: exportJson,
    confirmationToken: newToken,
  });
  assert.equal(replaceNew2.result?.isError, false);
  assert.equal(replaceNew2.result?.structuredContent?.sessionsCreated, 1);

  // danger_zone delete_account (2-step) deletes account and leaves audit entry
  const dz1 = await callMcpTool(key2.rawKey, 'danger_zone', {
    action: 'delete_account',
  });
  assert.equal(dz1.result?.structuredContent?.requiresConfirmation, true);
  const dzToken = dz1.result?.structuredContent?.confirmationToken as string;

  const dz2 = await callMcpTool(key2.rawKey, 'danger_zone', {
    action: 'delete_account',
    confirmationToken: dzToken,
  });
  assert.equal(dz2.result?.isError, false);
  assert.equal(dz2.result?.structuredContent?.accountDeleted, true);
  assert.equal(await getUserById(u.user.id), null);

  const audits = await listAuditLog({ targetUserId: u.user.id });
  assert.ok(
    audits.some((a) => a.action === 'danger_delete_account' && a.source === 'mcp'),
  );
});

test('Phase 11 MCP Part B: admin read/act, privacy, reporting views, digest, anomalies, catalog suggestions, maintenance, and audit trail', async (t) => {
  await setupMemDb();
  const prevAdmins = process.env.ADMIN_USER_IDS;
  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdmins;
    await closeDb();
  });

  const admin = await issueUserWithKey({ id: 'usr_p11_adm', username: 'inst_admin' });
  const target = await issueUserWithKey({ id: 'usr_p11_tgt', username: 'target_lifter' });
  const expiredGuest = await createUser({
    id: 'usr_p11_exp_guest',
    username: 'guest_exp_1',
    displayName: 'Guest',
    passwordHash: 'hash',
    isGuest: true,
  });
  await query('UPDATE users SET last_active_at = $1 WHERE id = $2', [
    new Date(Date.now() - 48 * 3600_000).toISOString(),
    expiredGuest.id,
  ]);
  process.env.ADMIN_USER_IDS = admin.user.id;

  // Target logs a workout with secret note + weight + custom exercise
  await callMcpTool(target.rawKey, 'upsert_custom_exercise', {
    name: 'Custom Bulgarian Split Squat',
    trackingType: 'weight_reps',
  });
  await callMcpTool(target.rawKey, 'log_workout_session', {
    sessionDate: new Date().toISOString().slice(0, 10),
    title: 'Private Workout Title',
    notes: 'TOP_SECRET_WORKOUT_NOTE',
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        notes: 'TOP_SECRET_EX_NOTE',
        sets: [{ weightKg: 112.5, reps: 5 }],
      },
    ],
  });
  await callMcpTool(target.rawKey, 'manage_body_weight', {
    action: 'log',
    weightKg: 94.37,
  });
  await createProgressPhoto({
    userId: target.user.id,
    takenOn: '2026-11-15',
    pose: 'front',
    weightKg: 94.37,
    fullBytes: Buffer.from([1, 2, 3, 4]),
    thumbBytes: Buffer.from([5, 6]),
  });

  // Trigger route error, rejected Apple Health ingest, and photo quota near limit
  await callMcpTool(admin.rawKey, 'admin_adjust_photo_quota', {
    targetUserId: target.user.id,
    photoQuota: 1,
  });
  recordRequestMetric({
    route: 'api.test.failing',
    method: 'GET',
    status: 500,
    durationMs: 12,
    errorMessage: 'Simulated 500 error',
  });
  await recordAppleHealthIngestOutcome('rejected');
  await recordEvent({ userId: target.user.id, eventType: 'app_active' });

  // 1. Admin read tools & privacy assertions
  for (const [toolName, args] of [
    ['admin_get_overview', {}],
    ['admin_get_storage', {}],
    ['admin_get_user_detail', { targetUserId: target.user.id }],
    ['admin_get_adoption', {}],
    ['admin_get_health', { windowHours: 24 }],
    ['admin_get_events_timeline', { limit: 20 }],
    ['admin_list_snapshots', { limit: 10, includeLatestFull: true }],
  ] as const) {
    const res = await callMcpTool(admin.rawKey, toolName, args);
    assert.equal(res.result?.isError, false, `${toolName} failed`);
    const serialized = JSON.stringify(res.result?.structuredContent);
    assert.equal(serialized.includes('TOP_SECRET_WORKOUT_NOTE'), false);
    assert.equal(serialized.includes('TOP_SECRET_EX_NOTE'), false);
    assert.equal(serialized.includes('94.37'), false);
    assert.equal(serialized.includes('passwordHash'), false);
  }

  // 2. admin_query_reporting_view safety
  const viewsList = await callMcpTool(admin.rawKey, 'admin_query_reporting_view', {
    action: 'list_views',
  });
  assert.equal(viewsList.result?.isError, false);

  const viewQueryOk = await callMcpTool(admin.rawKey, 'admin_query_reporting_view', {
    view: 'v_admin_user_activity',
    columns: ['user_id', 'username', 'session_count', 'photo_count'],
    filters: [{ column: 'username', op: 'eq', value: 'target_lifter' }],
    limit: 10,
  });
  assert.equal(viewQueryOk.result?.isError, false);
  const rows = viewQueryOk.result?.structuredContent?.rows as Array<{
    username: string;
    session_count: number;
    photo_count: number;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.session_count, 1);
  assert.equal(rows[0]!.photo_count, 1);

  // Reject raw SQL, real tables, sensitive columns, and >100 limit
  for (const badArgs of [
    { sql: 'SELECT * FROM users' },
    { view: 'users' },
    { view: 'progress_photo_blobs' },
    { view: 'v_admin_user_activity', columns: ['password_hash'] },
    { view: 'v_admin_user_activity', columns: ['notes'] },
    { view: 'v_admin_user_activity', limit: 101 },
  ]) {
    const badRes = await callMcpTool(
      admin.rawKey,
      'admin_query_reporting_view',
      badArgs,
    );
    assert.equal(badRes.result?.isError, true);
  }

  // 3. Digest, Anomaly hints, Catalog suggestions, Run maintenance
  const digestRes = await callMcpTool(admin.rawKey, 'admin_get_digest', {
    periodDays: 7,
  });
  assert.equal(digestRes.result?.isError, false);
  assert.ok(
    (digestRes.result?.structuredContent?.workouts as { sessionsCurrent: number })
      .sessionsCurrent >= 1,
  );

  const anomalyRes = await callMcpTool(admin.rawKey, 'admin_get_anomaly_hints');
  assert.equal(anomalyRes.result?.isError, false);
  const hints = anomalyRes.result?.structuredContent?.hints as Array<{
    category: string;
    summary: string;
    metrics: Record<string, unknown>;
  }>;
  assert.ok(hints.some((h) => h.category === 'photo_quota'));
  assert.ok(hints.some((h) => h.category === 'route_errors'));
  assert.ok(hints.some((h) => h.category === 'apple_health_rejections'));
  assert.ok(hints.some((h) => h.category === 'guest_purge'));
  // Ensure user-written usernames are NEVER embedded in prose summary
  for (const h of hints) {
    assert.equal(h.summary.includes('target_lifter'), false);
    assert.equal(h.summary.includes('inst_admin'), false);
  }

  const catalogRes = await callMcpTool(
    admin.rawKey,
    'admin_get_catalog_suggestions',
    { minUsers: 1 },
  );
  assert.equal(catalogRes.result?.isError, false);
  const candidates = catalogRes.result?.structuredContent
    ?.customExerciseCandidates as Array<{ sampleName: string }>;
  assert.ok(candidates.some((c) => c.sampleName === 'Custom Bulgarian Split Squat'));

  const maintRes = await callMcpTool(admin.rawKey, 'admin_run_maintenance', {
    task: 'both',
  });
  assert.equal(maintRes.result?.isError, false);
  assert.equal(
    (maintRes.result?.structuredContent?.guestPurge as { purgedCount: number })
      .purgedCount,
    1,
  );

  // 4. Admin actions (2-step where destructive) & export with reason
  const exportNoReason = await callMcpTool(
    admin.rawKey,
    'admin_export_user_data',
    { targetUserId: target.user.id, reason: 'no' },
  );
  assert.equal(exportNoReason.result?.isError, true);

  const exportOk = await callMcpTool(admin.rawKey, 'admin_export_user_data', {
    targetUserId: target.user.id,
    reason: 'User support export test',
  });
  assert.equal(exportOk.result?.isError, false);
  const exportedJson = JSON.stringify(exportOk.result?.structuredContent?.data);
  assert.equal(exportedJson.includes('audit_log'), false);
  assert.equal(exportedJson.includes('full_bytes'), false);

  // Disable (2-step) + Enable
  const dis1 = await callMcpTool(admin.rawKey, 'admin_disable_user', {
    targetUserId: target.user.id,
    reason: 'Abuse check',
  });
  const disTok = dis1.result?.structuredContent?.confirmationToken as string;
  const dis2 = await callMcpTool(admin.rawKey, 'admin_disable_user', {
    targetUserId: target.user.id,
    reason: 'Abuse check',
    confirmationToken: disTok,
  });
  assert.equal(dis2.result?.isError, false);
  assert.equal((await getUserById(target.user.id))?.isDisabled, true);

  const enRes = await callMcpTool(admin.rawKey, 'admin_enable_user', {
    targetUserId: target.user.id,
    reason: 'Cleared',
  });
  assert.equal(enRes.result?.isError, false);
  assert.equal((await getUserById(target.user.id))?.isDisabled, false);

  // Password reset (2-step)
  const pw1 = await callMcpTool(admin.rawKey, 'admin_reset_password', {
    username: target.user.username,
    reason: 'Locked out',
  });
  const pwTok = pw1.result?.structuredContent?.confirmationToken as string;
  const pw2 = await callMcpTool(admin.rawKey, 'admin_reset_password', {
    username: target.user.username,
    reason: 'Locked out',
    confirmationToken: pwTok,
  });
  assert.equal(pw2.result?.isError, false);
  const tempPw = pw2.result?.structuredContent?.temporaryPassword as string;
  assert.ok(tempPw.length >= 16);
  const rowPw = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [target.user.id],
  );
  assert.equal(await verifyPassword(tempPw, rowPw!.password_hash), true);

  // Revoke API key (2-step)
  const rev1 = await callMcpTool(admin.rawKey, 'admin_revoke_api_key', {
    targetUserId: target.user.id,
  });
  const revTok = rev1.result?.structuredContent?.confirmationToken as string;
  const rev2 = await callMcpTool(admin.rawKey, 'admin_revoke_api_key', {
    targetUserId: target.user.id,
    confirmationToken: revTok,
  });
  assert.equal(rev2.result?.isError, false);
  assert.equal(rev2.result?.structuredContent?.revoked, true);

  // Delete user (2-step)
  const delU1 = await callMcpTool(admin.rawKey, 'admin_delete_user', {
    targetUserId: target.user.id,
  });
  const delUTok = delU1.result?.structuredContent?.confirmationToken as string;
  const delU2 = await callMcpTool(admin.rawKey, 'admin_delete_user', {
    targetUserId: target.user.id,
    confirmationToken: delUTok,
  });
  assert.equal(delU2.result?.isError, false);
  assert.equal(await getUserById(target.user.id), null);

  // Verify audit log recorded every admin MCP action with source='mcp' and key id/prefix
  const auditRes = await callMcpTool(admin.rawKey, 'admin_get_audit_log', {
    limit: 100,
  });
  assert.equal(auditRes.result?.isError, false);
  const entries = auditRes.result?.structuredContent?.entries as Array<{
    source: string;
    action: string;
    detail: { apiKeyId?: string; apiKeyPrefix?: string } | null;
  }>;
  const mcpAdminEntries = entries.filter((e) => e.source === 'mcp');
  assert.ok(mcpAdminEntries.length >= 15);
  for (const e of mcpAdminEntries) {
    assert.equal(e.detail?.apiKeyId, admin.keyInfo.id);
    assert.equal(e.detail?.apiKeyPrefix, admin.keyInfo.keyPrefix);
  }
});

test('MCP URL token authentication (?token=...), config snippets, and log/error secret redaction', async (t) => {
  await setupMemDb();
  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(' '));
  };

  t.after(async () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    await closeDb();
  });

  const user = await issueUserWithKey({ id: 'usr_url_tok', username: 'url_tok_user' });

  async function callMcpWithQueryToken(
    query: string,
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    const req = new NextRequest(`https://lift.example.test/api/mcp${query}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const res = await mcpPost(req, { params: Promise.resolve({}) });
    return {
      res,
      json: (await res.json()) as {
        result?: Record<string, unknown>;
        error?: { code?: number | string; message: string };
      },
    };
  }

  // 1. Valid ?token=<api_key> authenticates tools/list and tools/call
  const listRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(user.rawKey)}`,
    'tools/list',
  );
  assert.equal(listRes.res.status, 200);
  assert.equal(listRes.res.headers.get('cache-control'), 'private, no-store');
  assert.equal(listRes.res.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(Array.isArray(listRes.json.result?.tools));

  const profRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(user.rawKey)}`,
    'tools/call',
    { name: 'get_profile', arguments: {} },
  );
  assert.equal(profRes.res.status, 200);
  const prof = profRes.json.result?.structuredContent as {
    profile: { id: string; username: string };
  };
  assert.equal(prof.profile.id, user.user.id);

  // 2. Invalid, empty, or missing ?token= fails with 401 and never echoes raw token
  const invalidRes = await callMcpWithQueryToken('?token=liuk_not_a_real_key_1234', 'tools/list');
  assert.equal(invalidRes.res.status, 401);
  assert.equal(JSON.stringify(invalidRes.json).includes('liuk_not_a_real_key_1234'), false);

  const emptyRes = await callMcpWithQueryToken('?token=%20%20', 'tools/list');
  assert.equal(emptyRes.res.status, 401);

  const missingRes = await callMcpWithQueryToken('', 'tools/list');
  assert.equal(missingRes.res.status, 401);

  // 3. Malformed Authorization header does NOT fall back to ?token=, while valid Bearer takes precedence
  const malformedHeaderRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(user.rawKey)}`,
    'tools/list',
    {},
    { authorization: 'Basic abc123' },
  );
  assert.equal(malformedHeaderRes.res.status, 401);

  const bearerPrecedenceRes = await callMcpWithQueryToken(
    '?token=liuk_wrong_query_token',
    'tools/list',
    {},
    { authorization: `Bearer ${user.rawKey}` },
  );
  assert.equal(bearerPrecedenceRes.res.status, 200);

  // 4. Key regeneration invalidates old ?token= and accepts new ?token=
  const key2 = generateApiKey();
  await upsertApiKey(user.user.id, key2.keyHash, key2.keyPrefix);
  const oldTokRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(user.rawKey)}`,
    'tools/list',
  );
  assert.equal(oldTokRes.res.status, 401);

  const newTokRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(key2.rawKey)}`,
    'tools/list',
  );
  assert.equal(newTokRes.res.status, 200);

  // 5. Disabled user cannot authenticate via ?token=
  await setUserDisabledState({
    targetUserId: user.user.id,
    disabled: true,
    reason: 'test',
    actor: { actorUserId: null, actorLabel: 'test', source: 'cli' },
  });
  const disabledTokRes = await callMcpWithQueryToken(
    `?token=${encodeURIComponent(key2.rawKey)}`,
    'tools/list',
  );
  assert.equal(disabledTokRes.res.status, 401);

  // 6. Verify logger and error sanitizers redact URL tokens, raw keys, and Bearer tokens
  logger.info('test url log', {
    url: `https://lift.example.test/api/mcp?token=${key2.rawKey}&foo=1`,
    err: new Error(`Failed request to /api/mcp?token=${user.rawKey}`),
  });
  const combinedLogs = capturedLogs.join('\n');
  assert.equal(combinedLogs.includes(user.rawKey), false);
  assert.equal(combinedLogs.includes(key2.rawKey), false);
  assert.equal(combinedLogs.includes('liuk_not_a_real_key_1234'), false);
  assert.match(combinedLogs, /\?token=\*\*\*/);
  assert.equal(
    redactSensitiveText(`https://lift.example.test/api/mcp?token=secret_abc_123&x=1`),
    'https://lift.example.test/api/mcp?token=***&x=1',
  );
  assert.equal(
    sanitizeErrorMessage(new Error(`GET /api/mcp?token=${key2.rawKey}`)),
    'GET /api/mcp?token=***',
  );

  // 7. Config helpers expose both Bearer and URL token formats cleanly
  assert.equal(
    getMcpTokenEndpointUrl('https://lift.example.test', null),
    'https://lift.example.test/api/mcp?token=<YOUR_API_KEY>',
  );
  assert.equal(
    getMcpTokenEndpointUrl('https://lift.example.test/', 'liuk_abc123'),
    'https://lift.example.test/api/mcp?token=liuk_abc123',
  );
  const bearerCfg = JSON.parse(
    getMcpClientConfigSnippet('https://lift.example.test', 'liuk_abc123', 'bearer'),
  ) as { mcpServers: { liftitup: { url: string; headers?: { Authorization?: string } } } };
  assert.equal(bearerCfg.mcpServers.liftitup.url, 'https://lift.example.test/api/mcp');
  assert.equal(bearerCfg.mcpServers.liftitup.headers?.Authorization, 'Bearer liuk_abc123');

  const urlTokCfg = JSON.parse(
    getMcpClientConfigSnippet('https://lift.example.test', 'liuk_abc123', 'url_token'),
  ) as { mcpServers: { liftitup: { url: string; headers?: unknown } } };
  assert.equal(
    urlTokCfg.mcpServers.liftitup.url,
    'https://lift.example.test/api/mcp?token=liuk_abc123',
  );
  assert.equal(urlTokCfg.mcpServers.liftitup.headers, undefined);
});

test('MCP get_profile returns the 15 most recent body weight entries (not the 15 oldest)', async (t) => {
  await setupMemDb();
  t.after(async () => {
    await closeDb();
  });

  const user = await issueUserWithKey({ id: 'usr_prof_bm', username: 'prof_bm_user' });
  for (let day = 1; day <= 20; day += 1) {
    const dd = String(day).padStart(2, '0');
    await recordBodyMetric({
      userId: user.user.id,
      measuredOn: `2026-10-${dd}`,
      weightKg: 70 + day * 0.1,
      source: 'manual',
      createdAt: `2026-10-${dd}T08:00:00.000Z`,
    });
  }

  const prof = await callMcpTool(user.rawKey, 'get_profile');
  assert.equal(prof.result?.isError, false);
  const recent = prof.result?.structuredContent?.recentBodyMetrics as Array<{
    measuredOn: string;
    weightKg: number;
  }>;
  assert.equal(recent.length, 15);
  assert.equal(recent[0]?.measuredOn, '2026-10-06');
  assert.equal(recent[14]?.measuredOn, '2026-10-20');
});
