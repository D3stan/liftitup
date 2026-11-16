import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { requireSessionAuth } from '@/lib/auth/session';
import {
  countUserPhotos,
  deleteProgressPhoto,
  getProgressPhotoBlob,
  getUserPhotoQuota,
} from '@/lib/db/photos';

export const GET = withApiHandler<{ id: string }>(
  'photos.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireSessionAuth(req, ctx);
    if (user.isGuest) {
      throw ApiError.forbidden(
        'Progress photos are not available for guest accounts',
      );
    }

    const photoId = ctx.params.id;
    if (!photoId) {
      throw ApiError.notFound('Photo not found');
    }

    const rawVariant = req.nextUrl.searchParams.get('variant');
    let variant: 'full' | 'thumb' = 'full';
    if (rawVariant !== null && rawVariant !== '') {
      if (rawVariant !== 'full' && rawVariant !== 'thumb') {
        throw ApiError.validation('variant must be full or thumb');
      }
      variant = rawVariant;
    }

    const result = await getProgressPhotoBlob(user.id, photoId, variant);
    if (!result) {
      throw ApiError.notFound('Photo not found');
    }

    const download = req.nextUrl.searchParams.get('download') === '1';
    const headers: Record<string, string> = {
      // Fixed JPEG content type (never from upload) + nosniff + private cache
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(result.bytes.byteLength),
    };

    if (download) {
      headers['Content-Disposition'] =
        `attachment; filename="liftitup-${result.photo.takenOn}-${result.photo.pose}.jpg"`;
    }

    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers,
    });
  },
);

export const DELETE = withApiHandler<{ id: string }>(
  'photos.delete',
  async (req: NextRequest, ctx) => {
    const { user } = await requireSessionAuth(req, ctx);
    if (user.isGuest) {
      throw ApiError.forbidden(
        'Progress photos are not available for guest accounts',
      );
    }

    const photoId = ctx.params.id;
    if (!photoId) {
      throw ApiError.notFound('Photo not found');
    }

    const deleted = await deleteProgressPhoto(user.id, photoId);
    if (!deleted) {
      throw ApiError.notFound('Photo not found');
    }

    const [used, limit] = await Promise.all([
      countUserPhotos(user.id),
      getUserPhotoQuota(user.id),
    ]);

    return NextResponse.json(
      { ok: true, id: photoId, quota: { used, limit } },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  },
);
