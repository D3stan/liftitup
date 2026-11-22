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
const { middleware } = await import('@/middleware');
const { setTestPool, closeDb, query, queryOne } = await import(
  '@/lib/db/connection'
);
const { initSchema } = await import('@/lib/db/schema');
const { createUser, getUserById, getUserByUsername } = await import(
  '@/lib/db/users'
);
const {
  createAuthSession,
  getApiKeyByUserId,
  upsertApiKey,
} = await import('@/lib/db/sessions');
const { createProgressPhoto, getUserPhotoQuota } = await import(
  '@/lib/db/photos'
);
const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
const { generateApiKey, hashToken, optionalAuth, SESSION_COOKIE_NAME } =
  await import('@/lib/auth/session');
const { buildUserExportJson, buildUserExportCsv } = await import(
  '@/lib/export/exportData'
);
const {
  isAdminUser,
  parseAdminUserIds,
  resetActivityThrottleForTests,
  resetMetricsBufferForTests,
  resetSnapshotThrottleForTests,
  resetUserPassword,
  recordEvent,
  listAuditLog,
} = await import('@/lib/admin');
const { parseResetCliArgs } = await import(
  pathToFileURL(path.resolve(process.cwd(), 'scripts/reset-password.mjs')).href
);

const { POST: loginPost } = await import('@/app/api/auth/login/route');
const { POST: registerPost } = await import('@/app/api/auth/register/route');
const { POST: guestPost } = await import('@/app/api/auth/guest/route');
const { GET: meGet } = await import('@/app/api/auth/me/route');
const { POST: logoutPost } = await import('@/app/api/auth/logout/route');
const { POST: changePasswordPost } = await import(
  '@/app/api/auth/change-password/route'
);
const { GET: settingsGet } = await import('@/app/api/settings/route');
const { POST: settingsApiKeyPost } = await import(
  '@/app/api/settings/api-key/route'
);
const { POST: mcpPost } = await import('@/app/api/mcp/route');
const { resetRateLimitForTests } = await import('@/lib/api/rateLimit');
const { GET: adminOverviewGet } = await import('@/app/api/admin/overview/route');
const { GET: adminStorageGet } = await import('@/app/api/admin/storage/route');
const { GET: adminAdoptionGet } = await import('@/app/api/admin/adoption/route');
const { GET: adminHealthGet } = await import('@/app/api/admin/health/route');
const { GET: adminAuditGet } = await import('@/app/api/admin/audit/route');
const { POST: adminActionsPost } = await import('@/app/api/admin/actions/route');
const { GET: adminUserDetailGet } = await import(
  '@/app/api/admin/users/[id]/route'
);
const { POST: adminUserActionPost } = await import(
  '@/app/api/admin/users/[id]/action/route'
);
const { POST: adminUserExportPost } = await import(
  '@/app/api/admin/users/[id]/export/route'
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
    __isPgMem: true,
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
  options: {
    method?: string;
    cookieToken?: string;
    apiKey?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(options.headers);
  if (options.cookieToken) {
    headers.set('cookie', `${SESSION_COOKIE_NAME}=${options.cookieToken}`);
  }
  if (options.apiKey) {
    headers.set('authorization', `Bearer ${options.apiKey}`);
  }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(options.body);
  }
  return new NextRequest(url, init as never);
}

function assertNoForbiddenSecretsOrContent(
  payload: unknown,
  forbiddenStrings: string[],
  label: string,
): void {
  const forbiddenKeys = new Set([
    'notes',
    'weightKg',
    'weight_kg',
    'fullBytes',
    'full_bytes',
    'thumbBytes',
    'thumb_bytes',
    'passwordHash',
    'password_hash',
    'tokenHash',
    'token_hash',
    'keyHash',
    'key_hash',
    'rawKey',
  ]);

  const walk = (val: unknown, pathStr: string) => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) {
      val.forEach((item, idx) => walk(item, `${pathStr}[${idx}]`));
      return;
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        assert.ok(
          !forbiddenKeys.has(k),
          `${label}: forbidden privacy/secret key "${k}" found at ${pathStr}.${k}`,
        );
        walk(v, `${pathStr}.${k}`);
      }
    }
  };

  walk(payload, '$');
  const serialized = JSON.stringify(payload);
  for (const needle of forbiddenStrings) {
    assert.ok(
      !serialized.includes(needle),
      `${label}: forbidden string "${needle}" leaked in admin response`,
    );
  }
}

