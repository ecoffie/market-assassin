/**
 * Backfill: grant LIFETIME Mindy Pro to past bundle buyers (grandfather).
 *
 * The grandfather rubric (PRD-trial-vs-paid-access §A; CLAUDE.md "Tool bundles →
 * Lifetime MI Pro") says every legacy_bundle buyer — Starter / Pro Giant /
 * Ultimate — keeps lifetime Mindy Pro. `updateAccessFlags` now grants that on
 * NEW purchases, but PAST buyers were provisioned under the old code where
 * Starter got no `access_briefings` at all. This reconciles them.
 *
 * For every completed bundle purchase, it ensures:
 *   - user_profiles.access_briefings = true
 *   - user_profiles.briefings_expires_at = null  (lifetime, clears any stray expiry)
 *   - KV `briefings:{email}` = true               (fast gate parity)
 *
 * Admin standard: GET = preview (safe, no writes), POST = execute.
 *   GET  /api/admin/backfill-bundle-mi?password=...
 *   POST /api/admin/backfill-bundle-mi?password=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { grantBriefingsAccess } from '@/lib/briefings/access';

export const dynamic = 'force-dynamic';

// All bundle identifiers the webhook has ever written (short names + full IDs).
const BUNDLE_VALUES = [
  'starter', 'govcon-starter-bundle',
  'pro', 'pro-giant-bundle',
  'ultimate', 'ultimate-govcon-bundle', 'complete',
];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface BuyerState {
  email: string;
  bundle: string;
  access_briefings: boolean | null;
  briefings_expires_at: string | null;
  needsGrant: boolean;   // access_briefings not yet true
  needsExpiryClear: boolean; // has a stray expiry → make lifetime
}

async function collectBuyers(): Promise<{ buyers: BuyerState[]; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { buyers: [], error: 'Supabase not configured' };

  // 1) Distinct bundle buyers from the purchases ledger (source of truth).
  const { data: purchases, error: pErr } = await supabase
    .from('purchases')
    .select('user_email, bundle, created_at')
    .in('bundle', BUNDLE_VALUES)
    .eq('status', 'completed');
  if (pErr) return { buyers: [], error: pErr.message };

  // Keep the most recent bundle per email.
  const latest = new Map<string, { bundle: string; at: string }>();
  for (const r of (purchases || []) as { user_email: string; bundle: string; created_at: string }[]) {
    const email = (r.user_email || '').toLowerCase().trim();
    if (!email) continue;
    const prev = latest.get(email);
    if (!prev || (r.created_at || '') > prev.at) latest.set(email, { bundle: r.bundle, at: r.created_at || '' });
  }
  const emails = [...latest.keys()];
  if (emails.length === 0) return { buyers: [] };

  // 2) Current entitlement state per buyer (chunked .in to stay under limits).
  const profileByEmail = new Map<string, { access_briefings: boolean | null; briefings_expires_at: string | null }>();
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const { data } = await supabase
      .from('user_profiles')
      .select('email, access_briefings, briefings_expires_at')
      .in('email', chunk);
    for (const p of (data || []) as { email: string; access_briefings: boolean | null; briefings_expires_at: string | null }[]) {
      profileByEmail.set((p.email || '').toLowerCase(), { access_briefings: p.access_briefings, briefings_expires_at: p.briefings_expires_at });
    }
  }

  const buyers: BuyerState[] = emails.map((email) => {
    const prof = profileByEmail.get(email);
    const access_briefings = prof?.access_briefings ?? null;
    const briefings_expires_at = prof?.briefings_expires_at ?? null;
    return {
      email,
      bundle: latest.get(email)!.bundle,
      access_briefings,
      briefings_expires_at,
      needsGrant: access_briefings !== true,
      needsExpiryClear: briefings_expires_at != null,
    };
  });
  return { buyers };
}

function summarize(buyers: BuyerState[]) {
  const toChange = buyers.filter((b) => b.needsGrant || b.needsExpiryClear);
  const byBundle: Record<string, number> = {};
  for (const b of toChange) byBundle[b.bundle] = (byBundle[b.bundle] || 0) + 1;
  return {
    totalBundleBuyers: buyers.length,
    alreadyLifetime: buyers.length - toChange.length,
    toChange: toChange.length,
    needGrant: buyers.filter((b) => b.needsGrant).length,
    needExpiryClear: buyers.filter((b) => b.needsExpiryClear).length,
    changesByBundle: byBundle,
    sample: toChange.slice(0, 25).map((b) => ({ email: b.email, bundle: b.bundle, access_briefings: b.access_briefings, briefings_expires_at: b.briefings_expires_at })),
  };
}

export async function GET(request: NextRequest) {
  if (!verifyAdminPassword(request.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const { buyers, error } = await collectBuyers();
  if (error) return NextResponse.json({ success: false, message: error }, { status: 500 });
  return NextResponse.json({
    success: true,
    message: 'Preview — POST to execute. No writes performed.',
    data: summarize(buyers),
  });
}

export async function POST(request: NextRequest) {
  if (!verifyAdminPassword(request.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ success: false, message: 'Supabase not configured' }, { status: 500 });

  const { buyers, error } = await collectBuyers();
  if (error) return NextResponse.json({ success: false, message: error }, { status: 500 });

  const toChange = buyers.filter((b) => b.needsGrant || b.needsExpiryClear);
  let updated = 0;
  let kvGranted = 0;
  const errors: string[] = [];

  for (const b of toChange) {
    // Supabase entitlement = lifetime: access_briefings true, no expiry.
    const { error: upErr } = await supabase
      .from('user_profiles')
      .update({ access_briefings: true, briefings_expires_at: null, updated_at: new Date().toISOString() })
      .eq('email', b.email);
    if (upErr) { errors.push(`${b.email}: ${upErr.message}`); continue; }
    updated++;
    // KV fast-gate parity (non-fatal — Supabase fallback covers a KV miss).
    try { await grantBriefingsAccess(b.email); kvGranted++; } catch { /* KV optional */ }
  }

  return NextResponse.json({
    success: true,
    message: `Granted lifetime Mindy Pro to ${updated} past bundle buyer(s).`,
    data: { ...summarize(buyers), updated, kvGranted, errorCount: errors.length, errors: errors.slice(0, 20) },
  });
}
