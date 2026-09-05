/**
 * Briefings entitlement ↔ delivery reconciliation.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * Briefings need TWO flags in TWO tables to agree:
 *   user_profiles.access_briefings            — "they are entitled"
 *   user_notification_settings.briefings_enabled — "the cron will send to them"
 *
 * `precompute-briefings` builds its audience with
 * `.eq('briefings_enabled', true)`. So entitlement alone delivers nothing.
 *
 * `briefings_enabled` has NO single default — which is the whole trap. The
 * COLUMN declares `BOOLEAN DEFAULT TRUE`
 * (src/lib/supabase/unified-notifications-schema.sql:50) and the preferences
 * INSERT writer defaults it `true`, but the `app/profile` row-creation path
 * (plus free-profile, bootcamp-rollout, batch-enroll-alerts) writes it FALSE
 * explicitly. So a stored `false` records WHICH CODE PATH created the row, not
 * what the user wanted. Do not read it as a property of the column: an earlier
 * version of this comment said it "defaults to FALSE on profile creation",
 * which is false of the schema and was the model this repair had to correct.
 *
 * The Stripe webhook sets it true — but ONLY on that path. Every other way of
 * granting access (admin grant, FHC sync, MI onboarding, bundle purchase
 * applied by hand, user-audit) writes `access_briefings` in user_profiles and
 * never touches the settings row.
 *
 * Because the value cannot say which purpose wrote it, the repair keys its
 * decision on `is_active` instead. Full reasoning and the decision table:
 * docs/engineering/briefings-enabled-contract.md
 *
 * Result, found 2026-08-05: 27 active accounts entitled to briefings with
 * delivery switched off — 14 of them with purchases totalling $7,202. They had
 * real targeting and were receiving alerts, so nothing looked broken. They had
 * simply never received a briefing they paid for.
 *
 * Rather than patch a dozen grant sites (which is how this drifted in the first
 * place — the next new grant path would miss it too), grant paths call
 * `enableBriefingsDelivery()` and a watchdog re-checks the invariant daily.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isBriefingEntitled } from '@/lib/briefings/delivery/rollout';

export interface EnableBriefingsResult {
  ok: boolean;
  /** true when this call actually flipped the flag (false = already on, or skipped) */
  changed: boolean;
  /** set when we deliberately did nothing */
  skipped?: 'opted_out' | 'no_settings_row' | 'opt_out_unknown';
  error?: string;
}

/**
 * Turn on briefing DELIVERY for someone who has just been granted access.
 *
 * Call this anywhere `user_profiles.access_briefings` is set to true.
 * Safe to call repeatedly — it no-ops when delivery is already enabled.
 *
 * Deliberately does NOT create a settings row: without NAICS or keywords a
 * briefing is generic, and inventing targeting is worse than sending nothing.
 * The absence is reported so the caller can route them to onboarding.
 *
 * NEVER re-enables someone with `is_active = false` — that is an explicit
 * opt-out and an entitlement does not override it. A NULL `is_active` is
 * UNKNOWN, not permission: it is reported as `opt_out_unknown` and skipped.
 */
export async function enableBriefingsDelivery(
  supabase: SupabaseClient,
  email: string,
): Promise<EnableBriefingsResult> {
  const userEmail = String(email || '').toLowerCase().trim();
  if (!userEmail) return { ok: false, changed: false, error: 'no email' };

  const { data: settings, error: readErr } = await supabase
    .from('user_notification_settings')
    .select('user_email, briefings_enabled, is_active')
    .eq('user_email', userEmail)
    .maybeSingle();

  if (readErr) return { ok: false, changed: false, error: readErr.message };

  // No settings row — they have no targeting, so a briefing would be generic.
  // Report it instead of fabricating one.
  if (!settings) return { ok: true, changed: false, skipped: 'no_settings_row' };

  // An explicit opt-out outranks an entitlement.
  if (settings.is_active === false) return { ok: true, changed: false, skipped: 'opted_out' };

  // `is_active` is nullable (schema: BOOLEAN DEFAULT TRUE, no NOT NULL), so a
  // NULL is genuinely UNKNOWN — an explicit opt-out and an unprovisioned row
  // are indistinguishable. Fail CLOSED rather than enable delivery on a guess.
  if (settings.is_active === null || settings.is_active === undefined) {
    return { ok: true, changed: false, skipped: 'opt_out_unknown' };
  }

  if (settings.briefings_enabled === true) return { ok: true, changed: false };

  const { error: writeErr } = await supabase
    .from('user_notification_settings')
    .update({ briefings_enabled: true, updated_at: new Date().toISOString() })
    .eq('user_email', userEmail);

  if (writeErr) return { ok: false, changed: false, error: writeErr.message };
  return { ok: true, changed: true };
}

