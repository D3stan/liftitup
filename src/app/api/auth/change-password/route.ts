import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { requireSessionAuth } from '@/lib/auth/session';
import {
  getUserByIdWithPassword,
  updateUserPasswordAndClearMustChange,
} from '@/lib/db/users';

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export const POST = withApiHandler(
  'auth.changePassword',
  async (req: NextRequest, ctx) => {
    const { user } = await requireSessionAuth(req, ctx, {
      allowMustChangePassword: true,
    });

    if (user.isGuest) {
      throw ApiError.forbidden('Guest accounts cannot change passwords');
    }

    const body = await parseJsonBody<ChangePasswordBody>(req);
    if (typeof body.newPassword !== 'string') {
      throw ApiError.validation('newPassword is required');
    }
    if (body.newPassword.length < 8 || body.newPassword.length > 128) {
      throw ApiError.validation(
        'newPassword must be between 8 and 128 characters',
      );
    }

    const withHash = await getUserByIdWithPassword(user.id);
    if (!withHash) {
      throw ApiError.notFound('User not found');
    }

    if (!withHash.mustChangePassword) {
      if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
        throw ApiError.validation('currentPassword is required');
      }
      const validCurrent = await verifyPassword(
        body.currentPassword,
        withHash.passwordHash,
      );
      if (!validCurrent) {
        throw ApiError.unauthorized('Current password is incorrect');
      }
    }

    const newHash = await hashPassword(body.newPassword);
    const updatedUser = await updateUserPasswordAndClearMustChange(
      user.id,
      newHash,
    );
    if (!updatedUser) {
      throw ApiError.notFound('User not found');
    }

    await safeRecordEvent({
      userId: user.id,
      eventType: 'password_changed',
      detail: { forced: Boolean(withHash.mustChangePassword) },
    });

    return NextResponse.json({ ok: true, user: updatedUser });
  },
);
