import { NextResponse } from 'next/server';
import { runCronProcessPending } from '@/services/cronService';

function readCronSecret(): string | null {
  const s = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_CRON_SECRET || null;
  return s && String(s).trim().length ? String(s) : null;
}

export async function POST(req: Request) {
  const secret = readCronSecret();
  if (!secret) {
    return NextResponse.json({ error: 'CRON Secret fehlt (CRON_SECRET)' }, { status: 500 });
  }

  const provided = req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret') || null;
  const url = new URL(req.url);
  const providedQuery = url.searchParams.get('secret');
  const valid = provided === secret || providedQuery === secret;
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await runCronProcessPending();
    return NextResponse.json({ ok: true, processed: res });
  } catch (e: any) {
    console.error('Cron processing failed', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Optionaler GET-Endpunkt zum Triggern (z.B. per einfachen Cron ohne Body)
  return POST(req);
}
