import crypto from 'node:crypto';
import type {
  ProgressPhoto,
  ProgressPhotoPose,
  ProgressPhotoQuota,
} from '@/types/domain';
import { ApiError } from '@/lib/api/handler';
import { DEFAULT_PHOTO_QUOTA } from '@/lib/photos/constants';
import {
  isPgMemActive,
  query,
  queryOne,
  withTransaction,
} from './connection';

type DbProgressPhotoRow = {
  id: string;
  user_id: string;
  taken_on: string;
  pose: string;
  weight_kg: number | null;
  byte_size: number;
  thumb_byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
};

function mapProgressPhotoRow(row: DbProgressPhotoRow): ProgressPhoto {
  return {
    id: row.id,
    userId: row.user_id,
    takenOn: row.taken_on,
    pose: row.pose as ProgressPhotoPose,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    byteSize: Number(row.byte_size),
    thumbByteSize: Number(row.thumb_byte_size),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: row.created_at,
  };
}

function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === 'string') return Buffer.from(raw, 'binary');
  throw new Error('Unexpected binary column representation');
}

/**
 * Returns the effective photo quota for `userId` (`users.photo_quota` override when set
 * by an admin, otherwise `DEFAULT_PHOTO_QUOTA` = 300).
 */
export async function getUserPhotoQuota(userId: string): Promise<number> {
  const row = await queryOne<{ photo_quota: number | null }>(
    'SELECT photo_quota FROM users WHERE id = $1',
    [userId],
  );
  if (
    row &&
    row.photo_quota !== null &&
    row.photo_quota !== undefined &&
    Number.isFinite(Number(row.photo_quota)) &&
    Number(row.photo_quota) >= 0
  ) {
    return Math.floor(Number(row.photo_quota));
  }
  return DEFAULT_PHOTO_QUOTA;
}

/**
 * Counts progress photos owned by `userId` without touching `progress_photo_blobs`.
 */
export async function countUserPhotos(userId: string): Promise<number> {
  const row = await queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM progress_photos WHERE user_id = $1',
    [userId],
  );
  return Number(row?.cnt ?? 0);
}

/**
 * Lists progress photo metadata for `userId` (never selects binary bytes).
 */
export async function listProgressPhotos(
  userId: string,
  opts?: { pose?: ProgressPhotoPose; order?: 'asc' | 'desc' },
): Promise<ProgressPhoto[]> {
  const clauses = ['user_id = $1'];
  const params: unknown[] = [userId];
  if (opts?.pose) {
    clauses.push('pose = $2');
    params.push(opts.pose);
  }
  const dir = opts?.order === 'asc' ? 'ASC' : 'DESC';
  const res = await query<DbProgressPhotoRow>(
    `
    SELECT id, user_id, taken_on, pose, weight_kg, byte_size, thumb_byte_size, width, height, created_at
    FROM progress_photos
    WHERE ${clauses.join(' AND ')}
    ORDER BY taken_on ${dir}, created_at ${dir}, id ${dir}
    `,
    params,
  );
  return res.rows.map(mapProgressPhotoRow);
}

/**
 * Returns metadata for a single progress photo owned by `userId`, or null.
 */
export async function getProgressPhotoMeta(
  userId: string,
  photoId: string,
): Promise<ProgressPhoto | null> {
  const row = await queryOne<DbProgressPhotoRow>(
    `
    SELECT id, user_id, taken_on, pose, weight_kg, byte_size, thumb_byte_size, width, height, created_at
    FROM progress_photos
    WHERE id = $1 AND user_id = $2
    `,
    [photoId, userId],
  );
  return row ? mapProgressPhotoRow(row) : null;
}

/**
 * Returns metadata + ONLY the requested binary rendition (`full` or `thumb`) for `userId` and `photoId`.
 */