test('Phase 10 Admin: access gates (404), CSRF, disabled accounts, password reset, deletion preservation, guest conversion, and privacy walk', async (t) => {
  const pool = createMemPool();
  setTestPool(pool);
  resetActivityThrottleForTests();
  resetMetricsBufferForTests();
  resetSnapshotThrottleForTests();

  const prevAdminEnv = process.env.ADMIN_USER_IDS;
  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdminEnv;
    resetMetricsBufferForTests();
    await closeDb();
  });

  await initSchema(pool);

  // Create admin, regular user, and guest user
  const adminPasswordHash = await hashPassword('adminpass123');
  const adminUser = await createUser({
    id: 'usr_admin_1',
    username: 'owner_admin',
    displayName: 'Owner',
    passwordHash: adminPasswordHash,
    weightKg: 81.5,
  });
  const adminToken = 'tok_admin_session_1';
  await createAuthSession(
    adminUser.id,
    hashToken(adminToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );
  const adminKey = generateApiKey();
  await upsertApiKey(adminUser.id, adminKey.keyHash, adminKey.keyPrefix);

  const memberPasswordHash = await hashPassword('memberpass123');
  const member = await createUser({
    id: 'usr_member_1',
    username: 'alice_member',
    displayName: 'Alice',
    passwordHash: memberPasswordHash,
    weightKg: 88.8,
  });
  const memberToken = 'tok_member_session_1';
  await createAuthSession(
    member.id,
    hashToken(memberToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );
  const memberKey = generateApiKey();
  await upsertApiKey(member.id, memberKey.keyHash, memberKey.keyPrefix);

  const guestUser = await createUser({
    id: 'usr_guest_1',
    username: 'guest_sample_1',
    displayName: 'Guest',
    passwordHash: '!guest-no-login!',
    isGuest: true,
  });
  const guestToken = 'tok_guest_session_1';
  await createAuthSession(
    guestUser.id,
    hashToken(guestToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );

  // Even if guest ID is accidentally placed in ADMIN_USER_IDS, guest can NEVER be admin
  process.env.ADMIN_USER_IDS = `${adminUser.id}, ${guestUser.id}`;
  assert.equal(parseAdminUserIds().has(adminUser.id), true);
  assert.equal(isAdminUser(adminUser), true);
  assert.equal(isAdminUser(member), false);
  assert.equal(isAdminUser(guestUser), false);

  // 1. Middleware lets /admin and /admin/* pass through without redirecting to /welcome
  for (const adminPath of ['/admin', '/admin/storage', `/admin/users/${member.id}`]) {
    const mwRes = middleware(
      makeCookieReq(`http://localhost:3000${adminPath}`),
    );
    assert.equal(mwRes.status, 200);
    assert.equal(mwRes.headers.get('location'), null);
  }
  const appMwRes = middleware(makeCookieReq('http://localhost:3000/settings'));
  assert.equal(appMwRes.status, 307);
  assert.ok(appMwRes.headers.get('location')?.endsWith('/welcome'));

  // 2. Non-admins, guests, unauthenticated, and API-key callers get 404 on every admin API route
  const adminGetRoutes: Array<() => Promise<Response>> = [
    () => adminOverviewGet(makeCookieReq('http://localhost:3000/api/admin/overview'), { params: Promise.resolve({}) }),
    () => adminStorageGet(makeCookieReq('http://localhost:3000/api/admin/storage'), { params: Promise.resolve({}) }),
    () => adminAdoptionGet(makeCookieReq('http://localhost:3000/api/admin/adoption'), { params: Promise.resolve({}) }),
    () => adminHealthGet(makeCookieReq('http://localhost:3000/api/admin/health'), { params: Promise.resolve({}) }),
    () => adminAuditGet(makeCookieReq('http://localhost:3000/api/admin/audit'), { params: Promise.resolve({}) }),
    () =>
      adminUserDetailGet(
        makeCookieReq(`http://localhost:3000/api/admin/users/${member.id}`),
        { params: Promise.resolve({ id: member.id }) },
      ),
  ];

  // Test unauthenticated, non-admin cookie, guest cookie, and admin API key
  const badCreds: Array<{
    label: string;
    cookieToken?: string;
    apiKey?: string;
  }> = [
    { label: 'unauthenticated' },
    { label: 'non-admin cookie', cookieToken: memberToken },
    { label: 'guest cookie', cookieToken: guestToken },
    { label: 'admin API key', apiKey: adminKey.rawKey },
    { label: 'admin cookie + API key header', cookieToken: adminToken, apiKey: adminKey.rawKey },
  ];

  for (const cred of badCreds) {
    // Check GET routes
    const reqs = [
      adminOverviewGet(
        makeCookieReq('http://localhost:3000/api/admin/overview', cred),
        { params: Promise.resolve({}) },
      ),
      adminStorageGet(
        makeCookieReq('http://localhost:3000/api/admin/storage', cred),
        { params: Promise.resolve({}) },
      ),
      adminAdoptionGet(
        makeCookieReq('http://localhost:3000/api/admin/adoption', cred),
        { params: Promise.resolve({}) },
      ),
      adminHealthGet(
        makeCookieReq('http://localhost:3000/api/admin/health', cred),
        { params: Promise.resolve({}) },
      ),
      adminAuditGet(
        makeCookieReq('http://localhost:3000/api/admin/audit', cred),
        { params: Promise.resolve({}) },
      ),
      adminUserDetailGet(
        makeCookieReq(`http://localhost:3000/api/admin/users/${member.id}`, cred),
        { params: Promise.resolve({ id: member.id }) },
      ),
      adminActionsPost(
        makeCookieReq('http://localhost:3000/api/admin/actions', {
          ...cred,
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: { action: 'purge_guests' },
        }),
        { params: Promise.resolve({}) },
      ),
      adminUserActionPost(
        makeCookieReq(
          `http://localhost:3000/api/admin/users/${member.id}/action`,
          {
            ...cred,
            method: 'POST',
            headers: { origin: 'http://localhost:3000' },
            body: { action: 'force_logout' },
          },
        ),
        { params: Promise.resolve({ id: member.id }) },
      ),
      adminUserExportPost(
        makeCookieReq(
          `http://localhost:3000/api/admin/users/${member.id}/export`,
          {
            ...cred,
            method: 'POST',
            headers: { origin: 'http://localhost:3000' },
            body: { reason: 'support request' },
          },
        ),
        { params: Promise.resolve({ id: member.id }) },
      ),
    ];

    const responses = await Promise.all(reqs);
    for (const res of responses) {
      assert.equal(res.status, 404, `Expected 404 for ${cred.label}`);
    }
  }
  void adminGetRoutes;

  // 3. CSRF protection on admin POST routes
  for (const badHeaders of [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site', origin: 'http://localhost:3000' },
    { referer: 'https://evil.example/form' },
    {},
  ] as Array<Record<string, string>>) {
    const res = await adminActionsPost(
      makeCookieReq('http://localhost:3000/api/admin/actions', {
        method: 'POST',
        cookieToken: adminToken,
        headers: badHeaders,
        body: { action: 'purge_guests' },
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(
      res.status,
      403,
      `Expected 403 CSRF rejection for headers ${JSON.stringify(badHeaders)}`,
    );
  }

  // 4. Seed member content & run Privacy Walk across ALL admin API endpoints
  const sessId = `ws_${crypto.randomUUID()}`;
  const weId = `we_${crypto.randomUUID()}`;
  const wsetId = `wset_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  await query(
    `INSERT INTO workout_sessions (
       id, user_id, session_date, is_jolly, title, started_at, completed_at,
       duration_minutes, user_weight_kg, notes
     ) VALUES ($1, $2, '2026-11-10', 0, 'Push Day', $3, $3, 45, 88.8, 'SECRET_SESSION_NOTE')`,
    [sessId, member.id, nowIso],
  );
  await query(
    `INSERT INTO workout_exercises (id, session_id, exercise_id, order_index, notes)
     VALUES ($1, $2, 'barbell-bench-press', 0, 'SECRET_EXERCISE_NOTE')`,
    [weId, sessId],
  );
  await query(
    `INSERT INTO workout_sets (
       id, workout_exercise_id, set_number, weight_kg, reps, rest_seconds,
       actual_rest_seconds, rest_approximate, execution_quality_pct, is_completed, created_at
     ) VALUES ($1, $2, 1, 142.5, 7, 120, 95, 0, 90, 1, $3)`,
    [wsetId, weId, nowIso],
  );
  await createProgressPhoto({
    userId: member.id,
    takenOn: '2026-11-10',
    pose: 'front',
    weightKg: 88.8,
    fullBytes: Buffer.from('SECRET_FULL_PHOTO_BYTES'),
    thumbBytes: Buffer.from('SECRET_THUMB_PHOTO_BYTES'),
  });

  const adminAuthCookie = { cookieToken: adminToken };
  const [ovRes, stRes, adRes, hlRes, udRes] = await Promise.all([
    adminOverviewGet(
      makeCookieReq('http://localhost:3000/api/admin/overview', adminAuthCookie),
      { params: Promise.resolve({}) },
    ),
    adminStorageGet(
      makeCookieReq('http://localhost:3000/api/admin/storage', adminAuthCookie),
      { params: Promise.resolve({}) },
    ),
    adminAdoptionGet(
      makeCookieReq('http://localhost:3000/api/admin/adoption', adminAuthCookie),
      { params: Promise.resolve({}) },
    ),
    adminHealthGet(
      makeCookieReq('http://localhost:3000/api/admin/health', adminAuthCookie),
      { params: Promise.resolve({}) },
    ),
    adminUserDetailGet(
      makeCookieReq(
        `http://localhost:3000/api/admin/users/${member.id}`,
        adminAuthCookie,
      ),
      { params: Promise.resolve({ id: member.id }) },
    ),
  ]);
  const auRes = await adminAuditGet(
    makeCookieReq('http://localhost:3000/api/admin/audit', adminAuthCookie),
    { params: Promise.resolve({}) },
  );

  assert.equal(ovRes.status, 200);
  assert.equal(stRes.status, 200);
  assert.equal(adRes.status, 200);
  assert.equal(hlRes.status, 200);
  assert.equal(udRes.status, 200);
  assert.equal(auRes.status, 200);

  const [ovJson, stJson, adJson, hlJson, udJson, auJson] = await Promise.all([
    ovRes.json(),
    stRes.json(),
    adRes.json(),
    hlRes.json(),
    udRes.json(),
    auRes.json(),
  ]);

  const forbiddenNeedles = [
    'SECRET_SESSION_NOTE',
    'SECRET_EXERCISE_NOTE',
    'SECRET_FULL_PHOTO_BYTES',
    'SECRET_THUMB_PHOTO_BYTES',
    memberKey.rawKey,
    memberKey.keyHash,
    adminKey.rawKey,
    adminKey.keyHash,
    hashToken(memberToken),
    hashToken(adminToken),
    memberPasswordHash,
    adminPasswordHash,
  ];
  assertNoForbiddenSecretsOrContent(ovJson, forbiddenNeedles, 'overview');
  assertNoForbiddenSecretsOrContent(stJson, forbiddenNeedles, 'storage');
  assertNoForbiddenSecretsOrContent(adJson, forbiddenNeedles, 'adoption');
  assertNoForbiddenSecretsOrContent(hlJson, forbiddenNeedles, 'health');
  assertNoForbiddenSecretsOrContent(udJson, forbiddenNeedles, 'userDetail');
  assertNoForbiddenSecretsOrContent(auJson, forbiddenNeedles, 'audit');

  assert.equal(udJson.loggingBehaviour.avgActualRestSeconds, 95);
  assert.equal(udJson.account.activeSessions.length, 1);
  assert.equal(udJson.featuresUsed.photos.count, 1);
  assert.ok(
    auJson.entries.some(
      (e: { action: string; targetUserId: string }) =>
        e.action === 'view_user_detail' && e.targetUserId === member.id,
    ),
  );

  // 5. Disable / Enable user checks across Cookie Auth, API Key Auth, and Login
  const disableRes = await adminUserActionPost(
    makeCookieReq(
      `http://localhost:3000/api/admin/users/${member.id}/action`,
      {
        method: 'POST',
        cookieToken: adminToken,
        headers: { origin: 'http://localhost:3000' },
        body: { action: 'disable', reason: 'abuse check' },
      },
    ),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(disableRes.status, 200);
  const disableData = await disableRes.json();
  assert.equal(disableData.isDisabled, true);
  assert.equal(disableData.revokedSessions, 1);

  // Cookie auth rejected
  const disabledCookieAuth = await optionalAuth(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      cookieToken: memberToken,
    }),
  );
  assert.equal(disabledCookieAuth, null);
  const disabledMeRes = await meGet(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      cookieToken: memberToken,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(disabledMeRes.status, 401);

  // API-key auth rejected
  const disabledApiAuth = await optionalAuth(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      apiKey: memberKey.rawKey,
    }),
  );
  assert.equal(disabledApiAuth, null);

  // Login rejected with 403 for correct password, 401 for wrong password
  const disabledBadPassRes = await loginPost(
    makeCookieReq('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: { username: member.username, password: 'wrongpassword' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(disabledBadPassRes.status, 401);

  const disabledGoodPassRes = await loginPost(
    makeCookieReq('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: { username: member.username, password: 'memberpass123' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(disabledGoodPassRes.status, 403);

  // Re-enable user & verify API key works again
  const enableRes = await adminUserActionPost(
    makeCookieReq(
      `http://localhost:3000/api/admin/users/${member.id}/action`,
      {
        method: 'POST',
        cookieToken: adminToken,
        headers: { origin: 'http://localhost:3000' },
        body: { action: 'enable' },
      },
    ),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(enableRes.status, 200);
  const reenabledApiAuth = await optionalAuth(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      apiKey: memberKey.rawKey,
    }),
  );
  assert.equal(reenabledApiAuth?.user.id, member.id);

  // 6. Adjust photo quota & Revoke API key
  const quotaRes = await adminUserActionPost(
    makeCookieReq(
      `http://localhost:3000/api/admin/users/${member.id}/action`,
      {
        method: 'POST',
        cookieToken: adminToken,
        headers: { origin: 'http://localhost:3000' },
        body: { action: 'adjust_photo_quota', photoQuota: 50 },
      },
    ),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(quotaRes.status, 200);
  assert.equal(await getUserPhotoQuota(member.id), 50);

  const revokeKeyRes = await adminUserActionPost(
    makeCookieReq(
      `http://localhost:3000/api/admin/users/${member.id}/action`,
      {
        method: 'POST',
        cookieToken: adminToken,
        headers: { origin: 'http://localhost:3000' },
        body: { action: 'revoke_api_key' },
      },
    ),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(revokeKeyRes.status, 200);
  assert.equal(await getApiKeyByUserId(member.id), null);

  // 7. Password reset CLI validation + shared core + mustChangePassword flow
  assert.throws(() => parseResetCliArgs([]), /Missing target/);
  assert.throws(
    () => parseResetCliArgs([member.username, 'secret123']),
    /Do not pass a password/,
  );
  assert.throws(
    () => parseResetCliArgs(['--password', 'secret123', member.username]),
    /Do not provide a password/,
  );
  assert.throws(
    () => parseResetCliArgs(['-p', 'secret123', member.username]),
    /Do not provide a password/,
  );
  assert.deepEqual(parseResetCliArgs([member.username]), {
    help: false,
    identifier: member.username,
    lookupBy: 'username',
    reason: null,
  });

  // Guest password reset rejected
  await assert.rejects(
    () =>
      resetUserPassword({
        targetUserId: guestUser.id,
        source: 'cli',
        actorLabel: 'cli',
      }),
    /guest/i,
  );

  // Create fresh session for member before reset
  const preResetToken = 'tok_member_prereset';
  await createAuthSession(
    member.id,
    hashToken(preResetToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );

  const resetRes = await resetUserPassword({
    username: member.username,
    source: 'cli',
    actorLabel: 'cli',
    reason: 'locked out',
  });
  assert.equal(resetRes.revokedSessions, 1);
  assert.ok(resetRes.temporaryPassword.length >= 16);

  // Old session revoked
  const preResetAuth = await optionalAuth(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      cookieToken: preResetToken,
    }),
  );
  assert.equal(preResetAuth, null);

  // User logs in with temporary password -> mustChangePassword = true
  const tempLoginRes = await loginPost(
    makeCookieReq('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: { username: member.username, password: resetRes.temporaryPassword },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(tempLoginRes.status, 200);
  const tempLoginData = await tempLoginRes.json();
  assert.equal(tempLoginData.user.mustChangePassword, true);
  const setCookieHeader = tempLoginRes.headers.get('set-cookie') ?? '';
  const cookieMatch = /liftitup_session=([^;]+)/.exec(setCookieHeader);
  assert.ok(cookieMatch?.[1], 'Expected session cookie after temp password login');
  const tempSessionCookie = cookieMatch[1];

  // API key cannot call /api/auth/change-password
  const newMemberKey = generateApiKey();
  await upsertApiKey(member.id, newMemberKey.keyHash, newMemberKey.keyPrefix);
  const keyChangePwRes = await changePasswordPost(
    makeCookieReq('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      apiKey: newMemberKey.rawKey,
      body: { newPassword: 'brandnewpassword1' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(keyChangePwRes.status, 403);

  // Cookie session changes password & clears must_change_password
  const changePwRes = await changePasswordPost(
    makeCookieReq('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      cookieToken: tempSessionCookie,
      body: { newPassword: 'brandnewpassword1' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(changePwRes.status, 200);
  const changePwData = await changePwRes.json();
  assert.equal(changePwData.user.mustChangePassword, false);

  const memberAfterPw = await getUserByUsername(member.username);
  assert.ok(memberAfterPw);
  assert.equal(
    await verifyPassword('brandnewpassword1', memberAfterPw.passwordHash),
    true,
  );
  assert.equal(
    await verifyPassword(resetRes.temporaryPassword, memberAfterPw.passwordHash),
    false,
  );

  // 8. Audited export requires reason & excludes photos and admin tables
  const noReasonExportRes = await adminUserExportPost(
    makeCookieReq(`http://localhost:3000/api/admin/users/${member.id}/export`, {
      method: 'POST',
      cookieToken: adminToken,
      headers: { origin: 'http://localhost:3000' },
      body: { reason: 'no' },
    }),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(noReasonExportRes.status, 400);

  const validExportRes = await adminUserExportPost(
    makeCookieReq(`http://localhost:3000/api/admin/users/${member.id}/export`, {
      method: 'POST',
      cookieToken: adminToken,
      headers: { origin: 'http://localhost:3000' },
      body: { reason: 'GDPR support request #42' },
    }),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(validExportRes.status, 200);
  const exportBody = await validExportRes.json();
  assert.equal(exportBody.data.sessions.length, 1);
  assert.equal('photos' in exportBody.data, false);
  assert.equal('events' in exportBody.data, false);
  assert.equal('auditLog' in exportBody.data, false);

  // Ordinary user export excludes admin tables too
  const userObj = await getUserById(member.id);
  assert.ok(userObj);
  const userJson = await buildUserExportJson(userObj);
  const userCsv = await buildUserExportCsv(userObj);
  const userJsonText = JSON.stringify(userJson);
  assert.ok(!userJsonText.includes('audit_log'));
  assert.ok(!userJsonText.includes('GDPR support request #42'));
  assert.ok(!userCsv.includes('GDPR support request #42'));

  // 9. Deleting user preserves events and audit_log!
  await recordEvent({
    userId: member.id,
    eventType: 'export',
    detail: { format: 'json' },
  });
  const delUserRes = await adminUserActionPost(
    makeCookieReq(
      `http://localhost:3000/api/admin/users/${member.id}/action`,
      {
        method: 'POST',
        cookieToken: adminToken,
        headers: { origin: 'http://localhost:3000' },
        body: { action: 'delete_user', confirmation: 'DELETE' },
      },
    ),
    { params: Promise.resolve({ id: member.id }) },
  );
  assert.equal(delUserRes.status, 200);
  assert.equal(await getUserById(member.id), null);

  const preservedEvents = await query<{ event_type: string }>(
    'SELECT event_type FROM events WHERE user_id = $1',
    [member.id],
  );
  assert.ok(preservedEvents.rows.length >= 2);
  const preservedAudit = await listAuditLog({ targetUserId: member.id });
  assert.ok(preservedAudit.some((a) => a.action === 'delete_user'));
  assert.ok(preservedAudit.some((a) => a.action === 'export_user_data' && a.reason === 'GDPR support request #42'));
  assert.ok(preservedAudit.some((a) => a.action === 'password_reset'));
  assert.ok(preservedAudit.some((a) => a.action === 'view_user_detail'));

  // 10. Guest-to-registered conversion tracking
  const gRes = await guestPost(
    makeCookieReq('http://localhost:3000/api/auth/guest', {
      method: 'POST',
      body: { timezone: 'UTC' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(gRes.status, 201);
  const gCookie = /liftitup_session=([^;]+)/.exec(
    gRes.headers.get('set-cookie') ?? '',
  )?.[1];
  assert.ok(gCookie);
  const gData = await gRes.json();

  const regConvRes = await registerPost(
    makeCookieReq('http://localhost:3000/api/auth/register', {
      method: 'POST',
      cookieToken: gCookie,
      body: {
        username: 'converted_athlete',
        password: 'password123',
        timezone: 'UTC',
      },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(regConvRes.status, 201);
  const regConvData = await regConvRes.json();

  const convEvents = await query<{ event_type: string; detail_json: string }>(
    "SELECT event_type, detail_json FROM events WHERE user_id = $1 AND event_type = 'guest_converted'",
    [regConvData.user.id],
  );
  assert.equal(convEvents.rows.length, 1);
  assert.ok(convEvents.rows[0].detail_json.includes(gData.user.id));

  // Registering without guest cookie does NOT record guest_converted
  const regPlainRes = await registerPost(
    makeCookieReq('http://localhost:3000/api/auth/register', {
      method: 'POST',
      body: {
        username: 'direct_athlete',
        password: 'password123',
        timezone: 'UTC',
      },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(regPlainRes.status, 201);
  const regPlainData = await regPlainRes.json();
  const nonConvEvents = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*)::int AS cnt FROM events WHERE user_id = $1 AND event_type = 'guest_converted'",
    [regPlainData.user.id],
  );
  assert.equal(Number(nonConvEvents?.cnt ?? 0), 0);
});

test('Phase 10 additive migration adds new columns and admin tables to legacy v2 schema', async (t) => {
  const pool = createMemPool();
  setTestPool(pool);
  t.after(async () => {
    await closeDb();
  });

  await pool.query(`
    CREATE TABLE schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      height_cm DOUBLE PRECISION,
      weight_kg DOUBLE PRECISION NOT NULL DEFAULT 75,
      age INTEGER,
      training_years DOUBLE PRECISION,
      unit TEXT NOT NULL DEFAULT 'kg',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      theme TEXT NOT NULL DEFAULT 'notebook',
      theme_variant TEXT NOT NULL DEFAULT 'light',
      enable_set_quality INTEGER NOT NULL DEFAULT 0,
      rest_clock_mode TEXT NOT NULL DEFAULT 'stopwatch',
      default_workout_view TEXT NOT NULL DEFAULT 'list',
      default_weight_step_kg DOUBLE PRECISION,
      apple_fitness_enabled INTEGER NOT NULL DEFAULT 1,
      apple_health_last_received_at TEXT,
      apple_health_last_received_kind TEXT,
      apple_health_last_received_linked INTEGER,
      photo_quota INTEGER,
      is_guest INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE apple_health_workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workout_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      active_calories INTEGER,
      avg_heart_rate INTEGER,
      max_heart_rate INTEGER,
      bodyweight_kg DOUBLE PRECISION,
      linked_session_id TEXT,
      source TEXT NOT NULL DEFAULT 'shortcut_webhook',
      created_at TEXT NOT NULL
    );
  `);

  await initSchema(pool);

  const user = await createUser({
    id: 'usr_legacy_p10',
    username: 'legacy_p10',
    displayName: 'Legacy',
    passwordHash: 'hash',
  });
  assert.equal(user.isDisabled, false);
  assert.equal(user.mustChangePassword, false);

  const tablesRes = await query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const tableSet = new Set(tablesRes.rows.map((r) => r.table_name.toLowerCase()));
  for (const tbl of [
    'events',
    'audit_log',
    'daily_snapshots',
    'request_metric_buckets',
    'app_errors',
    'system_state',
  ]) {
    assert.ok(tableSet.has(tbl), `Expected table ${tbl} to be created`);
  }
});

test('Phase 10 Audit fixes: mustChangePassword server/API/admin enforcement & concurrent duplicate register returns 409', async (t) => {
  const pool = createMemPool();
  setTestPool(pool);
  resetActivityThrottleForTests();
  resetMetricsBufferForTests();
  resetSnapshotThrottleForTests();
  resetRateLimitForTests();

  const prevAdminEnv = process.env.ADMIN_USER_IDS;
  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdminEnv;
    resetMetricsBufferForTests();
    resetRateLimitForTests();
    await closeDb();
  });

  await initSchema(pool);

  // 1. Concurrent duplicate username registrations return 201 and 409 (never 500)
  const [reg1, reg2] = await Promise.all([
    registerPost(
      makeCookieReq('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: { username: 'Race_User', password: 'password123' },
      }),
      { params: Promise.resolve({}) },
    ),
    registerPost(
      makeCookieReq('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: { username: ' race_user ', password: 'password123' },
      }),
      { params: Promise.resolve({}) },
    ),
  ]);
  const statuses = [reg1.status, reg2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409]);
  const conflictRes = reg1.status === 409 ? reg1 : reg2;
  const conflictBody = (await conflictRes.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(conflictBody.error.code, 'CONFLICT');

  // 2. mustChangePassword blocks APIs, API-key minting, MCP, and admin APIs until password changed
  const adminUser = await createUser({
    id: 'usr_mcpw_admin',
    username: 'mcpw_admin',
    displayName: 'Admin',
    passwordHash: await hashPassword('adminpass123'),
  });
  process.env.ADMIN_USER_IDS = adminUser.id;

  // Create API key BEFORE reset
  const preResetKey = generateApiKey();
  await upsertApiKey(adminUser.id, preResetKey.keyHash, preResetKey.keyPrefix);

  const resetRes = await resetUserPassword({
    username: adminUser.username,
    source: 'cli',
    actorLabel: 'cli',
    reason: 'security test',
  });

  const loginRes = await loginPost(
    makeCookieReq('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: { username: adminUser.username, password: resetRes.temporaryPassword },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(loginRes.status, 200);
  const cookieMatch = /liftitup_session=([^;]+)/.exec(
    loginRes.headers.get('set-cookie') ?? '',
  );
  assert.ok(cookieMatch?.[1]);
  const tempCookie = cookieMatch[1];

  // /api/auth/me stays accessible and reports mustChangePassword=true
  const meRes = await meGet(
    makeCookieReq('http://localhost:3000/api/auth/me', {
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(meRes.status, 200);
  const meJson = (await meRes.json()) as { user: { mustChangePassword: boolean } };
  assert.equal(meJson.user.mustChangePassword, true);

  // App APIs, API-key minting, MCP, and admin APIs all return 403 PASSWORD_CHANGE_REQUIRED
  const settingsRes = await settingsGet(
    makeCookieReq('http://localhost:3000/api/settings', {
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(settingsRes.status, 403);
  assert.equal(
    ((await settingsRes.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  const mintKeyRes = await settingsApiKeyPost(
    makeCookieReq('http://localhost:3000/api/settings/api-key', {
      method: 'POST',
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(mintKeyRes.status, 403);
  assert.equal(
    ((await mintKeyRes.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  const keySettingsRes = await settingsGet(
    makeCookieReq('http://localhost:3000/api/settings', {
      apiKey: preResetKey.rawKey,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(keySettingsRes.status, 403);
  assert.equal(
    ((await keySettingsRes.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  const mcpBlockedRes = await mcpPost(
    new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${preResetKey.rawKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(mcpBlockedRes.status, 403);
  assert.equal(
    ((await mcpBlockedRes.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  const adminOverviewBlocked = await adminOverviewGet(
    makeCookieReq('http://localhost:3000/api/admin/overview', {
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(adminOverviewBlocked.status, 403);
  assert.equal(
    ((await adminOverviewBlocked.json()) as { error: { code: string } }).error.code,
    'PASSWORD_CHANGE_REQUIRED',
  );

  // Changing password clears the gate and restores access
  const pwChangeRes = await changePasswordPost(
    makeCookieReq('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      cookieToken: tempCookie,
      body: { newPassword: 'new_secure_password_123' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(pwChangeRes.status, 200);

  const settingsAfterRes = await settingsGet(
    makeCookieReq('http://localhost:3000/api/settings', {
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(settingsAfterRes.status, 200);

  const adminAfterRes = await adminOverviewGet(
    makeCookieReq('http://localhost:3000/api/admin/overview', {
      cookieToken: tempCookie,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(adminAfterRes.status, 200);

  // /api/auth/logout works even when mustChangePassword is true
  await resetUserPassword({
    username: adminUser.username,
    source: 'cli',
    actorLabel: 'cli',
    reason: 'logout test',
  });
  const loginRes2 = await loginPost(
    makeCookieReq('http://localhost:3000/api/auth/login', {
      method: 'POST',
      body: { username: adminUser.username, password: (await resetUserPassword({ username: adminUser.username, source: 'cli', actorLabel: 'cli', reason: 'logout test 2' })).temporaryPassword },
    }),
    { params: Promise.resolve({}) },
  );
  const cookie2 = /liftitup_session=([^;]+)/.exec(
    loginRes2.headers.get('set-cookie') ?? '',
  )?.[1];
  assert.ok(cookie2);
  const logoutRes = await logoutPost(
    makeCookieReq('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      cookieToken: cookie2,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(logoutRes.status, 200);
});
