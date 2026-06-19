/**
 * Refresh the DoDAAC directory (code → office name) from FPDS via BigQuery.
 * Fired by the Cron Dispatcher (cron_jobs row → /api/cron/dispatch), not a
 * native vercel.json entry — so it costs 0 of the 100-cron budget.
 *
 * Schedule (in cron_jobs): monthly. Auth: x-vercel-cron / Bearer CRON_SECRET /
 * x-cron-dispatch (the dispatcher sets this) / ?password=ADMIN_PASSWORD.
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshDodaacDirectory } from '@/lib/gov-contacts/refresh-dodaac-directory';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  if (request.headers.get('x-cron-dispatch') === '1') return true;
  const auth = request.headers.get('authorization');
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = new URL(request.url).searchParams.get('password');
  if (pw && pw === (process.env.ADMIN_PASSWORD)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await refreshDodaacDirectory();
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
