import { NextRequest, NextResponse } from 'next/server';
import { parseJsonBody, withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';
import { getApiKeyByUserId } from '@/lib/db/sessions';
import {
  applyUserSettingsPatch,
  type SettingsPatchBody,
} from '@/lib/settings/profileSettings';

export const GET = withApiHandler('settings.get', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  const apiKey = await getApiKeyByUserId(user.id);
  return NextResponse.json({ user, apiKey });
});

export const PATCH = withApiHandler(
  'settings.patch',
  async (req: NextRequest, ctx) => {
    const { user } = await requireAuth(req, ctx);
    const body = await parseJsonBody<SettingsPatchBody>(req);
    const updated = await applyUserSettingsPatch(user, body);
    const apiKey = await getApiKeyByUserId(user.id);
    return NextResponse.json({ user: updated, apiKey });
  },
);
