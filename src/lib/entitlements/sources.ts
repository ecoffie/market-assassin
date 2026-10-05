/**
 * R2 — resolve a VERIFIED identity to its entitlement SOURCES. Read-only.
 *
 * This is the only module in R2 that touches storage, and it never writes. It reads the
 * same stores today's helpers read (so a disagreement is a POLICY difference, not a
 * data difference) plus the records that ATTRIBUTE a grant:
 *
 *   KV  briefings:{e}              bare `true` — a live Pro grant with no recorded origin
 *   KV  ma: / contentgen: / ospro: / recompete: / dbaccess:   legacy standalone products
 *   user_profiles                  access_briefings (+expiry), access_team, trial_ends_at
 *   user_notification_settings     trial_ends_at (email-only beta cohort)
 *   customer_classifications       Stripe-derived: lifetime / subscription / 1_year, products
 *   mi_admin_grants                admin grants, with grant_source
 *   mcp_credit_balance             MCP meter (grants nothing)
 *   entitlement_source_observations  shadow-only evidence: Stripe-observed memberships (reconciler)
 *                                  and the frozen D1 grandfather cohort. Inert: no gate reads it.
 *   advocate registry, staff list  in code
 *
 * FAILURE IS 'unknown', NEVER A GUESS. Any read error makes the whole result
 * `complete: false`; the shadow logger records `canonical = unknown` rather than
 * inventing a deny (or an allow) from a partial read.
 */
import { kv } from '@vercel/kv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getStaffRole } from '@/lib/api-auth';
import { isTrialOpen } from '@/lib/access/resolve-access';
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import type { EntitlementSource, LegacyProduct } from './policy';

export interface ResolvedSources {
  email: string;
  sources: EntitlementSource[];
  /** false when any read failed — callers must treat the decision as unknown. */
  complete: boolean;
  /** Read failures, by store name only (no customer data). */
  failures: string[];
}

/** Minimal inputs, so the attribution rule is unit-testable without I/O. */
export interface SourceFacts {
  kvBriefings: boolean;
  profile: {
    access_briefings?: boolean | null;
    briefings_expires_at?: string | null;
    access_team?: boolean | null;
    trial_ends_at?: string | null;
  } | null;
  notifTrialEndsAt: string | null;
  classification: {
    briefings_access?: string | null;
    briefings_expiry?: string | null;
    has_active_subscription?: boolean | null;
    products_purchased?: unknown;
  } | null;
  latestAdminGrant: { action?: string | null; tier?: string | null; grant_source?: string | null } | null;
  legacy: Partial<Record<LegacyProduct, boolean>>;
  mcpBalance: number | null;
  /** Non-ended rows from entitlement_source_observations. */
  observations: Array<{ source: string; status: string }>;
  isStaff: boolean;
  isAdvocate: boolean;
  trialProgramOpen: boolean;
  now: number;
}

const FOUNDER_PRODUCT = /founder/i;

function notExpired(iso: string | null | undefined, now: number): boolean {
  return !iso || new Date(iso).getTime() >= now;
}

function productNames(products: unknown): string[] {
  if (Array.isArray(products)) return products.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
  if (typeof products === 'string') return [products];
  return [];
}

/**
 * Pure attribution. Every source a user holds is listed; nothing is collapsed to a tier.
 */
export function attributeSources(f: SourceFacts): EntitlementSource[] {
  const out = new Set<EntitlementSource>();
  const now = f.now;

  const profileBriefings = !!f.profile?.access_briefings && notExpired(f.profile?.briefings_expires_at, now);
  const liveProGrant = f.kvBriefings || profileBriefings;

  if (f.profile?.access_team) out.add('stripe_team');

  // ATTRIBUTION ONLY. customer_classifications is a point-in-time Stripe snapshot (most rows
  // classified 2026-05, products_purchased usually empty): measured 2026-10-04, 33 accounts
  // read "subscription"/"lifetime" there with NO live grant — cancelled or churned since. So a
  // classification never CREATES a source; it only explains a grant that is live right now.
  const cls = f.classification;
  const products = productNames(cls?.products_purchased);
  if (liveProGrant && cls && notExpired(cls.briefings_expiry, now)) {
    if (cls.briefings_access === 'lifetime') {
      out.add(products.some((p) => FOUNDER_PRODUCT.test(p)) ? 'founder' : 'lifetime_mindy');
    } else if (cls.briefings_access === 'subscription' || cls.briefings_access === '1_year') {
      out.add('stripe_pro');
    }
  }

  // Admin grants. `stripe_member` is the grant_source the $99-membership reconciler will
  // write (ruling 2026-10-03; commercial-actions-packet §3). Until it exists, membership is
  // a defined source with no feed — those members are reported from Stripe, not resolved here.
  const g = f.latestAdminGrant;
  if (g && (g.action || 'grant') !== 'revoke' && liveProGrant) {
    out.add(g.grant_source === 'stripe_member' ? 'membership' : 'manual_grant');
  }

  // A live Pro grant that nothing above explains is reported, not adjudicated.
  const attributed = ['stripe_pro', 'lifetime_mindy', 'founder', 'membership', 'manual_grant']
    .some((s) => out.has(s as EntitlementSource));
  if (liveProGrant && !attributed) out.add('pro_unattributed');

  if (f.trialProgramOpen) {
    const ends = f.profile?.trial_ends_at || f.notifTrialEndsAt;
    if (ends && new Date(ends).getTime() >= now) out.add('trial');
  }
  if (f.isStaff) out.add('staff');
  if (f.isAdvocate) out.add('advocate');
  for (const [product, has] of Object.entries(f.legacy)) {
    if (has) out.add(`legacy:${product as LegacyProduct}`);
  }
  if ((f.mcpBalance ?? 0) > 0) out.add('mcp_credit_balance');

  for (const o of f.observations) {
    if (o.source === 'membership') {
      if (o.status === 'active') out.add('membership');
      else if (o.status === 'past_due') out.add('membership_past_due');
    } else if (o.source === 'membership_unruled' && o.status !== 'ended') {
      out.add('membership_unruled');
    } else if (o.source === 'legacy_mindy_grandfather' && o.status === 'active') {
      out.add('legacy_mindy_grandfather');
    }
  }

  return [...out];
}

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * @param identityVerified MUST be true only when the email came from a verified session,
 *   signed link or MCP key/OAuth identity. Staff is never inferred from a claimed email.
 */
