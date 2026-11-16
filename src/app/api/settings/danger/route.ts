import { NextRequest, NextResponse } from 'next/server';
import { ApiError, parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { clearSessionCookie, requireSessionAuth } from '@/lib/auth/session';
import {
  deleteUserAccount,
  deleteUserBodyData,
  deleteUserSplitData,
  deleteUserWorkoutHistory,
} from '@/lib/db/userDeletion';
import { getUserById } from '@/lib/db/users';
import { DANGER_ACTION_MAP, isDangerAction } from '@/lib/settings/danger';

interface DangerZoneRequestBody {
  action?: unknown;
  confirmation?: unknown;
}

export const POST = withApiHandler(
  'settings.danger',
  async (req: NextRequest, ctx) => {
    const { user } = await requireSessionAuth(req, ctx);

    if (user.isGuest) {
      throw ApiError.forbidden(
        'Danger zone actions are not available for guest accounts',
      );
    }

    const body = await parseJsonBody<DangerZoneRequestBody>(req);
    if (!isDangerAction(body.action)) {
      throw ApiError.validation(
        'action must be one of delete_workouts, delete_body, reset_split, or delete_account',
      );
    }

    const meta = DANGER_ACTION_MAP[body.action];
    const providedConfirmation =
      typeof body.confirmation === 'string'
        ? body.confirmation.trim().toUpperCase()
        : '';

    if (providedConfirmation !== meta.confirmationWord) {
      throw ApiError.validation(
        `Please type ${meta.confirmationWord} to confirm`,
      );
    }

    switch (body.action) {
      case 'delete_workouts': {
        await deleteUserWorkoutHistory(user.id);
        return NextResponse.json({ ok: true, action: body.action });
      }
      case 'delete_body': {
        await deleteUserBodyData(user.id);
        const updatedUser = await getUserById(user.id);
        return NextResponse.json({
          ok: true,
          action: body.action,
          user: updatedUser,
        });
      }
      case 'reset_split': {
        await deleteUserSplitData(user.id);
        return NextResponse.json({ ok: true, action: body.action });
      }
      case 'delete_account': {
        await deleteUserAccount(user.id);
        const res = NextResponse.json({ ok: true, action: body.action });
        return clearSessionCookie(res);
      }
    }
  },
);
