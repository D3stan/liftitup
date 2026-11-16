import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await pingDb();
    return NextResponse.json({ ok: true, db: 'ok' });
  } catch {
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503 });
  }
}