export async function resolveEntitlementSources(
  rawEmail: string,
  { identityVerified, observations }: {
    identityVerified: boolean;
    /** OFFLINE PREVIEW ONLY (scripts): supply observations instead of reading the table. */
    observations?: Array<{ source: string; status: string }>;
  },
): Promise<ResolvedSources> {
  const email = (rawEmail || '').toLowerCase().trim();
  const failures: string[] = [];
  if (!email) return { email, sources: [], complete: true, failures };

  const sb = getSupabase();
  if (!sb) return { email, sources: [], complete: false, failures: ['supabase_unconfigured'] };

  const kvGet = async (key: string, name: string): Promise<unknown> => {
    try { return await kv.get(`${key}:${email}`); } catch { failures.push(`kv:${name}`); return null; }
  };

  const [kvBriefings, ma, contentgen, ospro, recompete, dbaccess, profileRes, notifRes, clsRes, grantRes, balRes, obsRes] =
    await Promise.all([
      kvGet('briefings', 'briefings'),
      kvGet('ma', 'ma'),
      kvGet('contentgen', 'contentgen'),
      kvGet('ospro', 'ospro'),
      kvGet('recompete', 'recompete'),
      kvGet('dbaccess', 'dbaccess'),
      sb.from('user_profiles')
        .select('access_briefings, briefings_expires_at, access_team, trial_ends_at')
        .eq('email', email).maybeSingle(),
      sb.from('user_notification_settings').select('trial_ends_at').eq('user_email', email).maybeSingle(),
      sb.from('customer_classifications')
        .select('briefings_access, briefings_expiry, has_active_subscription, products_purchased')
        .eq('email', email).maybeSingle(),
      sb.from('mi_admin_grants').select('action, tier, grant_source')
        .eq('target_email', email).order('created_at', { ascending: false }).limit(1),
      sb.from('mcp_credit_balance').select('balance').eq('user_email', email).maybeSingle(),
      observations
        ? Promise.resolve({ data: observations, error: null })
        : sb.from('entitlement_source_observations').select('source, status')
          .eq('email', email).neq('status', 'ended').limit(50),
    ]);

  if (profileRes.error) failures.push('user_profiles');
  if (notifRes.error) failures.push('user_notification_settings');
  if (clsRes.error) failures.push('customer_classifications');
  if (grantRes.error) failures.push('mi_admin_grants');
  if (balRes.error) failures.push('mcp_credit_balance');
  if (obsRes.error) failures.push('entitlement_source_observations');

  const maTier = (ma && typeof ma === 'object' ? (ma as { tier?: string }).tier : null) || null;

  const sources = attributeSources({
    kvBriefings: !!kvBriefings,
    profile: profileRes.data ?? null,
    notifTrialEndsAt: (notifRes.data as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null,
    classification: clsRes.data ?? null,
    latestAdminGrant: (grantRes.data && grantRes.data[0]) || null,
    legacy: {
      market_assassin_premium: !!ma && maTier === 'premium',
      market_assassin_standard: !!ma && maTier !== 'premium',
      content_reaper: !!contentgen,
      opportunity_hunter_pro: !!ospro,
      recompete_tracker: !!recompete,
      contractor_database: !!dbaccess,
    },
    mcpBalance: (balRes.data as { balance?: number } | null)?.balance ?? null,
    observations: (obsRes.data as Array<{ source: string; status: string }> | null) ?? [],
    isStaff: identityVerified && getStaffRole(email) !== 'none',
    isAdvocate: isAdvocateAccount(email),
    trialProgramOpen: isTrialOpen(),
    now: Date.now(),
  });

  return { email, sources, complete: failures.length === 0, failures };
}
