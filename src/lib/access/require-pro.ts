/**
 * requirePro — the ONE server gate for Pro-only features (Players, M-Win, CRM save from the map,
 * the proposal workspace). Owner decision 2026-11-13: "Pro and trial only".
 *
 *   signed out (no / bad MI session token) → 401 (the client opens sign-in)
 *   signed in, not Pro                      → 402 { error: 'pro_required', upgrade_url: '/pricing' }
 *   Pro (paid Pro, Team, active trial) or staff → allowed
 *
 * "Pro" is resolveAccess(email).level === 'pro' — the single source of truth that already covers
 * paid briefings, access_team, and a per-user trial_ends_at. Staff pass via getStaffRole.
 * On an access-lookup error resolveAccess falls open to 'free' — so an outage locks the feature,
 * it never fabricates access.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getStaffRole } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';

export const PRO_REQUIRED_BODY = {
  success: false,
  error: 'pro_required',
  message: 'This is a Mindy Pro feature. Start your 14-day free trial.',
  upgrade_url: '/pricing',
} as const;

export function proRequiredResponse(): NextResponse {
  return NextResponse.json(PRO_REQUIRED_BODY, { status: 402 });
}

/** Does this verified email get Pro features right now? Staff always do. */
export async function isProEmail(email: string | null | undefined): Promise<boolean> {
  const e = String(email || '').toLowerCase().trim();
  if (!e || !e.includes('@')) return false;
  if (getStaffRole(e) !== 'none') return true;
  try {
    return (await resolveAccess(e)).level === 'pro';
  } catch {
    return false;
  }
}

export type RequireProResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 402; response: NextResponse };

/** Verify the MI session, then require Pro. Email always comes from the verified token. */
export async function requirePro(request: NextRequest, expectedEmail?: string | null): Promise<RequireProResult> {
  const auth = requireMIAuthSession(request, expectedEmail || null);
  if (!auth.ok) return { ok: false, status: 401, response: auth.response };
  const email = String(auth.session.email || '').toLowerCase().trim();
  if (await isProEmail(email)) return { ok: true, email };
  return { ok: false, status: 402, response: proRequiredResponse() };
}
