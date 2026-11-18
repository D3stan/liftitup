import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

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
const { setupRealPostgresTestDb } = await import(
  '@/lib/db/__tests__/realPostgres'
);
const {
  query,
  queryOne,
  resetDbHealthStatsForTests,
  setSlowQueryThresholdMsForTests,
} = await import('@/lib/db/connection');
const { initSchema } = await import('@/lib/db/schema');
const { createUser, updateUserSettings } = await import('@/lib/db/users');
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { createProgressPhoto } = await import('@/lib/db/photos');
const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
const { hashToken, purgeExpiredGuestsIfDue } = await import('@/lib/auth/sandbox')
  .then(async (sandboxMod) => {
    const sessMod = await import('@/lib/auth/session');
    return { ...sandboxMod, ...sessMod };
  });
const {
  adjustUserPhotoQuota,
  computeAndSaveDailySnapshot,
  ensureDailySnapshotIfDue,
  getAdminAdoptionReport,
  getAdminOverview,
  getAdminStorageReport,
  getAdminSystemHealth,
  getAdminUserDetail,
  recordEvent,
  recordRequestMetric,
  resetActivityThrottleForTests,
  resetMetricsBufferForTests,
  resetSnapshotThrottleForTests,
} = await import('@/lib/admin');
const { POST: appleHealthPost } = await import(
  '@/app/api/integrations/apple-health/route'
);

