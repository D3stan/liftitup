import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import {
  adminExportUserData,
  requireAdminWriteSessionAuth,
} from '@/lib/admin';

interface AdminExportBody {
  reason?: unknown;
}

export const POST = withApiHandler<{ id: string }>(
  'admin.users.export.post',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAdminWriteSessionAuth(req, ctx);
    const targetUserId = ctx.params.id?.trim();
    if (!targetUserId) {
      throw ApiError.notFound('User not found');
    }

    const body = await parseJsonBody<AdminExportBody>(req);
    const reason = typeof body.reason === 'string' ? body.reason : '';

    const result = await adminExportUserData({
      targetUserId,
      reason,
      actor: {
        actorUserId: user.id,
        actorLabel: user.username,
        source: 'admin_web',
      },
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
