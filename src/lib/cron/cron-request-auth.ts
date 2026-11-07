/**
 * Authorization for scheduled briefing/alert jobs that also support an operator "test" mode.
 *
 * Rules (2026-11-02):
 *   • A full run requires the CRON_SECRET bearer — what /api/cron/dispatch sends.
 *   • Test mode (?test=true) additionally accepts verified admin auth (admin session,
 *     2FA session, or the shared admin password via ?password= or x-admin-password).
 *   • `?email=` is a FILTER for test mode, never authorization.
 *   • `x-vercel-cron` is client-supplied and is not trusted. Vercel documents only the
 *     CRON_SECRET bearer as cron authentication.
 *   • Rejection happens before any provider call or email send, with a bare 401.
 *   • Outside production (local dev) requests pass, matching these routes' prior behavior.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-identity';

const encoder = new TextEncoder();

function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] ?? 0) ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

/** True only when CRON_SECRET is set AND the Authorization bearer matches it. */
export function hasValidCronSecret(request: Pick<NextRequest, 'headers'>): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  return constantTimeEqual(header, `Bearer ${secret}`);
}

export type CronRequestAuth =
  | { ok: true; via: 'cron_secret' | 'admin' | 'non_production' }
  | { ok: false; response: NextResponse };

export async function authorizeCronRequest(
  request: NextRequest,
  opts: { isTest: boolean },
): Promise<CronRequestAuth> {
  if (hasValidCronSecret(request)) return { ok: true, via: 'cron_secret' };

  if (opts.isTest) {
    const password = request.nextUrl.searchParams.get('password') ?? request.headers.get('x-admin-password');
    const admin = await verifyAdminAuth(request, password);
    if (admin.ok) return { ok: true, via: 'admin' };
  }

  if (process.env.NODE_ENV !== 'production') return { ok: true, via: 'non_production' };

  return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}