export interface DriftRow {
  user_email: string;
  naics_count: number;
  keyword_count: number;
  paid_status: boolean | null;
  /**
   * Does this account pass customer_classifications — the gate the SENDER
   * enforces? When false, setting briefings_enabled=true delivers nothing:
   * the account just moves from being skipped at one gate to the next.
   */
  entitlement_ok: boolean;
  /** Current briefings_access, or null when there is no classification row. */
  briefings_access: string | null;
}

/**
 * Find accounts entitled to briefings whose delivery is switched off — the
 * invariant `access_briefings = true` ⇒ `briefings_enabled = true`.
 *
 * Read-only. Excludes opt-outs (`is_active = false`) and accounts with no
 * targeting at all, since a briefing for those would be generic — both are
 * legitimately off, not drift.
 */
export async function findBriefingsDrift(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; rows: DriftRow[]; error?: string }> {
  const { data: entitled, error: profErr } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('access_briefings', true);

  if (profErr) return { ok: false, rows: [], error: profErr.message };

  const emails = (entitled || [])
    .map(r => String((r as { email?: string }).email || '').toLowerCase().trim())
    .filter(Boolean);
  if (emails.length === 0) return { ok: true, rows: [] };

  const rows: DriftRow[] = [];
  // Chunked so a large entitled population doesn't blow the URL length.
  const CHUNK = 200;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const slice = emails.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, paid_status')
      .in('user_email', slice)
      .eq('briefings_enabled', false)
      .eq('is_active', true);

    if (error) return { ok: false, rows: [], error: error.message };

    // The gate the sender actually enforces. Without it this monitor reported
    // "fix: set briefings_enabled=true" for accounts where that is a NO-OP
    // (2026-08-14: all 18 it named were blocked here instead).
    const { data: classRows, error: classErr } = await supabase
      .from('customer_classifications')
      .select('email, briefings_access, briefings_expiry')
      .in('email', slice);
    if (classErr) return { ok: false, rows: [], error: classErr.message };

    const byEmail = new Map<string, { briefings_access: string | null; briefings_expiry: string | null }>();
    for (const c of classRows || []) {
      const cr = c as { email: string; briefings_access?: string | null; briefings_expiry?: string | null };
      byEmail.set(String(cr.email).toLowerCase().trim(), {
        briefings_access: cr.briefings_access ?? null,
        briefings_expiry: cr.briefings_expiry ?? null,
      });
    }

    for (const r of data || []) {
      const row = r as { user_email: string; naics_codes?: unknown[] | null; keywords?: unknown[] | null; paid_status?: boolean | null };
      const naics = (row.naics_codes || []).length;
      const kw = (row.keywords || []).length;
      // No targeting at all → a briefing would be generic. Not drift.
      if (naics === 0 && kw === 0) continue;
      const key = String(row.user_email).toLowerCase().trim();
      const cls = byEmail.get(key);
      rows.push({
        user_email: row.user_email,
        naics_count: naics,
        keyword_count: kw,
        paid_status: row.paid_status ?? null,
        entitlement_ok: cls ? isBriefingEntitled({ email: key, ...cls }) : false,
        briefings_access: cls ? cls.briefings_access : null,
      });
    }
  }

  return { ok: true, rows };
}