export async function getProgressPhotoBlob(
  userId: string,
  photoId: string,
  variant: 'full' | 'thumb',
): Promise<{ photo: ProgressPhoto; bytes: Buffer } | null> {
  const col = variant === 'thumb' ? 'pb.thumb_bytes' : 'pb.full_bytes';
  const row = await queryOne<DbProgressPhotoRow & { blob_data: unknown }>(
    `
    SELECT
      pp.id, pp.user_id, pp.taken_on, pp.pose, pp.weight_kg,
      pp.byte_size, pp.thumb_byte_size, pp.width, pp.height, pp.created_at,
      ${col} AS blob_data
    FROM progress_photos pp
    JOIN progress_photo_blobs pb ON pb.photo_id = pp.id
    WHERE pp.id = $1 AND pp.user_id = $2
    `,
    [photoId, userId],
  );
  if (!row) return null;
  return {
    photo: mapProgressPhotoRow(row),
    bytes: toBuffer(row.blob_data),
  };
}

/**
 * Fetches only the full-resolution bytes for one photo owned by `userId` (used for streamed archive).
 */
export async function getProgressPhotoFullBytesForArchive(
  userId: string,
  photoId: string,
): Promise<Buffer | null> {
  const row = await queryOne<{ full_bytes: unknown }>(
    `
    SELECT pb.full_bytes
    FROM progress_photo_blobs pb
    JOIN progress_photos pp ON pp.id = pb.photo_id
    WHERE pp.id = $1 AND pp.user_id = $2
    `,
    [photoId, userId],
  );
  if (!row) return null;
  return toBuffer(row.full_bytes);
}

/**
 * Atomically enforces user quota and stores photo metadata + binary blobs in Postgres.
 */
export async function createProgressPhoto(input: {
  userId: string;
  takenOn: string;
  pose: ProgressPhotoPose;
  weightKg: number | null;
  fullBytes: Buffer;
  thumbBytes: Buffer;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
}): Promise<{ photo: ProgressPhoto; quota: ProgressPhotoQuota }> {
  return withTransaction(async () => {
    if (!isPgMemActive()) {
      await query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        input.userId,
      ]);
    }

    const limit = await getUserPhotoQuota(input.userId);
    const used = await countUserPhotos(input.userId);
    if (used >= limit) {
      throw ApiError.conflict(
        `Photo quota reached (${used} / ${limit}). Delete an existing photo before adding another.`,
        { used, limit },
      );
    }

    const id = `ph_${crypto.randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const byteSize = input.fullBytes.byteLength;
    const thumbByteSize = input.thumbBytes.byteLength;
    const width = input.width ?? null;
    const height = input.height ?? null;

    await query(
      `
      INSERT INTO progress_photos (
        id, user_id, taken_on, pose, weight_kg,
        byte_size, thumb_byte_size, width, height, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        id,
        input.userId,
        input.takenOn,
        input.pose,
        input.weightKg,
        byteSize,
        thumbByteSize,
        width,
        height,
        createdAt,
      ],
    );

    await query(
      `
      INSERT INTO progress_photo_blobs (photo_id, full_bytes, thumb_bytes)
      VALUES ($1, $2, $3)
      `,
      [id, input.fullBytes, input.thumbBytes],
    );

    return {
      photo: {
        id,
        userId: input.userId,
        takenOn: input.takenOn,
        pose: input.pose,
        weightKg: input.weightKg,
        byteSize,
        thumbByteSize,
        width,
        height,
        createdAt,
      },
      quota: { used: used + 1, limit },
    };
  });
}

/**
 * Deletes a single progress photo and its binary bytes for `userId`.
 * Returns false if not found or owned by another user.
 */
export async function deleteProgressPhoto(
  userId: string,
  photoId: string,
): Promise<boolean> {
  return withTransaction(async () => {
    const owned = await queryOne<{ id: string }>(
      'SELECT id FROM progress_photos WHERE id = $1 AND user_id = $2',
      [photoId, userId],
    );
    if (!owned) return false;

    await query('DELETE FROM progress_photo_blobs WHERE photo_id = $1', [
      photoId,
    ]);
    await query('DELETE FROM progress_photos WHERE id = $1 AND user_id = $2', [
      photoId,
      userId,
    ]);
    return true;
  });
}
