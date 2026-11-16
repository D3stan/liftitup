import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/session';

export const GET = withApiHandler('auth.me', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  return NextResponse.json({ user });
});
