import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/lib/auth/session';
import { getFullAnalyticsForUser } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
  const user = resolveUserFromRequest(req);
  const analytics = getFullAnalyticsForUser(user.id);

  return NextResponse.json({ analytics });
}
