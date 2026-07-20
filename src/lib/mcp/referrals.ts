/**
 * Mindy MCP Referral Program — double-sided referral, verified-signin trigger.
 *
 * A signed-in user shares their referral link (`getmindy.ai/mcp?ref=<code>`). When a
 * REFERRED person completes their FIRST VERIFIED authenticated session (app OAuth/MFA or
 * MCP OAuth), `qualifyReferral` fires: the REFERRER earns REFERRAL_CREDITS. The referred
 * user's own 100 is their standard signup welcome grant (`grantSignupCreditsIfFirst`), so
 * "you both get 100" holds without double-stacking on the referred (lowest farming exposure).
 *
 * Anti-abuse (GOS #009 / Eric's "700×1,000" scar): verified-identity trigger (OAuth/MFA is
 * expensive to fake), self-referral blocked, ONE reward per referred identity
 * (UNIQUE referred_email), per-referrer cap (MCP_REFERRAL_CAP, default 25), and grants routed
 * through the idempotent `applyCreditOnce` so retries/redeliveries never double-pay.
 *
 * Terms: docs/legal/mcp-referral-and-credits-terms.md.
 */
import { randomBytes } from 'crypto';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { applyCreditOnce } from './credits';

export const REFERRAL_CREDITS = Math.max(0, Number(process.env.MCP_REFERRAL_CREDITS ?? '100') || 0);
export const REFERRAL_CAP = Math.max(0, Number(process.env.MCP_REFERRAL_CAP ?? '25') || 0);
/** The cookie a `?ref=<code>` is parked in from landing → first verified sign-in. */
export const REF_COOKIE = 'mindy_ref';

const norm = (e: string) => (e || '').toLowerCase().trim();

/** Get (or lazily create) this user's stable referral code. */
export async function getOrCreateReferralCode(userEmail: string): Promise<string> {
  const email = norm(userEmail);
  const db = getWriteClient();
  const { data: existing } = await db
    .from('mcp_referral_codes').select('code').eq('owner_email', email).maybeSingle();
  if (existing?.code) return existing.code as string;

  // Insert a fresh random code; retry on the rare collision. owner_email is UNIQUE, so a
  // concurrent insert for the same user resolves to a re-read of their row.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomBytes(6).toString('base64url'); // ~8 url-safe chars
    const { error } = await db.from('mcp_referral_codes').insert({ code, owner_email: email });
    if (!error) return code;
    // Owner already has a code (unique violation on owner_email) → return it.
    const { data: row } = await db
      .from('mcp_referral_codes').select('code').eq('owner_email', email).maybeSingle();
    if (row?.code) return row.code as string;
    // else code collided — loop and try a new one.
  }
  throw new Error('getOrCreateReferralCode: could not allocate a code');
}

/** Resolve a referral code → the referrer's email, or null. */
export async function resolveReferrer(code: string | null | undefined): Promise<string | null> {
  if (!code) return null;
  const { data } = await getWriteClient()
    .from('mcp_referral_codes').select('owner_email').eq('code', code).maybeSingle();
  return (data?.owner_email as string) ?? null;
}

export interface ReferralStats {
  code: string;
  link: string;
  qualified: number; // friends who completed a verified sign-in
  creditsEarned: number;
  cap: number;
  reward: number;
}

/** The signed-in user's referral link + stats (for /mcp/account). */
export async function getReferralStats(userEmail: string, origin = 'https://getmindy.ai'): Promise<ReferralStats> {
  const email = norm(userEmail);
  const code = await getOrCreateReferralCode(email);
  const { data } = await getWriteClient()
    .from('mcp_referrals').select('credits,status').eq('referrer_email', email).eq('status', 'granted');
  const rows = data ?? [];
  return {
    code,
    link: `${origin}/mcp?ref=${code}`,
    qualified: rows.length,
    creditsEarned: rows.reduce((s, r) => s + (Number(r.credits) || 0), 0),
    cap: REFERRAL_CAP,
    reward: REFERRAL_CREDITS,
  };
}

export interface QualifyResult { granted: boolean; reason?: string; referrer?: string }

/**
 * Fire on the referred user's FIRST verified session. Idempotent + guarded. Grants the
 * REFERRER their reward (the referred keeps their separate signup welcome). Safe to call on
 * every sign-in — the guards + `applyCreditOnce` make repeat calls no-ops.
 *
 * NEVER throws to the caller path: any error is swallowed (a referral must never block a login).
 */
export async function qualifyReferral(referredEmail: string, code: string | null | undefined): Promise<QualifyResult> {
  try {
    const referred = norm(referredEmail);
    if (!referred || !code) return { granted: false, reason: 'no_code' };

    const db = getWriteClient();

    // One reward per referred identity, ever (UNIQUE referred_email). If we've already
    // recorded this friend, do nothing.
    const { data: prior } = await db
      .from('mcp_referrals').select('status').eq('referred_email', referred).maybeSingle();
    if (prior) return { granted: prior.status === 'granted', reason: 'already_recorded' };

    const referrer = await resolveReferrer(code);
    if (!referrer) return { granted: false, reason: 'bad_code' };

    // Self-referral blocked.
    if (referrer === referred) {
      await recordRejected(referred, code, referrer, 'self_referral');
      return { granted: false, reason: 'self_referral' };
    }

    // Per-referrer cap.
    const { count } = await db
      .from('mcp_referrals').select('id', { count: 'exact', head: true })
      .eq('referrer_email', referrer).eq('status', 'granted');
    if ((count ?? 0) >= REFERRAL_CAP) {
      await recordRejected(referred, code, referrer, 'referrer_over_cap');
      return { granted: false, reason: 'over_cap' };
    }

    // Grant the referrer, idempotently. Key is per (referrer, referred) so it can't double-pay.
    const { applied } = await applyCreditOnce(
      `referral:referrer:${referrer}:${referred}`,
      referrer,
      REFERRAL_CREDITS,
      'referral',
    );

    // Record the granted referral (referred_email UNIQUE dedupes concurrent qualifies).
    await db.from('mcp_referrals').insert({
      referrer_email: referrer,
      referred_email: referred,
      ref_code: code,
      status: 'granted',
      credits: REFERRAL_CREDITS,
      qualified_at: new Date().toISOString(),
      granted_at: new Date().toISOString(),
    });

    return { granted: applied, referrer };
  } catch (e) {
    console.error('[mcp:referral] qualify failed (non-fatal):', (e as Error).message);
    return { granted: false, reason: 'error' };
  }
}

/**
 * Convenience for the verified-auth route handlers: read the `mindy_ref` cookie off the
 * request and qualify the referral for the just-authenticated user. Fire-and-forget —
 * never blocks or throws into the login path.
 */
export async function qualifyReferralFromRequest(
  request: { cookies: { get(name: string): { value?: string } | undefined } },
  referredEmail: string,
): Promise<void> {
  try {
    const raw = request.cookies.get(REF_COOKIE)?.value;
    if (!raw) return;
    await qualifyReferral(referredEmail, decodeURIComponent(raw));
  } catch { /* non-fatal — a referral must never break a sign-in */ }
}

async function recordRejected(referred: string, code: string, referrer: string, reason: string): Promise<void> {
  try {
    await getWriteClient().from('mcp_referrals').insert({
      referrer_email: referrer, referred_email: referred, ref_code: code,
      status: 'rejected', reject_reason: reason,
    });
  } catch { /* the UNIQUE(referred_email) may already hold a row — fine */ }
}
