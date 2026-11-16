import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { getAdminUserDetail, requireAdminSessionAuth } from '@/lib/admin';

export const GET = withApiHandler<{ id: string }>(
  'admin.users.detail.get',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAdminSessionAuth(req, ctx);
    const targetUserId = ctx.params.id?.trim();
    if (!targetUserId) {
      throw ApiError.notFound('User not found');
    }

    const detail = await getAdminUserDetail(targetUserId, {
      actorUserId: user.id,
      actorLabel: user.username,
      source: 'admin_web',
    });

    return NextResponse.json(detail, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
