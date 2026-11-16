import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db/connection';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await pingDb();
    return NextResponse.json({ ok: true, db: 'ok' });
  } catch (err) {
    logger.error('healthcheck failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503 });
  }
}
