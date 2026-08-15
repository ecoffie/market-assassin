/**
 * GET /api/admin/platform-health?password=…
 *
 * The Observatory's self-measurement. See `src/lib/analytics/platform-health.ts` for the rule this
 * enforces: never report a status we did not measure — `unknown` + `blockedBy` is a first-class
 * outcome, and a check that throws surfaces as `unknown`, never as green.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPlatformHealth } from '@/lib/analytics/platform-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const health = await getPlatformHealth();
    return NextResponse.json({
      ok: true,
      ...health,
      note:
        'Platform Health measures the measurement system. A status is only reported when it was ' +
        'actually checked; anything we could not verify appears under `unmeasured` with its blocker ' +
        'rather than being guessed at.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
