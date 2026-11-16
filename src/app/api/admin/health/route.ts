import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { getAdminSystemHealth, requireAdminSessionAuth } from '@/lib/admin';

export const GET = withApiHandler(
  'admin.health.get',
  async (req: NextRequest, ctx) => {
    await requireAdminSessionAuth(req, ctx);
    const rawHours = req.nextUrl.searchParams.get('windowHours');
    const parsedHours = rawHours ? Number(rawHours) : 24;
    const windowHours =
      Number.isFinite(parsedHours) && parsedHours >= 1 ? parsedHours : 24;
    const data = await getAdminSystemHealth(windowHours);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
