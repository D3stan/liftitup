import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
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
const { setTestPool, closeDb, pingDb, query, queryOne } = await import(
  '@/lib/db/connection'
);
const { createUser, getUserById } = await import('@/lib/db/users');
const { createAuthSession, upsertApiKey } = await import('@/lib/db/sessions');
const { generateApiKey, hashToken, SESSION_COOKIE_NAME } = await import(
  '@/lib/auth/session'
);
const { createGuestSandbox } = await import('@/lib/auth/sandbox');
const { recordBodyMetric } = await import('@/lib/db/bodyMetrics');
const { deleteUserAccount, deleteUserBodyData } = await import(
  '@/lib/db/userDeletion'
);
const {
  computeOutputDimensions,
  computePortrait3x4CropRect,
} = await import('@/lib/photos/clientImage');
const { DEFAULT_PHOTO_QUOTA, MAX_PHOTO_BYTES } = await import(
  '@/lib/photos/constants'
);
const { buildUserExportCsv, buildUserExportJson } = await import(
  '@/lib/export'
);
const { applyLiftitupRestore } = await import(
  '@/lib/imports/liftitupRestore'
);
const { filterSettingsItems } = await import('@/lib/settings/registry');
const { GET: photosListGet, POST: photosPost } = await import(
  '@/app/api/photos/route'
);
const { GET: photoGet, DELETE: photoDelete } = await import(
  '@/app/api/photos/[id]/route'
);
const { GET: photoArchiveGet } = await import('@/app/api/photos/archive/route');

function setupInstrumentedMemPool() {
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const innerPool = new pgAdapter.Pool();
  const sqlLog: string[] = [];

  const wrapClient = (client: PoolClient) =>
    ({
      async query(sql: string, params?: unknown[]) {
        sqlLog.push(sql.trim());
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

  const pool = {
    constructor: innerPool.constructor,
    async connect() {
      const c = await innerPool.connect();
      return wrapClient(c);
    },
    async query(sql: string, params?: unknown[]) {
      sqlLog.push(sql.trim());
      return params && params.length > 0
        ? innerPool.query(sql, params)
        : innerPool.query(sql);
    },
    async end() {
      await innerPool.end();
    },
  } as unknown as Pool;

  setTestPool(pool);
  return { pool, sqlLog };
}

async function createAuthedUser(username: string) {
  const user = await createUser({
    username,
    displayName: username,
    passwordHash: 'hash',
    unit: 'kg',
    timezone: 'UTC',
  });
  const rawToken = `tok_${crypto.randomBytes(12).toString('hex')}`;
  await createAuthSession(
    user.id,
    hashToken(rawToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );
  const key = generateApiKey();
  await upsertApiKey(user.id, key.keyHash, key.keyPrefix);
  return { user, rawToken, apiKey: key.rawKey };
}

function makeSessionReq(
  url: string,
  rawToken: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit },
) {
  const headers = new Headers(init?.headers);
  headers.set('cookie', `${SESSION_COOKIE_NAME}=${rawToken}`);
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body,
  });
}

function makeUploadFormData(opts: {
  pose: string;
  takenOn?: string;
  fullBytes?: Buffer;
  thumbBytes?: Buffer;
  photoType?: string;
  omitThumb?: boolean;
}) {
  const fd = new FormData();
  fd.set('pose', opts.pose);
  if (opts.takenOn) fd.set('takenOn', opts.takenOn);
  const full = opts.fullBytes ?? Buffer.from('ascii-jpeg-full-bytes');
  fd.set(
    'photo',
    new File([new Uint8Array(full)], 'photo.jpg', {
      type: opts.photoType ?? 'image/jpeg',
    }),
  );
  if (!opts.omitThumb) {
    const thumb = opts.thumbBytes ?? Buffer.from('ascii-jpeg-thumb-bytes');
    fd.set(
      'thumbnail',
      new File([new Uint8Array(thumb)], 'thumb.jpg', { type: 'image/jpeg' }),
    );
  }
  fd.set('width', '1500');
  fd.set('height', '2000');
  return fd;
}

function extractZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= 0; i -= 1) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End of Central Directory not found');
  const cdCount = zipBuf.readUInt16LE(eocdOffset + 10);
  let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const files = new Map<string, Buffer>();
  for (let i = 0; i < cdCount; i += 1) {
    assert.equal(zipBuf.readUInt32LE(cdOffset), 0x02014b50);
    const method = zipBuf.readUInt16LE(cdOffset + 10);
    const compSize = zipBuf.readUInt32LE(cdOffset + 20);
    const nameLen = zipBuf.readUInt16LE(cdOffset + 28);
    const extraLen = zipBuf.readUInt16LE(cdOffset + 30);
    const commentLen = zipBuf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42);
    const name = zipBuf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);

    assert.equal(zipBuf.readUInt32LE(localHeaderOffset), 0x04034b50);
    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const raw = zipBuf.subarray(dataStart, dataStart + compSize);
    const content = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    files.set(name, content);

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test('computePortrait3x4CropRect and computeOutputDimensions produce centered 3:4 crops', () => {
  // 16:9 landscape (1920x1080) -> height 1080, width 810, centered horizontally
  const landscape = computePortrait3x4CropRect(1920, 1080);
  assert.deepEqual(landscape, { sx: 555, sy: 0, sw: 810, sh: 1080 });

  // 1:1 square (1200x1200) -> 900x1200 centered horizontally
  const square = computePortrait3x4CropRect(1200, 1200);
  assert.deepEqual(square, { sx: 150, sy: 0, sw: 900, sh: 1200 });

  // 9:16 portrait (1080x1920) -> 1080x1440 centered vertically
  const tall = computePortrait3x4CropRect(1080, 1920);
  assert.deepEqual(tall, { sx: 0, sy: 240, sw: 1080, sh: 1440 });

  // Resize caps at maxLongEdge without upscaling
  assert.deepEqual(computeOutputDimensions(3000, 4000, 2000), {
    width: 1500,
    height: 2000,
  });
  assert.deepEqual(computeOutputDimensions(900, 1200, 2000), {
    width: 900,
    height: 1200,
  });
  assert.deepEqual(computeOutputDimensions(1500, 2000, 300), {
    width: 225,
    height: 300,
  });
});

