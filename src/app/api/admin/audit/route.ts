import { NextRequest, NextResponse } from 'next/server';
import { withApiHandler } from '@/lib/api/handler';
import { listAuditLog, requireAdminSessionAuth } from '@/lib/admin';

export const GET = withApiHandler(
  'admin.audit.get',
  async (req: NextRequest, ctx) => {
    await requireAdminSessionAuth(req, ctx);
    const targetUserId =
      req.nextUrl.searchParams.get('targetUserId')?.trim() || undefined;
    const action = req.nextUrl.searchParams.get('action')?.trim() || undefined;
    const rawLimit = req.nextUrl.searchParams.get('limit');
    const limit = rawLimit ? Number(rawLimit) : 100;

    const entries = await listAuditLog({
      targetUserId,
      action,
      limit: Number.isFinite(limit) ? limit : 100,
    });

    return NextResponse.json(
      { entries },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  },
);