test('Real Postgres: Phase 10 snapshots, pg_column_size storage, cohorts, adoption, health, user detail, and CLI password reset', async (t) => {
  const ctx = await setupRealPostgresTestDb('phase10');
  resetActivityThrottleForTests();
  resetMetricsBufferForTests();
  resetSnapshotThrottleForTests();
  resetDbHealthStatsForTests();

  t.after(async () => {
    resetMetricsBufferForTests();
    resetDbHealthStatsForTests();
    await ctx.teardown();
  });

  // Idempotent initSchema check on real Postgres
  await initSchema(ctx.pool);

  const nowMs = Date.now();
  const isoDaysAgo = (days: number) =>
    new Date(nowMs - days * 86_400_000).toISOString();
  const ymdDaysAgo = (days: number) => isoDaysAgo(days).slice(0, 10);

  // 1. Seed registered users across cohorts
  const admin = await createUser({
    id: 'usr_pg_admin',
    username: 'pg_admin',
    displayName: 'PG Admin',
    passwordHash: await hashPassword('adminsecret1'),
    theme: 'cutecore',
    restClockMode: 'countdown',
    defaultWorkoutView: 'focus',
  });

  const activeUser = await createUser({
    id: 'usr_pg_active',
    username: 'pg_active',
    displayName: 'Active Lifter',
    passwordHash: await hashPassword('activepass1'),
    weightKg: 84.5,
  });
  await query(
    'UPDATE users SET created_at = $1, last_active_at = $2 WHERE id = $3',
    [isoDaysAgo(21), isoDaysAgo(0), activeUser.id],
  );

  const churnedUser = await createUser({
    id: 'usr_pg_churned',
    username: 'pg_churned',
    displayName: 'Churned Lifter',
    passwordHash: await hashPassword('churnpass1'),
    weightKg: 78,
  });
  await query(
    'UPDATE users SET created_at = $1, last_active_at = $2 WHERE id = $3',
    [isoDaysAgo(45), isoDaysAgo(35), churnedUser.id],
  );

  // Custom exercises (both activeUser and churnedUser create "Pendlay Row" -> catalog candidate)
  const customEx1Id = `ex_${crypto.randomUUID()}`;
  const customEx2Id = `ex_${crypto.randomUUID()}`;
  await query(
    `INSERT INTO exercises (id, user_id, slug, name, tracking_type, equipment, category, default_rest_seconds, is_custom, aliases_json, created_at)
     VALUES ($1, $2, 'pendlay-row', 'Pendlay Row', 'weight_reps', 'barbell', 'pull', 120, 1, '[]', $3),
            ($4, $5, 'pendlay-row', '  pendlay row  ', 'weight_reps', 'barbell', 'pull', 120, 1, '[]', $3)`,
    [customEx1Id, activeUser.id, isoDaysAgo(10), customEx2Id, churnedUser.id],
  );

  // Schedule for activeUser (2-day rotation anchored 4 days ago: Train, Rest)
  const schedId = `sch_${crypto.randomUUID()}`;
  const day0Id = `sday_${crypto.randomUUID()}`;
  const day1Id = `sday_${crypto.randomUUID()}`;
  const sdexId = `sdex_${crypto.randomUUID()}`;
  await query(
    `INSERT INTO schedules (id, user_id, name, is_active, rotation_anchor_date, rotation_anchor_index, created_at, updated_at)
     VALUES ($1, $2, 'Upper / Rest', 1, $3, 0, $4, $4)`,
    [schedId, activeUser.id, ymdDaysAgo(4), isoDaysAgo(4)],
  );
  await query(
    `INSERT INTO schedule_days (id, schedule_id, position, label, is_rest_day)
     VALUES ($1, $2, 0, 'Upper', 0), ($3, $2, 1, 'Rest', 1)`,
    [day0Id, schedId, day1Id],
  );
  await query(
    `INSERT INTO schedule_day_exercises (id, schedule_day_id, exercise_id, order_index, target_sets, target_reps, rest_seconds, notes)
     VALUES ($1, $2, 'barbell-bench-press', 0, 3, 8, 120, 'SECRET_PLAN_NOTE')`,
    [sdexId, day0Id],
  );
  await query(
    `INSERT INTO schedule_events (id, user_id, schedule_id, event_date, event_type, shift_days, created_at)
     VALUES ($1, $2, $3, $4, 'skip', NULL, $5)`,
    [`sev_${crypto.randomUUID()}`, activeUser.id, schedId, ymdDaysAgo(2), isoDaysAgo(2)],
  );
  await query(
    `INSERT INTO session_swaps (user_id, date_key, schedule_day_exercise_id, exercise_id)
     VALUES ($1, $2, $3, 'incline-dumbbell-bench-press')`,
    [activeUser.id, ymdDaysAgo(4), sdexId],
  );

  // Workout sessions for activeUser (day -21 -> W0, day -14 -> W1, day -4 -> W2) & churnedUser (day -35)
  const addWorkout = async (
    userId: string,
    daysAgo: number,
    exerciseId: string,
    actualRestSeconds: number | null,
    schedDayId: string | null = null,
    isJolly = false,
  ) => {
    const sId = `ws_${crypto.randomUUID()}`;
    const weId = `we_${crypto.randomUUID()}`;
    const wsetId = `wset_${crypto.randomUUID()}`;
    const rqId = `rq_${crypto.randomUUID()}`;
    const ts = isoDaysAgo(daysAgo);
    await query(
      `INSERT INTO workout_sessions (
         id, user_id, session_date, schedule_id, schedule_day_id,
         is_jolly, title, started_at, completed_at, duration_minutes, user_weight_kg, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, 'Workout', $7, $7, 50, 84.5, 'PRIVATE_PG_NOTE')`,
      [sId, userId, ymdDaysAgo(daysAgo), schedDayId ? schedId : null, schedDayId, isJolly ? 1 : 0, ts],
    );
    await query(
      `INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
       VALUES ($1, $2, $3, 0, 'PRIVATE_PG_EX_NOTE')`,
      [weId, sId, exerciseId],
    );
    await query(
      `INSERT INTO workout_sets (
         id, workout_exercise_id, set_number, weight_kg, reps, rest_seconds,
         actual_rest_seconds, rest_approximate, execution_quality_pct, is_completed, created_at
       ) VALUES ($1, $2, 1, 100, 5, 120, $3, 0, 88, 1, $4)`,
      [wsetId, weId, actualRestSeconds, ts],
    );
    await query(
      `INSERT INTO workout_set_rep_qualities (id, workout_set_id, rep_index, quality_pct)
       VALUES ($1, $2, 1, 88)`,
      [rqId, wsetId],
    );
  };

  await addWorkout(activeUser.id, 21, 'barbell-bench-press', 110);
  await addWorkout(activeUser.id, 14, customEx1Id, 130);
  await addWorkout(activeUser.id, 4, 'barbell-bench-press', null, day0Id);
  await addWorkout(activeUser.id, 0, 'barbell-back-squat', 90, null, true);
  await addWorkout(churnedUser.id, 35, customEx2Id, 100);

  // Photos for activeUser (and adjust quota to 2 -> 50%, then 1 -> 100% near-limit!)
  await createProgressPhoto({
    userId: activeUser.id,
    takenOn: ymdDaysAgo(1),
    pose: 'front',
    weightKg: 84.5,
    fullBytes: Buffer.alloc(1024, 0xab),
    thumbBytes: Buffer.alloc(256, 0xcd),
  });
  await adjustUserPhotoQuota({
    targetUserId: activeUser.id,
    photoQuota: 1,
    actor: { actorUserId: admin.id, actorLabel: admin.username, source: 'admin_web' },
  });

  // Active & expired sessions for activeUser
  await createAuthSession(
    activeUser.id,
    hashToken('active_pg_tok'),
    new Date(nowMs + 3600_000).toISOString(),
  );
  await createAuthSession(
    activeUser.id,
    hashToken('expired_pg_tok'),
    new Date(nowMs - 3600_000).toISOString(),
  );

  // Events: app_active, api_key_active, guest_converted, ai_import
  await recordEvent({ userId: activeUser.id, eventType: 'app_active' });
  await recordEvent({ userId: admin.id, eventType: 'api_key_active' });
  await recordEvent({ userId: activeUser.id, eventType: 'guest_converted' });
  await recordEvent({ userId: activeUser.id, eventType: 'ai_import' });

  // API key & Apple Health ingest (1 valid unlinked + 1 rejected)
  await upsertApiKey(activeUser.id, hashToken('liuk_pg_key_1'), 'liuk_pg_key_');
  const ahValidRes = await appleHealthPost(
    new NextRequest('http://localhost:3000/api/integrations/apple-health', {
      method: 'POST',
      headers: {
        authorization: 'Bearer liuk_pg_key_1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workoutType: 'Running',
        startedAt: isoDaysAgo(10),
        durationMinutes: 30,
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(ahValidRes.status, 200);

  const ahInvalidRes = await appleHealthPost(
    new NextRequest('http://localhost:3000/api/integrations/apple-health', {
      method: 'POST',
      headers: {
        authorization: 'Bearer liuk_pg_key_1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ workoutType: 'MissingFields' }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(ahInvalidRes.status, 400);

  // Seed expired guest AFTER appleHealthPost (which ran initial throttled purge)
  const expiredGuest = await createUser({
    id: 'usr_pg_guest_exp',
    username: 'guest_expired_pg',
    displayName: 'Expired Guest',
    passwordHash: '!guest-no-login!',
    isGuest: true,
  });
  await query(
    'UPDATE users SET created_at = $1, last_active_at = $2 WHERE id = $3',
    [isoDaysAgo(3), isoDaysAgo(2), expiredGuest.id],
  );

  // 2. Daily snapshot on real Postgres
  const snapshot = await computeAndSaveDailySnapshot();
  assert.ok(snapshot.totalDbBytes > 0);
  assert.ok(snapshot.tableSizes.some((t) => t.tableName === 'workout_sessions'));
  assert.ok(snapshot.perUserStorage.length >= 4);
  const activeStorage = snapshot.perUserStorage.find(
    (u) => u.userId === activeUser.id,
  );
  assert.ok(activeStorage);
  assert.ok(activeStorage.estimatedDbBytes > 0);
  assert.equal(activeStorage.photoCount, 1);
  assert.equal(activeStorage.photoBytes, 1024 + 256);

  // Idempotent opportunistic check returns cached today snapshot
  const cachedSnap = await ensureDailySnapshotIfDue();
  assert.equal(cachedSnap?.computedAt, snapshot.computedAt);

  // 3. Overview query on real Postgres
  const overview = await getAdminOverview();
  assert.equal(overview.users.registered, 3);
  assert.equal(overview.users.guest, 1);
  assert.equal(overview.activeUsers.hasActivityEvents, true);
  assert.ok(overview.activeUsers.app.d1 >= 1);
  assert.ok(overview.activeUsers.apiKey.d1 >= 1);
  assert.equal(overview.guestConversion.totalConversions, 1);
  assert.ok(overview.churn.inactive30d.some((u) => u.userId === churnedUser.id));
  assert.ok(overview.dailyVolume.length >= 4);
  assert.ok(overview.retentionCohorts.some((c) => c.week0 >= 1 || c.week1 >= 1));

  // 4. Storage report on real Postgres
  const storage = await getAdminStorageReport();
  assert.ok(storage.nearQuotaUsers.some((u) => u.userId === activeUser.id));
  assert.equal(storage.guestFootprint.totalGuests, 1);
  assert.equal(storage.guestFootprint.expiredGuests, 1);
  assert.ok(storage.guestFootprint.reclaimableBytes > 0);

  // 5. User detail (projectCalendar + actual rest + active sessions + audit)
  const detail = await getAdminUserDetail(activeUser.id, {
    actorUserId: admin.id,
    actorLabel: admin.username,
    source: 'admin_web',
  });
  assert.equal(detail.account.activeSessions.length, 1);
  assert.equal(detail.training.totalSessions, 4);
  assert.equal(detail.training.jollySessions, 1);
  assert.equal(detail.training.swapsMade, 1);
  assert.equal(detail.training.skippedDays, 1);
  assert.equal(detail.training.plannedVsCompleted.hasActiveSchedule, true);
  assert.equal(detail.training.plannedVsCompleted.completedDays, 1);
  // avgActualRestSeconds averages [110, 130, 90] = 110 (ignores null!)
  assert.equal(detail.loggingBehaviour.avgActualRestSeconds, 110);
  assert.equal(detail.loggingBehaviour.repQualitySharePct, 100);
  assert.ok(detail.featuresUsed.appleHealth.lastReceivedAt !== null);

  // 6. Adoption report (Apple Health uses last_received_at, not just enabled=1!)
  const adoption = await getAdminAdoptionReport();
  const ahFeature = adoption.features.find((f) => f.key === 'apple_health');
  assert.equal(ahFeature?.everUsers, 1); // ONLY activeUser, not admin/churned whose apple_fitness_enabled=1
  const aiFeature = adoption.features.find((f) => f.key === 'ai_import');
  assert.equal(aiFeature?.everUsers, 1);
  assert.ok(
    adoption.catalogUsage.customExerciseCandidates.some(
      (c) => c.normalizedName === 'pendlay row' && c.userCount === 2,
    ),
  );
  assert.equal(adoption.splitShapes.activeScheduleCount, 1);

  // 7. System health (metrics flush + slow query + pool + ingest + guest purge persistence)
  setSlowQueryThresholdMsForTests(0);
  await query('SELECT id FROM users LIMIT 1');
  setSlowQueryThresholdMsForTests(200);

  recordRequestMetric({
    route: 'health.test.route',
    method: 'POST',
    status: 500,
    durationMs: 42,
    requestId: 'req_test_err',
    errorCode: 'INTERNAL_ERROR',
    errorMessage: 'Failed with token Bearer secret_tok_123',
  });
  recordRequestMetric({
    route: 'health.test.route',
    method: 'POST',
    status: 200,
    durationMs: 10,
  });

  // Force guest purge -> removes expiredGuest AND then run a 0-count purge to verify 0-purge timestamp persistence!
  const purged1 = await purgeExpiredGuestsIfDue(true);
  assert.equal(purged1, 1);
  const purged0 = await purgeExpiredGuestsIfDue(true);
  assert.equal(purged0, 0);

  const health = await getAdminSystemHealth(24);
  const routeStat = health.requests.routes.find(
    (r) => r.route === 'health.test.route',
  );
  assert.equal(routeStat?.requestCount, 2);
  assert.equal(routeStat?.error5xxCount, 1);
  assert.ok(
    health.errors.some(
      (e) =>
        e.route === 'health.test.route' &&
        e.message.includes('Bearer ***') &&
        !e.message.includes('secret_tok_123'),
    ),
  );
  assert.ok(health.database.slowQueries.length >= 1);
  assert.ok(health.ingest.receivedCount >= 1);
  assert.ok(health.ingest.rejectedCount >= 1);
  assert.equal(health.ingest.unlinkedWorkouts, 1);
  assert.ok(health.guestPurge.lastRunAt !== null);
  assert.equal(health.guestPurge.lastPurgedCount, 0);
  assert.equal(health.guestPurge.totalPurgedCount, 1);

  // 8. Real CLI subprocess execution: `node scripts/reset-password.mjs <username>`
  const scriptPath = path.resolve(process.cwd(), 'scripts/reset-password.mjs');

  // Verify rejecting extra password CLI argument
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [scriptPath, activeUser.username, 'badpass'], {
        env: { ...process.env, DATABASE_URL: ctx.connectionString },
      }),
  );

  const cliExec = await execFileAsync(
    process.execPath,
    [scriptPath, activeUser.username],
    {
      env: { ...process.env, DATABASE_URL: ctx.connectionString },
    },
  );
  const cliLines = cliExec.stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const printedTempPassword = cliLines[cliLines.length - 1];
  assert.ok(printedTempPassword && printedTempPassword.length >= 16);

  const userRowAfterCli = await queryOne<{
    password_hash: string;
    must_change_password: number;
  }>('SELECT password_hash, must_change_password FROM users WHERE id = $1', [
    activeUser.id,
  ]);
  assert.equal(userRowAfterCli?.must_change_password, 1);
  assert.equal(
    await verifyPassword(printedTempPassword, userRowAfterCli!.password_hash),
    true,
  );

  const remainingSessions = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM auth_sessions WHERE user_id = $1',
    [activeUser.id],
  );
  assert.equal(Number(remainingSessions?.cnt ?? 0), 0);

  const cliAudit = await queryOne<{ source: string; action: string }>(
    "SELECT source, action FROM audit_log WHERE target_user_id = $1 AND action = 'password_reset' ORDER BY created_at DESC LIMIT 1",
    [activeUser.id],
  );
  assert.equal(cliAudit?.source, 'cli');

  // Privacy check on real-Postgres payloads
  const serializedAll = JSON.stringify({
    overview,
    storage,
    detail,
    adoption,
    health,
  });
  assert.ok(!serializedAll.includes('PRIVATE_PG_NOTE'));
  assert.ok(!serializedAll.includes('PRIVATE_PG_EX_NOTE'));
  assert.ok(!serializedAll.includes('SECRET_PLAN_NOTE'));
  assert.ok(!serializedAll.includes('active_pg_tok'));

  void updateUserSettings;
});
