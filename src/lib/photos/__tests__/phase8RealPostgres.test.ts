import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
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
const { setupRealPostgresTestDb } = await import(
  '@/lib/db/__tests__/realPostgres'
);
const { initSchema } = await import('@/lib/db/schema');
const { queryOne } = await import('@/lib/db/connection');
const { createUser } = await import('@/lib/db/users');
const { createAuthSession } = await import('@/lib/db/sessions');
const { deleteUserAccount } = await import('@/lib/db/userDeletion');
const { hashToken, SESSION_COOKIE_NAME } = await import('@/lib/auth/session');
const { POST: photosPost } = await import('@/app/api/photos/route');
const { GET: photoGet } = await import('@/app/api/photos/[id]/route');
const { GET: photoArchiveGet } = await import('@/app/api/photos/archive/route');

/**
 * Builds a JPEG-like binary buffer containing every byte value 0x00..0xFF
 * (specifically exercising > 0x7F bytes that pg-mem alters on read-back).
 */
function buildFullByteSpectrumBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.allocUnsafe(sizeBytes);
  // JPEG SOI header
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  for (let i = 4; i < sizeBytes - 2; i += 1) {
    buf[i] = (i - 4) & 0xff;
  }
  // JPEG EOI trailer
  buf[sizeBytes - 2] = 0xff;
  buf[sizeBytes - 1] = 0xd9;
  return buf;
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

test('Real Postgres: byte-for-byte BYTEA round-trip (0x00..0xFF), streamed ZIP archive, and account deletion', async (t) => {
  const ctx = await setupRealPostgresTestDb('phase8');
  t.after(async () => {
    await ctx.teardown();
  });

  // Verify initSchema is idempotent on real Postgres
  await initSchema(ctx.pool);

  const makeUser = async (username: string) => {
    const user = await createUser({
      username,
      displayName: username,
      passwordHash: 'hash',
      unit: 'kg',
      timezone: 'UTC',
    });
    const rawToken = `pgtok_${crypto.randomBytes(12).toString('hex')}`;
    await createAuthSession(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + 3600_000).toISOString(),
    );
    return { user, rawToken };
  };

  const alice = await makeUser('alice_realpg');
  const bob = await makeUser('bob_realpg');

  const fullPayload = buildFullByteSpectrumBuffer(128 * 1024 + 17);
  const thumbPayload = buildFullByteSpectrumBuffer(8 * 1024 + 9);

  const fd = new FormData();
  fd.set('pose', 'front');
  fd.set('takenOn', '2026-11-16');
  fd.set(
    'photo',
    new File([new Uint8Array(fullPayload)], 'front.jpg', {
      type: 'image/jpeg',
    }),
  );
  fd.set(
    'thumbnail',
    new File([new Uint8Array(thumbPayload)], 'front-thumb.jpg', {
      type: 'image/jpeg',
    }),
  );

  const uploadRes = await photosPost(
    new NextRequest('http://localhost/api/photos', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.rawToken}` },
      body: fd,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(uploadRes.status, 201);
  const uploaded = (await uploadRes.json()) as { photo: { id: string } };

  // Fetch full and thumb and assert byte-for-byte equality
  const fullRes = await photoGet(
    new NextRequest(`http://localhost/api/photos/${uploaded.photo.id}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.rawToken}` },
    }),
    { params: Promise.resolve({ id: uploaded.photo.id }) },
  );
  assert.equal(fullRes.status, 200);
  const fetchedFull = Buffer.from(await fullRes.arrayBuffer());
  assert.equal(
    Buffer.compare(fetchedFull, fullPayload),
    0,
    'Full photo bytes must round-trip byte-for-byte through Postgres BYTEA',
  );

  const thumbRes = await photoGet(
    new NextRequest(
      `http://localhost/api/photos/${uploaded.photo.id}?variant=thumb`,
      {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.rawToken}` },
      },
    ),
    { params: Promise.resolve({ id: uploaded.photo.id }) },
  );
  assert.equal(thumbRes.status, 200);
  const fetchedThumb = Buffer.from(await thumbRes.arrayBuffer());
  assert.equal(
    Buffer.compare(fetchedThumb, thumbPayload),
    0,
    'Thumbnail bytes must round-trip byte-for-byte through Postgres BYTEA',
  );

  // Upload a photo for Bob so we can verify archive isolation & deletion isolation
  const bobFd = new FormData();
  bobFd.set('pose', 'back');
  bobFd.set('takenOn', '2026-11-16');
  bobFd.set(
    'photo',
    new File([new Uint8Array(buildFullByteSpectrumBuffer(4096))], 'bob.jpg', {
      type: 'image/jpeg',
    }),
  );
  bobFd.set(
    'thumbnail',
    new File([new Uint8Array(buildFullByteSpectrumBuffer(1024))], 'bob-t.jpg', {
      type: 'image/jpeg',
    }),
  );
  const bobRes = await photosPost(
    new NextRequest('http://localhost/api/photos', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${bob.rawToken}` },
      body: bobFd,
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(bobRes.status, 201);

  // Stream Alice's ZIP archive and verify byte-for-byte photo inside ZIP + isolation
  const archiveRes = await photoArchiveGet(
    new NextRequest('http://localhost/api/photos/archive', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${alice.rawToken}` },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(archiveRes.status, 200);
  const zipBuf = Buffer.from(await archiveRes.arrayBuffer());
  const entries = extractZipEntries(zipBuf);
  assert.equal(entries.has('photos/2026-11-16-front.jpg'), true);
  assert.equal(entries.has('photos/2026-11-16-back.jpg'), false);
  assert.equal(
    Buffer.compare(entries.get('photos/2026-11-16-front.jpg')!, fullPayload),
    0,
    'ZIP archive entry must match original full binary payload byte-for-byte',
  );

  // Deleting Alice's account removes Alice's photo & blob rows, leaving Bob's intact
  await deleteUserAccount(alice.user.id);
  const aliceMeta = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photos WHERE user_id = $1',
    [alice.user.id],
  );
  assert.equal(Number(aliceMeta?.cnt), 0);

  const totalBlobs = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photo_blobs',
  );
  assert.equal(Number(totalBlobs?.cnt), 1);
});