/* ══════════════════════════════════════════════════════════════════════════
 * AUDITED BOTH-SIDES ENTITLEMENT REPAIR (TASK-STRIPE-DUP-004)
 *
 * WHY THIS EXISTS
 *
 * No supported operation wrote BOTH sides of the briefings entitlement, so a
 * paid-but-locked-out customer could not be repaired without hand-writing one
 * of them:
 *
 *   admin grant-briefings ?grant=   → KV only (audits wroteProfile:false)
 *   admin sync-access execute       → KV only
 *   reconcileEntitlementsFromPurchases
 *                                   → profile + KV, but returns early on
 *                                     `if (!row.tier && !row.bundle) continue`
 *                                     and every affected row carries tier NULL
 *                                     or 'backfill_unknown'
 *
 * So this operation derives the entitlement from STRIPE EVIDENCE rather than
 * from the purchase ledger, which means the historical rows can stay exactly
 * as they are (they are read-only here, deliberately).
 *
 * DESIGN RULES, each one a scar:
 *
 *  • Dry-run is the DEFAULT. Writing requires `execute: true` AND an
 *    administrator AND an explicit confirm.
 *  • Entitlement comes from product/price `metadata.tier`, never from the
 *    product NAME and never from the price AMOUNT. Ambiguous metadata is
 *    refused, not guessed — a plausible guess is how a $99 MCP subscriber
 *    would wrongly receive app entitlement.
 *  • A write is only "successful" when a POSTCONDITION RE-READ proves the
 *    intended value is actually there. `Boolean({})` is true, which is how
 *    the webhook came to audit profile writes that never happened.
 *  • Every external read/write failure is surfaced. A failed read is NEVER
 *    interpreted as "no record" (Bug Prevention Rule #11).
 *  • Revocation is SYMMETRIC: both stores clear together when the FINAL
 *    qualifying entitlement ends, and neither clears while another qualifying
 *    subscription survives.
 *  • `briefings_enabled` is provisioning state with a narrow user override —
 *    see docs/engineering/briefings-enabled-contract.md. An explicit opt-out
 *    (`is_active = false`) is preserved; entitlement never overrides it.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Live Stripe evidence for one subscription. Supplied by the caller — this
 *  module never talks to Stripe itself, which is what keeps it testable. */
export interface StripeSubscriptionEvidence {
  subscriptionId: string;
  status: string;
  productId: string;
  productMetadata: Record<string, string>;
  priceId: string;
  priceMetadata: Record<string, string>;
  interval: 'month' | 'year' | string;
  unitAmount: number | null;
  /** ISO. The REAL period end — annual expiry is derived from this, never guessed. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Present when the caller checked for an upcoming invoice. */
  hasUpcomingInvoice?: boolean;
}

export interface EntitlementProfileState {
  access_briefings: boolean;
  briefings_expires_at: string | null;
}

/**
 * The delivery row as the repair must see it.
 *
 * `is_active` is deliberately `boolean | null`, NOT `boolean`. The column is
 * declared `is_active BOOLEAN DEFAULT TRUE` with no NOT NULL constraint
 * (src/lib/supabase/unified-notifications-schema.sql:71), so a row can hold
 * NULL. Narrowing that to a boolean at the adapter (`is_active !== false`)
 * would resolve "unknown" to "not opted out" and enable delivery — a
 * fail-OPEN coercion on exactly the distinction the contract turns on, and
 * the null-to-value coercion Bug Prevention Rule #11 forbids.
 *
 * Keeping the third value lets the engine fail CLOSED when it cannot tell an
 * explicit opt-out from an unprovisioned row.
 */
export interface EntitlementSettingsState {
  briefings_enabled: boolean;
  /** true = active · false = explicit opt-out · null = UNKNOWN (never assume) */
  is_active: boolean | null;
}

