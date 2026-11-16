import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { getProgressPhotoBlob } from '@/lib/db/photos';
import { getUserById } from '@/lib/db/users';
import { verifySignedPhotoToken } from '@/lib/mcp/photoLinks';

export const GET = withApiHandler<{ token: string }>(
  'photos.signed.get',
  async (_req: NextRequest, ctx) => {
    const token = ctx.params.token?.trim() ?? '';
    const verified = verifySignedPhotoToken(token);
    if (!verified) {
      throw ApiError.notFound('Not found');
    }

    const owner = await getUserById(verified.userId);
    if (!owner || owner.isDisabled || owner.isGuest) {
      throw ApiError.notFound('Not found');
    }

    const result = await getProgressPhotoBlob(
      verified.userId,
      verified.photoId,
      'full',
    );
    if (!result) {
      throw ApiError.notFound('Not found');
    }

    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Length': String(result.bytes.byteLength),
      },
    });
  },
);
