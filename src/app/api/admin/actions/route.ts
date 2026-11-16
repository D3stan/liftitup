import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import {
  adminPurgeExpiredGuests,
  adminRefreshDailySnapshot,
  requireAdminWriteSessionAuth,
} from '@/lib/admin';

interface AdminGlobalActionBody {
  action?: unknown;
}

export const POST = withApiHandler(
  'admin.actions.post',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAdminWriteSessionAuth(req, ctx);
    const body = await parseJsonBody<AdminGlobalActionBody>(req);
    const actor = {
      actorUserId: user.id,
      actorLabel: user.username,
      source: 'admin_web' as const,
    };

    if (body.action === 'purge_guests') {
      const result = await adminPurgeExpiredGuests({ actor });
      return NextResponse.json(
        { ok: true, action: 'purge_guests', ...result },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    if (body.action === 'refresh_snapshot') {
      const result = await adminRefreshDailySnapshot({ actor });
      return NextResponse.json(
        { ok: true, action: 'refresh_snapshot', ...result },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    throw ApiError.validation(
      'action must be "purge_guests" or "refresh_snapshot"',
    );
  },
);
