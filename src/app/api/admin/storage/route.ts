import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { getAdminStorageReport, requireAdminSessionAuth } from '@/lib/admin';

export const GET = withApiHandler(
  'admin.storage.get',
  async (req: NextRequest, ctx) => {
    await requireAdminSessionAuth(req, ctx);
    const data = await getAdminStorageReport();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
