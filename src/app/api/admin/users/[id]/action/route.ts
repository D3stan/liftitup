import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import {
  adjustUserPhotoQuota,
  adminDeleteUser,
  forceLogoutUser,
  requireAdminWriteSessionAuth,
  revokeUserApiKey,
  setUserDisabledState,
} from '@/lib/admin';

interface AdminUserActionBody {
  action?: unknown;
  reason?: unknown;
  photoQuota?: unknown;
  confirmation?: unknown;
}

export const POST = withApiHandler<{ id: string }>(
  'admin.users.action.post',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAdminWriteSessionAuth(req, ctx);
    const targetUserId = ctx.params.id?.trim();
    if (!targetUserId) {
      throw ApiError.notFound('User not found');
    }

    const body = await parseJsonBody<AdminUserActionBody>(req);
    const actor = {
      actorUserId: user.id,
      actorLabel: user.username,
      source: 'admin_web' as const,
    };

    switch (body.action) {
      case 'disable': {
        const reason = typeof body.reason === 'string' ? body.reason : null;
        const result = await setUserDisabledState({
          targetUserId,
          disabled: true,
          reason,
          actor,
        });
        return NextResponse.json(
          { ok: true, action: 'disable', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      case 'enable': {
        const reason = typeof body.reason === 'string' ? body.reason : null;
        const result = await setUserDisabledState({
          targetUserId,
          disabled: false,
          reason,
          actor,
        });
        return NextResponse.json(
          { ok: true, action: 'enable', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      case 'force_logout': {
        const result = await forceLogoutUser({ targetUserId, actor });
        return NextResponse.json(
          { ok: true, action: 'force_logout', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      case 'revoke_api_key': {
        const result = await revokeUserApiKey({ targetUserId, actor });
        return NextResponse.json(
          { ok: true, action: 'revoke_api_key', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      case 'adjust_photo_quota': {
        let quota: number | null;
        if (body.photoQuota === null || body.photoQuota === '') {
          quota = null;
        } else if (typeof body.photoQuota === 'number') {
          quota = body.photoQuota;
        } else {
          throw ApiError.validation('photoQuota must be an integer or null');
        }
        const result = await adjustUserPhotoQuota({
          targetUserId,
          photoQuota: quota,
          actor,
        });
        return NextResponse.json(
          { ok: true, action: 'adjust_photo_quota', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      case 'delete_user': {
        const conf =
          typeof body.confirmation === 'string'
            ? body.confirmation.trim().toUpperCase()
            : '';
        if (conf !== 'DELETE') {
          throw ApiError.validation('Please type DELETE to confirm user deletion');
        }
        const result = await adminDeleteUser({ targetUserId, actor });
        return NextResponse.json(
          { ok: true, action: 'delete_user', ...result },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }

      default:
        throw ApiError.validation(
          'action must be one of disable, enable, force_logout, revoke_api_key, adjust_photo_quota, or delete_user',
        );
    }
  },
);
