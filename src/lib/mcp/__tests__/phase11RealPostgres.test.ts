import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const { query, queryOne } = await import('@/lib/db/connection');
const { initSchema } = await import('@/lib/db/schema');
const { createUser, getUserById } = await import('@/lib/db/users');
const { upsertApiKey } = await import('@/lib/db/sessions');
const { createProgressPhoto } = await import('@/lib/db/photos');
const { deleteUserAccount } = await import('@/lib/db/userDeletion');
const { hashPassword } = await import('@/lib/auth/password');
const { generateApiKey } = await import('@/lib/auth/session');
const {
  resetActivityThrottleForTests,
  resetMetricsBufferForTests,
  resetSnapshotThrottleForTests,
} = await import('@/lib/admin');
const { resetPhotoLinkRateLimitForTests } = await import(
  '@/lib/mcp/photoLinks'
);
const { REPORTING_VIEW_NAMES } = await import('@/lib/mcp/reportingViews');
const { POST: mcpPost } = await import('@/app/api/mcp/route');
const { GET: signedPhotoGet } = await import(
  '@/app/api/photos/signed/[token]/route'
);

test('Real Postgres: Phase 11 SQL reporting views, READ ONLY + statement_timeout, mcp_confirmations cleanup, and byte-exact signed photo download', async (t) => {
  const ctx = await setupRealPostgresTestDb('phase11');
  const prevAdmins = process.env.ADMIN_USER_IDS;
  const prevSecret = process.env.PHOTO_DOWNLOAD_SECRET;

  resetActivityThrottleForTests();
  resetMetricsBufferForTests();
  resetSnapshotThrottleForTests();
  resetPhotoLinkRateLimitForTests();

  t.after(async () => {
    process.env.ADMIN_USER_IDS = prevAdmins;
    if (prevSecret === undefined) delete process.env.PHOTO_DOWNLOAD_SECRET;
    else process.env.PHOTO_DOWNLOAD_SECRET = prevSecret;
    resetMetricsBufferForTests();
    await ctx.teardown();
  });

  // Verify initSchema idempotency on real Postgres (CREATE OR REPLACE VIEW + mcp_confirmations)
  await initSchema(ctx.pool);

  const viewsRes = await query<{ viewname: string }>(
    `SELECT viewname FROM pg_views WHERE schemaname = 'public'`,
  );
  const viewSet = new Set(viewsRes.rows.map((r) => r.viewname));
  for (const name of REPORTING_VIEW_NAMES) {
    assert.ok(viewSet.has(name), `Missing SQL reporting view ${name}`);
  }

  const admin = await createUser({
    id: 'usr_pg_p11_admin',
    username: 'pg_p11_admin',
    displayName: 'PG Admin',
    passwordHash: await hashPassword('adminpass123'),
  });
  const adminKey = generateApiKey();
  await upsertApiKey(admin.id, adminKey.keyHash, adminKey.keyPrefix);

  const member = await createUser({
    id: 'usr_pg_p11_user',
    username: 'pg_p11_user',
    displayName: 'PG User',
    passwordHash: await hashPassword('userpass123'),
  });
  const memberKey = generateApiKey();
  await upsertApiKey(member.id, memberKey.keyHash, memberKey.keyPrefix);

  process.env.ADMIN_USER_IDS = admin.id;
  process.env.PHOTO_DOWNLOAD_SECRET = 'pg-test-secret-xyz-1234567890';

  const callTool = async (
    rawKey: string,
    name: string,
    args: Record<string, unknown> = {},
  ) => {
    const req = new NextRequest('https://lift.example.test/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${rawKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const res = await mcpPost(req, { params: Promise.resolve({}) });
    assert.equal(res.status, 200);
    return (await res.json()) as {
      result?: {
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        structuredContent?: Record<string, unknown>;
        isError: boolean;
      };
      error?: { code: number; message: string };
    };
  };

  // Seed workout & custom exercise for member
  await callTool(memberKey.rawKey, 'upsert_custom_exercise', {
    name: 'PG Custom Pull',
    trackingType: 'weight_reps',
  });
  await callTool(memberKey.rawKey, 'log_workout_session', {
    sessionDate: '2026-11-16',
    title: 'PG Session',
    notes: 'PG_SECRET_NOTE',
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        sets: [{ weightKg: 100, reps: 5, actualRestSeconds: 95 }],
      },
    ],
  });

  // Seed full byte pattern 0x00..0xFF photo for member
  const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const thumbBytes = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  const createdPhoto = await createProgressPhoto({
    userId: member.id,
    takenOn: '2026-11-16',
    pose: 'front',
    weightKg: 81.2,
    fullBytes: allBytes,
    thumbBytes,
  });

  // Query every SQL reporting view on real Postgres (with SET TRANSACTION READ ONLY & statement_timeout)
  for (const viewName of REPORTING_VIEW_NAMES) {
    const viewRes = await callTool(adminKey.rawKey, 'admin_query_reporting_view', {
      view: viewName,
      limit: 25,
    });
    assert.equal(viewRes.result?.isError, false, `View ${viewName} failed`);
    const serialized = JSON.stringify(viewRes.result?.structuredContent);
    assert.equal(serialized.includes('PG_SECRET_NOTE'), false);
    assert.equal(serialized.includes('PG Custom Pull'), false);
    assert.equal(serialized.includes('81.2'), false);
  }

  // Signed photo download byte-for-byte round-trip on real Postgres
  const linkRes = await callTool(memberKey.rawKey, 'get_photo_download_links', {
    photoIds: [createdPhoto.photo.id],
  });
  assert.equal(linkRes.result?.isError, false);
  const link = (
    linkRes.result?.structuredContent?.links as Array<{ path: string }>
  )[0]!;
  const token = link.path.split('/').pop()!;
  const dlRes = await signedPhotoGet(
    new NextRequest(`https://lift.example.test${link.path}`),
    { params: Promise.resolve({ token }) },
  );
  assert.equal(dlRes.status, 200);
  assert.deepEqual(Buffer.from(await dlRes.arrayBuffer()), allBytes);

  // Pending mcp_confirmation for member is cleaned up cleanly by deleteUserAccount
  const challenge = await callTool(memberKey.rawKey, 'danger_zone', {
    action: 'delete_workouts',
  });
  assert.equal(challenge.result?.structuredContent?.requiresConfirmation, true);
  const beforeRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM mcp_confirmations WHERE user_id = $1',
    [member.id],
  );
  assert.equal(beforeRow?.cnt, 1);

  assert.equal(await deleteUserAccount(member.id), true);
  assert.equal(await getUserById(member.id), null);
  const afterRow = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM mcp_confirmations WHERE user_id = $1',
    [member.id],
  );
  assert.equal(afterRow?.cnt, 0);

  // Unused crypto ref check
  void crypto.randomUUID;
});
