import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { getAdminOverview, requireAdminSessionAuth } from '@/lib/admin';

export const GET = withApiHandler(
  'admin.overview.get',
  async (req: NextRequest, ctx) => {
    await requireAdminSessionAuth(req, ctx);
    const data = await getAdminOverview();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