test('Phase 8 routes enforce session-cookie auth, guest blocking, security headers, size limits, quota, isolation, archive, and deletion rules', async () => {
  const { sqlLog } = setupInstrumentedMemPool();
  await pingDb();

  const u1 = await createAuthedUser('alice_p8');
  const u2 = await createAuthedUser('bob_p8');
  const guestUser = await createGuestSandbox('UTC');
  const guestRawToken = `gtok_${crypto.randomBytes(12).toString('hex')}`;
  await createAuthSession(
    guestUser.id,
    hashToken(guestRawToken),
    new Date(Date.now() + 3600_000).toISOString(),
  );
  const guest = { user: guestUser, rawToken: guestRawToken };

  // Seed body weights on 2026-11-10 for Alice (testing source precedence attachment)
  await recordBodyMetric({
    userId: u1.user.id,
    measuredOn: '2026-11-10',
    weightKg: 78.2,
    source: 'apple_health',
    createdAt: '2026-11-10T08:00:00.000Z',
  });
  await recordBodyMetric({
    userId: u1.user.id,
    measuredOn: '2026-11-10',
    weightKg: 77.5,
    source: 'manual',
    createdAt: '2026-11-10T07:00:00.000Z',
  });

  // 1. Auth checks: unauthenticated -> 401; API keys -> 403; guest -> 403
  const unauthGet = await photosListGet(
    new NextRequest('http://localhost/api/photos'),
    { params: Promise.resolve({}) },
  );
  assert.equal(unauthGet.status, 401);

  const apiKeyHeadersList: Array<Record<string, string>> = [
    { authorization: `Bearer ${u1.apiKey}` },
    { 'x-api-key': u1.apiKey },
  ];
  for (const headers of apiKeyHeadersList) {
    const keyList = await photosListGet(
      new NextRequest('http://localhost/api/photos', { headers }),
      { params: Promise.resolve({}) },
    );
    assert.equal(keyList.status, 403);

    const keyArchive = await photoArchiveGet(
      new NextRequest('http://localhost/api/photos/archive', { headers }),
      { params: Promise.resolve({}) },
    );
    assert.equal(keyArchive.status, 403);
  }

  const guestList = await photosListGet(
    makeSessionReq('http://localhost/api/photos', guest.rawToken),
    { params: Promise.resolve({}) },
  );
  assert.equal(guestList.status, 403);

  const guestArchive = await photoArchiveGet(
    makeSessionReq('http://localhost/api/photos/archive', guest.rawToken),
    { params: Promise.resolve({}) },
  );
  assert.equal(guestArchive.status, 403);

  // 2. Oversize Content-Length rejected with 413 before body parse
  const bigHeaderRes = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      headers: { 'content-length': String(10 * 1024 * 1024) },
      body: makeUploadFormData({ pose: 'front', takenOn: '2026-11-10' }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(bigHeaderRes.status, 413);

  // 3. Oversize actual photo bytes (> 2 MB) rejected with 413
  const oversizedBytes = Buffer.alloc(MAX_PHOTO_BYTES + 1, 0x41);
  const bigBodyRes = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      body: makeUploadFormData({
        pose: 'front',
        takenOn: '2026-11-10',
        fullBytes: oversizedBytes,
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(bigBodyRes.status, 413);

  // 4. Upload crafted "text/html" photo on 2026-11-10 -> stored with resolved manual weight 77.5
  const htmlPayload = Buffer.from('<script>alert(1)</script>');
  const upload1Res = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      body: makeUploadFormData({
        pose: 'front',
        takenOn: '2026-11-10',
        fullBytes: htmlPayload,
        photoType: 'text/html',
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(upload1Res.status, 201);
  const upload1Json = (await upload1Res.json()) as {
    photo: { id: string; weightKg: number | null; byteSize: number; thumbByteSize: number };
    quota: { used: number; limit: number };
  };
  assert.equal(upload1Json.photo.weightKg, 77.5);
  assert.equal(upload1Json.photo.byteSize, htmlPayload.byteLength);
  assert.equal(upload1Json.quota.used, 1);
  assert.equal(upload1Json.quota.limit, DEFAULT_PHOTO_QUOTA);

  // Second upload on same date & pose (to test filename disambiguation) + no weight on 2026-11-11
  const upload2Res = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      body: makeUploadFormData({
        pose: 'front',
        takenOn: '2026-11-10',
        fullBytes: Buffer.from('front-second-same-day'),
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(upload2Res.status, 201);

  const upload3Res = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      body: makeUploadFormData({
        pose: 'side',
        takenOn: '2026-11-11',
        fullBytes: Buffer.from('side-no-weight'),
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(upload3Res.status, 201);
  const upload3Json = (await upload3Res.json()) as {
    photo: { id: string; weightKg: number | null };
  };
  assert.equal(upload3Json.photo.weightKg, null);

  // Bob uploads a photo (must stay isolated from Alice)
  const bobUploadRes = await photosPost(
    makeSessionReq('http://localhost/api/photos', u2.rawToken, {
      method: 'POST',
      body: makeUploadFormData({
        pose: 'back',
        takenOn: '2026-11-10',
        fullBytes: Buffer.from('bob-secret-photo'),
      }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(bobUploadRes.status, 201);
  const bobPhotoId = ((await bobUploadRes.json()) as { photo: { id: string } }).photo.id;

  // 5. GET /api/photos never queries progress_photo_blobs and filters by pose while keeping total quota
  sqlLog.length = 0;
  const listSideRes = await photosListGet(
    makeSessionReq('http://localhost/api/photos?pose=side', u1.rawToken),
    { params: Promise.resolve({}) },
  );
  assert.equal(listSideRes.status, 200);
  const listSideJson = (await listSideRes.json()) as {
    photos: Array<{ id: string; pose: string }>;
    quota: { used: number; limit: number };
  };
  assert.equal(listSideJson.photos.length, 1);
  assert.equal(listSideJson.photos[0].pose, 'side');
  assert.equal(listSideJson.quota.used, 3);
  assert.equal(
    sqlLog.some((s) => s.toLowerCase().includes('progress_photo_blobs')),
    false,
    'Metadata list query must never touch progress_photo_blobs',
  );

  // 6. Security headers + fixed image/jpeg content-type + cross-user 404 + API key refusal on fetch
  const ownerFetchRes = await photoGet(
    makeSessionReq(
      `http://localhost/api/photos/${upload1Json.photo.id}`,
      u1.rawToken,
    ),
    { params: Promise.resolve({ id: upload1Json.photo.id }) },
  );
  assert.equal(ownerFetchRes.status, 200);
  assert.equal(ownerFetchRes.headers.get('content-type'), 'image/jpeg');
  assert.equal(ownerFetchRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ownerFetchRes.headers.get('cache-control'), 'private, no-store');

  const downloadFetchRes = await photoGet(
    makeSessionReq(
      `http://localhost/api/photos/${upload1Json.photo.id}?download=1`,
      u1.rawToken,
    ),
    { params: Promise.resolve({ id: upload1Json.photo.id }) },
  );
  assert.equal(downloadFetchRes.status, 200);
  assert.equal(
    downloadFetchRes.headers.get('content-disposition'),
    'attachment; filename="liftitup-2026-11-10-front.jpg"',
  );

  const bobFetchingAlice = await photoGet(
    makeSessionReq(
      `http://localhost/api/photos/${upload1Json.photo.id}`,
      u2.rawToken,
    ),
    { params: Promise.resolve({ id: upload1Json.photo.id }) },
  );
  assert.equal(bobFetchingAlice.status, 404);

  const keyFetchingPhoto = await photoGet(
    new NextRequest(`http://localhost/api/photos/${upload1Json.photo.id}`, {
      headers: { authorization: `Bearer ${u1.apiKey}` },
    }),
    { params: Promise.resolve({ id: upload1Json.photo.id }) },
  );
  assert.equal(keyFetchingPhoto.status, 403);

  // 7. Archive contains ONLY caller's photos + index.json + index.csv
  const archiveRes = await photoArchiveGet(
    makeSessionReq('http://localhost/api/photos/archive', u1.rawToken),
    { params: Promise.resolve({}) },
  );
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.headers.get('content-type'), 'application/zip');
  assert.equal(archiveRes.headers.get('cache-control'), 'private, no-store');
  assert.equal(archiveRes.headers.get('x-content-type-options'), 'nosniff');
  const zipBuf = Buffer.from(await archiveRes.arrayBuffer());
  const entries = extractZipEntries(zipBuf);
  assert.equal(entries.has('photos/2026-11-10-front.jpg'), true);
  assert.equal(entries.has('photos/2026-11-10-front-2.jpg'), true);
  assert.equal(entries.has('photos/2026-11-11-side.jpg'), true);
  assert.equal(entries.has('photos/2026-11-10-back.jpg'), false);
  const indexJson = JSON.parse(entries.get('index.json')!.toString('utf8')) as {
    count: number;
    photos: Array<{ filename: string; weightKg: number | null }>;
  };
  assert.equal(indexJson.count, 3);
  assert.equal(indexJson.photos[0].weightKg, 77.5);
  assert.ok(entries.get('index.csv')!.toString('utf8').includes('2026-11-10,front,77.5'));

  // 8. Quota enforcement (override Alice's photo_quota to 3, next upload -> 409)
  await query('UPDATE users SET photo_quota = 3 WHERE id = $1', [u1.user.id]);
  const quotaHitRes = await photosPost(
    makeSessionReq('http://localhost/api/photos', u1.rawToken, {
      method: 'POST',
      body: makeUploadFormData({ pose: 'back', takenOn: '2026-11-12' }),
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(quotaHitRes.status, 409);

  // 9. Photos stay OUT of JSON/CSV export
  const fullUser = (await getUserById(u1.user.id))!;
  const jsonExport = await buildUserExportJson(fullUser);
  const csvExport = await buildUserExportCsv(fullUser);
  assert.equal('progressPhotos' in jsonExport, false);
  assert.equal('photos' in jsonExport, false);
  assert.equal(csvExport.includes(upload1Json.photo.id), false);

  // 10. Phase 6 Replace-mode restore PRESERVES progress photos
  await applyLiftitupRestore(fullUser, JSON.stringify(jsonExport), {
    mode: 'replace',
    confirmation: 'REPLACE',
  });
  const aliceAfterRestore = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photos WHERE user_id = $1',
    [u1.user.id],
  );
  assert.equal(Number(aliceAfterRestore?.cnt), 3);

  // 11. Danger zone delete_body deletes body_metrics AND progress_photos + blobs for Alice only
  await deleteUserBodyData(u1.user.id);
  const aliceAfterBodyDel = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photos WHERE user_id = $1',
    [u1.user.id],
  );
  assert.equal(Number(aliceAfterBodyDel?.cnt), 0);
  const bobStillHasPhoto = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photo_blobs WHERE photo_id = $1',
    [bobPhotoId],
  );
  assert.equal(Number(bobStillHasPhoto?.cnt), 1);

  // 12. Deleting Bob's account removes Bob's photo metadata & blobs
  await deleteUserAccount(u2.user.id);
  const remainingBlobs = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photo_blobs',
  );
  assert.equal(Number(remainingBlobs?.cnt), 0);

  // 13. Settings search hides photo entries for guests
  assert.equal(
    filterSettingsItems('photo', { isGuest: false }).some(
      (i) => i.id === 'body-progress-photos',
    ),
    true,
  );
  assert.equal(
    filterSettingsItems('photo', { isGuest: true }).some(
      (i) => i.id === 'body-progress-photos' || i.id === 'data-photo-archive',
    ),
    false,
  );

  await closeDb();
});
