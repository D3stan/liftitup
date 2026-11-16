import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireSessionAuth } from '@/lib/auth/session';
import { isValidIsoDate, resolveWeightForDate } from '@/lib/body/weight';
import { listBodyMetrics } from '@/lib/db/bodyMetrics';
import {
  countUserPhotos,
  createProgressPhoto,
  getUserPhotoQuota,
  listProgressPhotos,
} from '@/lib/db/photos';
import { localDateForTimezone } from '@/lib/db/users';
import {
  MAX_PHOTO_BYTES,
  MAX_THUMB_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  isValidPhotoPose,
} from '@/lib/photos/constants';
import type {
  ProgressPhoto,
  ProgressPhotoPose,
  ProgressPhotoQuota,
  WeightUnit,
} from '@/types/domain';

export interface PhotosGetResponse {
  photos: ProgressPhoto[];
  quota: ProgressPhotoQuota;
  unit: WeightUnit;
  today: string;
}

function isBlobLike(val: unknown): val is Blob {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof (val as Blob).arrayBuffer === 'function' &&
    typeof (val as Blob).size === 'number'
  );
}

function parseOptionalDimension(raw: FormDataEntryValue | null): number | null {
  if (raw === null || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000) {
    throw ApiError.validation('Image dimensions must be positive integers');
  }
  return n;
}

export const GET = withApiHandler('photos.list', async (req: NextRequest, ctx) => {
  const { user } = await requireSessionAuth(req, ctx);
  if (user.isGuest) {
    throw ApiError.forbidden('Progress photos are not available for guest accounts');
  }

  const rawPose = req.nextUrl.searchParams.get('pose');
  let poseFilter: ProgressPhotoPose | undefined;
  if (rawPose !== null && rawPose !== '' && rawPose !== 'all') {
    if (!isValidPhotoPose(rawPose)) {
      throw ApiError.validation('pose must be front, side, or back');
    }
    poseFilter = rawPose;
  }

  const [photos, limit, totalUsed] = await Promise.all([
    listProgressPhotos(user.id, poseFilter ? { pose: poseFilter } : undefined),
    getUserPhotoQuota(user.id),
    poseFilter ? countUserPhotos(user.id) : Promise.resolve(-1),
  ]);

  const used = poseFilter ? totalUsed : photos.length;
  const payload: PhotosGetResponse = {
    photos,
    quota: { used, limit },
    unit: user.unit,
    today: localDateForTimezone(user.timezone),
  };

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
});

export const POST = withApiHandler('photos.create', async (req: NextRequest, ctx) => {
  const { user } = await requireSessionAuth(req, ctx);
  if (user.isGuest) {
    throw ApiError.forbidden('Progress photos are not available for guest accounts');
  }

  // Enforce declared Content-Length limit before reading multipart body
  const rawContentLength = req.headers.get('content-length');
  if (rawContentLength !== null) {
    const declaredLength = Number(rawContentLength);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_UPLOAD_REQUEST_BYTES
    ) {
      throw ApiError.payloadTooLarge(
        `Upload exceeds maximum allowed size (${MAX_PHOTO_BYTES / (1024 * 1024)} MB per photo)`,
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    throw ApiError.badRequest('Request body must be valid multipart/form-data');
  }

  const rawPose = formData.get('pose');
  if (typeof rawPose !== 'string' || !isValidPhotoPose(rawPose.trim())) {
    throw ApiError.validation('pose must be front, side, or back');
  }
  const pose = rawPose.trim() as ProgressPhotoPose;

  const rawTakenOn = formData.get('takenOn');
  let takenOn = localDateForTimezone(user.timezone);
  if (rawTakenOn !== null && typeof rawTakenOn === 'string' && rawTakenOn.trim() !== '') {
    if (!isValidIsoDate(rawTakenOn.trim())) {
      throw ApiError.validation('takenOn must be a valid YYYY-MM-DD date');
    }
    takenOn = rawTakenOn.trim();
  }

  const photoEntry = formData.get('photo');
  if (!isBlobLike(photoEntry)) {
    throw ApiError.validation('photo file is required');
  }
  if (photoEntry.size > MAX_PHOTO_BYTES) {
    throw ApiError.payloadTooLarge(
      `Photo exceeds maximum size of ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`,
    );
  }

  const thumbEntry = formData.get('thumbnail');
  if (!isBlobLike(thumbEntry)) {
    throw ApiError.validation('thumbnail file is required');
  }
  if (thumbEntry.size > MAX_THUMB_BYTES) {
    throw ApiError.payloadTooLarge('Thumbnail exceeds maximum size of 512 KB');
  }

  const width = parseOptionalDimension(formData.get('width'));
  const height = parseOptionalDimension(formData.get('height'));

  const fullBytes = Buffer.from(await photoEntry.arrayBuffer());
  if (fullBytes.byteLength === 0) {
    throw ApiError.validation('photo file must not be empty');
  }
  if (fullBytes.byteLength > MAX_PHOTO_BYTES) {
    throw ApiError.payloadTooLarge(
      `Photo exceeds maximum size of ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`,
    );
  }

  const thumbBytes = Buffer.from(await thumbEntry.arrayBuffer());
  if (thumbBytes.byteLength === 0) {
    throw ApiError.validation('thumbnail file must not be empty');
  }
  if (thumbBytes.byteLength > MAX_THUMB_BYTES) {
    throw ApiError.payloadTooLarge('Thumbnail exceeds maximum size of 512 KB');
  }

  const metrics = await listBodyMetrics(user.id);
  const resolvedWeight = resolveWeightForDate(metrics, takenOn);
  const weightKg = resolvedWeight ? resolvedWeight.weightKg : null;

  const created = await createProgressPhoto({
    userId: user.id,
    takenOn,
    pose,
    weightKg,
    fullBytes,
    thumbBytes,
    width,
    height,
  });

  await safeRecordEvent({
    userId: user.id,
    eventType: 'photo_uploaded',
    detail: { pose },
  });

  return NextResponse.json(created, {
    status: 201,
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
});