/** Every external effect, injected. Hermetic by construction. */
export interface EntitlementRepairDeps {
  readStripeSubscriptions: (email: string) => Promise<StripeSubscriptionEvidence[]>;
  readProfile: (email: string) => Promise<EntitlementProfileState | null>;
  writeProfile: (patch: Partial<EntitlementProfileState>, email: string) => Promise<void>;
  readSettings: (email: string) => Promise<EntitlementSettingsState | null>;
  writeSettings: (patch: { briefings_enabled: boolean }, email: string) => Promise<void>;
  readKv: (email: string) => Promise<boolean>;
  writeKv: (value: boolean, email: string) => Promise<void>;
  /** Read-only. Present so the operation can REPORT ledger state it must not edit. */
  readPurchases?: (email: string) => Promise<Array<{ tier: string | null; status: string }>>;
  recordAudit: (entry: {
    email: string;
    capability: 'briefings';
    action: 'grant' | 'revoke';
    source: 'admin_manual';
    actor: string;
    reason: string;
    wroteKv: boolean;
    wroteProfile: boolean;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}

export interface EntitlementRepairOptions {
  role: string;
  actor: string;
  confirm?: boolean;
  /** Writes happen ONLY when this is explicitly true. Absent = dry-run. */
  execute?: boolean;
  /** A subscription known to be ending, for the duplicate-subscription case. */
  endedSubscriptionId?: string;
}

export interface EntitlementRepairResult {
  ok: boolean;
  dryRun: boolean;
  /** Undefined when entitlement could not be established (e.g. Stripe failed). */
  qualifies?: boolean;
  changed: boolean;
  intended?: {
    access_briefings: boolean;
    briefings_expires_at: string | null;
    kv: boolean;
    briefings_enabled: boolean;
  };
  survivingSubscriptionIds: string[];
  /**
   * Why delivery was left untouched. `opt_out_unknown` means `is_active` was
   * NULL: the repair could not tell an explicit opt-out from an unprovisioned
   * row, so it failed closed and preserved the stored value.
   */
  deliverySkipped?: 'opted_out' | 'no_settings_row' | 'opt_out_unknown';
  refusedReason?: 'not_administrator' | 'not_confirmed' | 'ambiguous_entitlement' | 'no_email';
  failures: string[];
}

const BRIEFINGS_TIERS = new Set([
  'briefings',
  'briefings_monthly',
  'briefings_annual',
  'briefings_lifetime',
]);

/** A subscription counts only while it is genuinely live. */
function isLiveStatus(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * Does this subscription entitle the holder to briefings?
 *
 * `null` means AMBIGUOUS — no authoritative tier on either the product or the
 * price. That is deliberately NOT the same as "no": we refuse rather than fall
 * back to the product-name /mindy/i heuristic or the price amount, both of
 * which would mis-grant.
 */
function entitlementFromEvidence(s: StripeSubscriptionEvidence): boolean | null {
  const tier = s.productMetadata?.tier ?? s.priceMetadata?.tier ?? null;
  if (tier === null || tier === undefined || tier === '') return null;
  return BRIEFINGS_TIERS.has(tier);
}

function describeFailure(scope: string, err: unknown): string {
  return `${scope}: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Repair (or symmetrically revoke) a single identity's briefings entitlement
 * across BOTH stores, deriving the truth from live Stripe evidence.
 *
 * Dry-run by default. Returns the exact intended end-state either way.
 */
export async function repairEntitlement(
  email: string,
  deps: EntitlementRepairDeps,
  options: EntitlementRepairOptions,
): Promise<EntitlementRepairResult> {
  const failures: string[] = [];
  const base: EntitlementRepairResult = {
    ok: false,
    dryRun: options.execute !== true,
    changed: false,
    survivingSubscriptionIds: [],
    failures,
  };

  const userEmail = String(email || '').toLowerCase().trim();
  if (!userEmail) return { ...base, refusedReason: 'no_email' };

  // (1) Administrator + explicit confirmation. Checked BEFORE any read.
  if (options.role !== 'administrator') return { ...base, refusedReason: 'not_administrator' };
  if (options.confirm !== true) return { ...base, refusedReason: 'not_confirmed' };

  const execute = options.execute === true;
  const dryRun = !execute;

  // ── Establish what Stripe says. A failure here is fatal: it must never be
  //    laundered into "this identity has no subscription", which would revoke
  //    a paying customer.
  let subs: StripeSubscriptionEvidence[];
  try {
    subs = await deps.readStripeSubscriptions(userEmail);
  } catch (err) {
    failures.push(describeFailure('stripe read failed', err));
    return { ...base, dryRun, failures };
  }

  // Anything ending is excluded from the surviving set — that is the whole
  // point of the duplicate-subscription case.
  const ended = options.endedSubscriptionId;
  const live = subs.filter((s) => isLiveStatus(s.status) && s.subscriptionId !== ended);

  // Ambiguity is only a refusal when it could change the ANSWER: a subscription
  // with no authoritative tier, and nothing else qualifying to fall back on.
  const qualifying = live.filter((s) => entitlementFromEvidence(s) === true);
  const ambiguous = live.filter((s) => entitlementFromEvidence(s) === null);
  if (qualifying.length === 0 && ambiguous.length > 0) {
    return { ...base, dryRun, refusedReason: 'ambiguous_entitlement' };
  }

  const qualifies = qualifying.length > 0;

  // (9) Expiry is DERIVED. Monthly carries none (revocation happens on cancel);
  //     annual carries the real current_period_end. With several qualifying
  //     subscriptions, the furthest-out expiry wins, and any monthly among them
  //     means no expiry at all.
  let intendedExpiry: string | null = null;
  if (qualifies) {
    const anyMonthly = qualifying.some((s) => s.interval === 'month');
    if (!anyMonthly) {
      const ends = qualifying
        .map((s) => s.currentPeriodEnd)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      intendedExpiry = ends.length
        ? ends.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
        : null;
    }
  }

  // ── Current state of BOTH stores. A failed read aborts; it is not "missing".
  let profile: EntitlementProfileState | null;
  try {
    profile = await deps.readProfile(userEmail);
  } catch (err) {
    failures.push(describeFailure('profile read failed', err));
    return { ...base, dryRun, qualifies, failures };
  }

  let kvNow: boolean;
  try {
    kvNow = await deps.readKv(userEmail);
  } catch (err) {
    failures.push(describeFailure('kv read failed', err));
    return { ...base, dryRun, qualifies, failures };
  }

  let settings: EntitlementSettingsState | null;
  try {
    settings = await deps.readSettings(userEmail);
  } catch (err) {
    failures.push(describeFailure('settings read failed', err));
    return { ...base, dryRun, qualifies, failures };
  }

  // (10) Delivery follows the proven contract: provisioning state carrying a
  //      narrow explicit user override. Never fabricate a settings row, and
  //      never resolve an ambiguous row in favour of writing.
  //
  //      Three distinct reasons to leave delivery alone, reported separately
  //      because they need different human follow-up:
  //        no_settings_row    — nothing to enable; route them to onboarding
  //        opted_out          — the user set is_active=false themselves
  //        opt_out_unknown    — is_active is NULL, so an explicit opt-out and
  //                             an unprovisioned row are INDISTINGUISHABLE.
  //                             Fail CLOSED: preserve the stored value.
  //
  //      Failing closed is the safe direction here and is not symmetric: the
  //      cost of wrongly enabling is emailing someone who opted out (a trust
  //      and CAN-SPAM problem, invisible to us); the cost of wrongly skipping
  //      is a reported `opt_out_unknown` an operator can resolve. Entitlement
  //      itself (access_briefings + KV) is still repaired either way, so the
  //      customer is never left unpaid-for — only undelivered, and visibly so.
  let deliverySkipped: EntitlementRepairResult['deliverySkipped'];
  if (!settings) deliverySkipped = 'no_settings_row';
  else if (settings.is_active === false) deliverySkipped = 'opted_out';
  else if (settings.is_active === null) deliverySkipped = 'opt_out_unknown';

  const intendedDelivery = qualifies && !deliverySkipped ? true : settings?.briefings_enabled ?? false;

  const intended = {
    access_briefings: qualifies,
    briefings_expires_at: qualifies ? intendedExpiry : null,
    kv: qualifies,
    briefings_enabled: intendedDelivery,
  };

  const survivingSubscriptionIds = qualifying.map((s) => s.subscriptionId);

  // (2) DRY-RUN: report the exact end-state, write nothing, audit nothing.
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      qualifies,
      changed: false,
      intended,
      survivingSubscriptionIds,
      deliverySkipped,
      failures,
    };
  }

  // ── Execute. Each side is written ONLY when it actually differs, so an
  //    empty update can never be reported (or audited) as a write.
  const profileNeedsWrite =
    !profile ||
    profile.access_briefings !== intended.access_briefings ||
    (profile.briefings_expires_at ?? null) !== intended.briefings_expires_at;
  const kvNeedsWrite = kvNow !== intended.kv;
  const deliveryNeedsWrite =
    !deliverySkipped && settings !== null && settings.briefings_enabled !== intended.briefings_enabled;

  let wroteProfile = false;
  let wroteKv = false;

  if (profileNeedsWrite) {
    try {
      await deps.writeProfile(
        {
          access_briefings: intended.access_briefings,
          briefings_expires_at: intended.briefings_expires_at,
        },
        userEmail,
      );
      wroteProfile = true;
    } catch (err) {
      failures.push(describeFailure('profile write failed', err));
    }
  }

  if (kvNeedsWrite) {
    try {
      await deps.writeKv(intended.kv, userEmail);
      wroteKv = true;
    } catch (err) {
      failures.push(describeFailure('kv write failed', err));
    }
  }

  if (deliveryNeedsWrite) {
    try {
      await deps.writeSettings({ briefings_enabled: intended.briefings_enabled }, userEmail);
    } catch (err) {
      failures.push(describeFailure('settings write failed', err));
    }
  }

  // (6) POSTCONDITION: re-read both stores and prove the end-state. A write
  //     that reports success without this is exactly the failure mode that put
  //     two lying rows in access_grants.
  let verifiedProfile = false;
  let verifiedKv = false;
  try {
    const after = await deps.readProfile(userEmail);
    verifiedProfile =
      !!after &&
      after.access_briefings === intended.access_briefings &&
      (after.briefings_expires_at ?? null) === intended.briefings_expires_at;
    if (!verifiedProfile) {
      failures.push('postcondition failed: user_profiles does not show the intended entitlement');
    }
  } catch (err) {
    failures.push(describeFailure('postcondition profile re-read failed', err));
  }

  try {
    verifiedKv = (await deps.readKv(userEmail)) === intended.kv;
    if (!verifiedKv) {
      failures.push('postcondition failed: KV does not show the intended entitlement');
    }
  } catch (err) {
    failures.push(describeFailure('postcondition kv re-read failed', err));
  }

  const changed = wroteProfile || wroteKv;
  const ok = failures.length === 0;

  // (5)(7) Audit what was ACTUALLY written — never object truthiness, and only
  //        a write whose postcondition held counts as a write.
  try {
    await deps.recordAudit({
      email: userEmail,
      capability: 'briefings',
      action: qualifies ? 'grant' : 'revoke',
      source: 'admin_manual',
      actor: options.actor,
      reason: `TASK-STRIPE-DUP-004 entitlement repair (${qualifies ? 'grant' : 'revoke'})`,
      wroteKv: wroteKv && verifiedKv,
      wroteProfile: wroteProfile && verifiedProfile,
      metadata: {
        qualifies,
        surviving_subscription_ids: survivingSubscriptionIds,
        ended_subscription_id: ended ?? null,
        intended,
        delivery_skipped: deliverySkipped ?? null,
        postcondition_profile_verified: verifiedProfile,
        postcondition_kv_verified: verifiedKv,
        failures,
      },
    });
  } catch (err) {
    failures.push(describeFailure('audit write failed', err));
  }

  return {
    ok: ok && failures.length === 0,
    dryRun: false,
    qualifies,
    changed,
    intended,
    survivingSubscriptionIds,
    deliverySkipped,
    failures,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Production wiring.
 *
 * `repairEntitlement` above is deliberately pure — every external effect is
 * injected — which is what lets the whole contract be tested without touching
 * live Stripe, Supabase, KV or email. This builder is the ONLY place the real
 * clients are bound.
 *
 * Every read/write here binds and inspects its error and THROWS on failure, so
 * the engine surfaces it. A failed read must never reach the engine looking
 * like an absent record (Bug Prevention Rule #11).
 * ────────────────────────────────────────────────────────────────────────── */
export function buildEntitlementRepairDeps(): EntitlementRepairDeps {
  const admin = () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase service-role credentials are not configured');
    // Imported lazily so this module stays importable in contexts without the SDK env.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  };

  return {
    /**
     * LIVE Stripe evidence for this identity: product id, price id,
     * subscription id and status — plus the product/price metadata that is the
     * AUTHORITATIVE tier signal (never the product name, never the amount).
     */
    readStripeSubscriptions: async (email) => {
      const { getStripe } = await import('@/lib/stripe');
      const stripe = getStripe();

      const customers = await stripe.customers.list({ email, limit: 100 });
      const out: StripeSubscriptionEvidence[] = [];

      for (const customer of customers.data) {
        const subs = await stripe.subscriptions.list({
          customer: customer.id,
          status: 'all',
          limit: 100,
          expand: ['data.items.data.price.product'],
        });

        for (const s of subs.data) {
          const item = s.items.data[0];
          const price = item?.price;
          const product = price?.product;
          const productObj =
            product && typeof product === 'object' && !('deleted' in product && product.deleted)
              ? product
              : null;

          out.push({
            subscriptionId: s.id,
            status: s.status,
            productId: productObj?.id ?? (typeof product === 'string' ? product : ''),
            productMetadata: (productObj?.metadata ?? {}) as Record<string, string>,
            priceId: price?.id ?? '',
            priceMetadata: (price?.metadata ?? {}) as Record<string, string>,
            interval: price?.recurring?.interval ?? 'unknown',
            unitAmount: price?.unit_amount ?? null,
            currentPeriodEnd: (item as { current_period_end?: number } | undefined)?.current_period_end
              ? new Date((item as { current_period_end: number }).current_period_end * 1000).toISOString()
              : null,
            cancelAtPeriodEnd: s.cancel_at_period_end === true,
          });
        }
      }

      return out;
    },

    readProfile: async (email) => {
      const { data, error } = await admin()
        .from('user_profiles')
        .select('access_briefings, briefings_expires_at')
        .eq('email', email)
        .maybeSingle();
      if (error) throw new Error(`user_profiles read failed: ${error.message}`);
      if (!data) return null;
      return {
        access_briefings: data.access_briefings === true,
        briefings_expires_at: (data.briefings_expires_at as string | null) ?? null,
      };
    },

    writeProfile: async (patch, email) => {
      const { error } = await admin()
        .from('user_profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('email', email);
      if (error) throw new Error(`user_profiles write failed: ${error.message}`);
    },

    readSettings: async (email) => {
      const { data, error } = await admin()
        .from('user_notification_settings')
        .select('briefings_enabled, is_active')
        .eq('user_email', email)
        .maybeSingle();
      if (error) throw new Error(`user_notification_settings read failed: ${error.message}`);
      if (!data) return null;
      // is_active is preserved as THREE-VALUED. `data.is_active !== false`
      // would flatten NULL to true and enable delivery for a row whose opt-out
      // state is unknown; `?? false` would flatten it to an opt-out and strand
      // a payer. Neither is knowledge — pass the null through and let the
      // engine fail closed with a reportable `opt_out_unknown`.
      const rawActive = data.is_active;
      return {
        briefings_enabled: data.briefings_enabled === true,
        is_active: rawActive === null || rawActive === undefined ? null : rawActive === true,
      };
    },

    writeSettings: async (patch, email) => {
      const { error } = await admin()
        .from('user_notification_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('user_email', email);
      if (error) throw new Error(`user_notification_settings write failed: ${error.message}`);
    },

    readKv: async (email) => {
      const { kv } = await import('@vercel/kv');
      // A KV outage THROWS here on purpose: the engine reports it rather than
      // reading an unavailable store as "no access" and revoking a payer.
      return Boolean(await kv.get(`briefings:${email}`));
    },

    writeKv: async (value, email) => {
      const { kv } = await import('@vercel/kv');
      if (value) await kv.set(`briefings:${email}`, 'true');
      else await kv.del(`briefings:${email}`);
    },

    /** READ-ONLY. Present so the operation can report ledger state it must never edit. */
    readPurchases: async (email) => {
      const { data, error } = await admin()
        .from('purchases')
        .select('tier, status')
        .eq('user_email', email);
      if (error) throw new Error(`purchases read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        tier: (r.tier as string | null) ?? null,
        status: String(r.status ?? ''),
      }));
    },

    recordAudit: async (entry) => {
      const { recordAccessGrant } = await import('@/lib/access/grant-audit');
      await recordAccessGrant(entry);
    },
  };
}
