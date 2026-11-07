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

/** True only when ADMIN_PASSWORD is set AND `?password=` matches it (constant-time). */
export function hasValidAdminPassword(request: Pick<NextRequest, 'url'>): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const given = new URL(request.url).searchParams.get('password') ?? '';
  return given.length > 0 && constantTimeEqual(given, expected);
}

/**
 * Server-side authorization for scheduled job routes (2026-11-07).
 *
 * Accepts ONLY a server-held secret: the CRON_SECRET bearer (what /api/cron/dispatch and Vercel
 * cron send) or, for routes that already support manual runs, `?password=ADMIN_PASSWORD`.
 * Request headers such as `x-cron-dispatch` and `x-vercel-cron` are set by the caller and are
 * never authorization; a route may still read them as a hint AFTER this check passes.
 * Fails closed when the secrets are unset. No non-production bypass.
 */
export function isAuthorizedJobRequest(
  request: Pick<NextRequest, 'headers' | 'url'>,
  opts: { allowAdminPassword?: boolean } = {},
): boolean {
  if (hasValidCronSecret(request)) return true;
  return opts.allowAdminPassword !== false && hasValidAdminPassword(request);
}

/** null when authorized, else a bare 401 to return before any work, write, email or paid call. */
export function requireJobAuth(
  request: Pick<NextRequest, 'headers' | 'url'>,
  opts: { allowAdminPassword?: boolean } = {},
): NextResponse | null {
  return isAuthorizedJobRequest(request, opts)
    ? null
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
