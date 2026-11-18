import { NextRequest } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireSessionAuth } from '@/lib/auth/session';
import {
  getProgressPhotoFullBytesForArchive,
  listProgressPhotos,
} from '@/lib/db/photos';
import { localDateForTimezone } from '@/lib/db/users';
import { createPhotoArchiveStream } from '@/lib/photos/archive';

export const GET = withApiHandler(
  'photos.archive',
  async (req: NextRequest, ctx) => {
    const { user } = await requireSessionAuth(req, ctx);
    if (user.isGuest) {
      throw ApiError.forbidden(
        'Progress photos are not available for guest accounts',
      );
    }

    const photos = await listProgressPhotos(user.id, { order: 'asc' });
    await safeRecordEvent({
      userId: user.id,
      eventType: 'photo_archive_export',
      detail: { photoCount: photos.length },
    });
    const today = localDateForTimezone(user.timezone);
    const stream = createPhotoArchiveStream(user, photos, (photoId) =>
      getProgressPhotoFullBytesForArchive(user.id, photoId),
    );

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="liftitup-photos-${today}.zip"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
);
