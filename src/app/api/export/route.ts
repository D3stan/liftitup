import { NextRequest, NextResponse } from 'next/server';
import { ApiError, withApiHandler } from '@/lib/api/handler';
import { safeRecordEvent } from '@/lib/admin/events';
import { requireAuth } from '@/lib/auth/session';
import {
  buildUserExportCsv,
  buildUserExportJson,
  getExportFilename,
} from '@/lib/export';

export const GET = withApiHandler('export.get', async (req: NextRequest, ctx) => {
  const { user } = await requireAuth(req, ctx);
  const rawFormat = req.nextUrl.searchParams.get('format') ?? 'json';
  const format = rawFormat.trim().toLowerCase();

  if (format !== 'json' && format !== 'csv') {
    throw ApiError.validation('format must be "json" or "csv"');
  }

  const filename = getExportFilename(user, format);

  if (format === 'csv') {
    const csv = await buildUserExportCsv(user);
    await safeRecordEvent({
      userId: user.id,
      eventType: 'export',
      detail: { format: 'csv' },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const payload = await buildUserExportJson(user);
  await safeRecordEvent({
    userId: user.id,
    eventType: 'export',
    detail: { format: 'json' },
  });
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
