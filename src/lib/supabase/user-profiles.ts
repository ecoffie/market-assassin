import { createClient } from '@supabase/supabase-js';

// Use service role key for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Supabase credentials not configured');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

// Product access flag types (matching your database columns)
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  stripe_customer_id?: string;

  // Access flags (your naming convention)
  access_hunter_pro: boolean;
  access_content_standard: boolean;
  access_content_full_fix: boolean;
  access_assassin_standard: boolean;
  access_assassin_premium: boolean;
  access_recompete: boolean;
  access_contractor_db: boolean;
  access_briefings: boolean;
  // Mindy Team tier ($499/mo, 5 seats). Set by the Stripe webhook
  // when a 'team_monthly' / 'team_annual' purchase comes in. Read
  // by verifyMIAccess() so the dashboard tier resolves to 'team'.
  // Implicitly grants Pro features too — Team is a superset of Pro.
  access_team?: boolean;

  // Briefings-specific fields
  briefings_expires_at?: string; // For time-limited access (Pro Giant = 1 year)

  // License
  license_key?: string;
  license_activated_at?: string;
  bundle?: string;

  created_at: string;
  updated_at: string;
}

export type ProductAccessFlag =
  | 'access_hunter_pro'
  | 'access_content_standard'
  | 'access_content_full_fix'
  | 'access_assassin_standard'
  | 'access_assassin_premium'
  | 'access_recompete'
  | 'access_contractor_db'
  | 'access_briefings'
  | 'access_team';

// Tier types matching your purchases table
export type ProductTier =
  | 'hunter_pro'
  | 'content_standard'
  | 'content_full_fix'
  | 'assassin_standard'
  | 'assassin_premium'
  | 'recompete'
  | 'contractor_db'
  | 'briefings'
  | 'briefings_monthly'
  | 'briefings_annual'
  | 'briefings_lifetime'
  | 'fhc_membership'
  // Mindy Team tier ($499/mo, 5 seats)
  | 'team_monthly'
  | 'team_annual'
  // Upgrade tiers
  | 'assassin_premium_upgrade'
  | 'content_full_fix_upgrade';

/**
 * Generate a license key in format XXXX-XXXX-XXXX-XXXX
 */
export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments: string[] = [];

  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }

  return segments.join('-');
}

/**
 * Get or create a user profile by email
 */
export async function getOrCreateProfile(email: string, name?: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Try to get existing profile
  const { data: existing, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle(); // read that may be empty (new user) — avoids PGRST116 error-log noise

  if (existing && !fetchError) {
    return existing as UserProfile;
  }

  // Create new profile with license key.
  //
  // TWO SCHEMA BUGS FIXED HERE (measured against the live DB, 2026-07-30) — this insert
  // could NEVER succeed, which is why paid customers ended up with no profile row:
  //   1. `name` IS NOT A COLUMN on user_profiles. PostgREST rejected the whole insert with
  //      "Could not find the 'name' column ... in the schema cache". Same failure class as
  //      the purchases ledger (#642): write a column that doesn't exist, fail silently,
  //      still return 200. The caller's `name` arg is kept in the signature (call sites pass
  //      it) but mapped to company_name only when provided.
  //   2. `user_id` is NOT NULL with no default — a FK to auth.users. Omitting it violated
  //      the constraint even after (1) was fixed.
  //
  // Because user_id is an auth FK, a buyer who has NOT signed up yet genuinely cannot have
  // a profile row. That is EXPECTED, not an error: KV is the primary access gate and the
  // row is created at signup. Same soft-skip contract as src/lib/admin/member-grants.ts.
  const userId = await resolveAuthUserId(supabase, normalizedEmail);
  if (!userId) {
    console.warn(
      `[getOrCreateProfile] ${normalizedEmail} has no auth account yet — profile deferred to signup `
      + `(KV grants access meanwhile). Not an error.`,
    );
    return null;
  }

  const licenseKey = generateLicenseKey();

  const { data: newProfile, error: insertError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: userId,
      email: normalizedEmail,
      ...(name ? { company_name: name } : {}),
      license_key: licenseKey,
      access_hunter_pro: false,
      access_content_standard: false,
      access_content_full_fix: false,
      access_assassin_standard: false,
      access_assassin_premium: false,
      access_recompete: false,
      access_contractor_db: false,
      access_briefings: false,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Error creating user profile:', insertError);
    return null;
  }

  console.log(`Created new user profile for ${normalizedEmail} with license key ${licenseKey}`);

  // RECONCILE PRIOR PURCHASES — the pay-then-signup gap.
  //
  // Every access flag above is inserted FALSE. If the customer paid BEFORE they
  // signed up, the webhook already ran and found no row to update (`.eq('email')`
  // matched zero rows), so its flag write silently did nothing — and because the
  // webhook gates its KV write on that same result, KV was never written either.
  // Both gates fail together, and the customer lands here entitled to nothing.
  //
  // MEASURED (2026-08-16): darkwine2004@gmail.com paid $149/mo at 04:06:00, the
  // webhook granted tier 'briefings' at 04:06:01 against a profile that did not
  // exist, and the profile was created at 04:21:22 — 15 minutes later, all-false.
  // Net: an active paying subscriber with access_briefings=false, while a free
  // account had it true. He called support to ask why.
  //
  // A purchase is the durable record of entitlement, so replay it at the moment
  // the row finally exists. Best-effort: a reconcile failure must never block
  // profile creation (the caller needs the row back either way).
  try {
    await reconcileEntitlementsFromPurchases(normalizedEmail);
  } catch (err) {
    console.error(`[getOrCreateProfile] entitlement reconcile failed for ${normalizedEmail} (non-fatal):`, err);
  }

  // THE THIRD GATE. Briefing delivery needs THREE things, and the reconcile above
  // only covers two: access_briefings (profile flag) and briefings_enabled
  // (notification settings). The one that actually decides whether the cron can
  // SEE a user is a customer_classifications row — and nothing created it
  // automatically. Every writer was an /api/admin/* route invoked by hand, and the
  // table was last populated in bulk on 2026-04-29.
  //
  // So the flags drifted apart by design: the Stripe webhook flips
  // briefings_enabled on its own, gate 3 never moved. MEASURED 2026-08-19: 28
  // users had briefings_enabled with no classification row, all of them signed up
  // after the last manual pass — including TWO active $149/mo subscribers who were
  // paying and receiving nothing.
  //
  // Creating the row here makes the gate self-healing at the same chokepoint every
  // account already passes through. Free tier by default; a purchase upgrades it
  // through the normal classification path.
  try {
    await ensureCustomerClassification(normalizedEmail);
  } catch (err) {
    console.error(`[getOrCreateProfile] classification ensure failed for ${normalizedEmail} (non-fatal):`, err);
  }

  return newProfile as UserProfile;
}

/**
 * Create a baseline customer_classifications row if the user has none.
 *
 * INSERT-ONLY, never an update: an existing row may carry a paid tier, a manual
 * comp, or an exclusion, and clobbering that with 'free' would REVOKE access. A
 * unique-violation (23505) is the expected concurrent-signup outcome and is
 * treated as success.
 *
 * Uses the established labels — `free` + `beta_preview` is the existing 123-row
 * convention for self-serve accounts, not an invented pair.
 */
async function ensureCustomerClassification(email: string): Promise<void> {
  const supabase = getAdminClient();
  if (!supabase) return;

  const { data: existing, error: readErr } = await supabase
    .from('customer_classifications')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  // Bind the error explicitly: a failed READ must not be mistaken for "no row"
  // and trigger an insert that then collides.
  if (readErr) {
    console.error(`[ensureCustomerClassification] read failed for ${email}:`, readErr.message);
    return;
  }
  if (existing) return;

  const { error } = await supabase.from('customer_classifications').insert({
    email,
    classification: 'free',
    briefings_access: 'beta_preview',
    briefings_expiry: null,      // null = never expires, matching existing rows
    has_active_subscription: false,
    classification_version: 3,
  });
  // 23505 = another concurrent signup won the race. That is the desired end state.
  if (error && error.code !== '23505') {
    console.error(`[ensureCustomerClassification] insert failed for ${email}:`, error.message);
  }
}

/**
 * Re-apply access flags from a user's own completed purchases.
 *
 * Reads the purchases ledger (the record of what they PAID for) and re-runs the
 * same tier→flag mapping the webhook uses, so entitlement survives a profile that
 * was created after the payment. Idempotent — safe to call on every profile
 * creation and safe to re-run in a backfill.
 *
 * Ignores superseded rows: `superseded_by` marks duplicate checkout writes (two
 * webhooks in two repos write this table), and replaying a duplicate would grant
 * the same thing twice.
 */
export async function reconcileEntitlementsFromPurchases(email: string): Promise<{
  tiers: string[];
  applied: Record<string, boolean>;
}> {
  const supabase = getAdminClient();
  const normalizedEmail = email.toLowerCase().trim();
  if (!supabase) return { tiers: [], applied: {} };

  const { data: paid } = await supabase
    .from('purchases')
    .select('tier, bundle, status, superseded_by')
    .eq('user_email', normalizedEmail)
    .eq('status', 'completed')
    .is('superseded_by', null);

  const rows = (paid || []) as Array<{ tier?: string | null; bundle?: string | null }>;
  if (rows.length === 0) return { tiers: [], applied: {} };

  // Union every purchase's flags: a customer who bought two products keeps both.
  const applied: Record<string, boolean> = {};
  const tiers: string[] = [];
  for (const row of rows) {
    if (!row.tier && !row.bundle) continue; // unmapped line item — nothing to grant
    tiers.push(row.tier || row.bundle || 'unknown');
    const flags = await updateAccessFlags(normalizedEmail, row.tier || undefined, row.bundle || undefined);
    Object.assign(applied, flags);
  }

  // KV is the PRIMARY access gate (resolveAccess reads `briefings:<email>` first,
  // then falls back to this profile flag). Replaying the profile flag alone would
  // leave the faster path cold, so mirror it — same as the webhook does.
  if (applied.access_briefings || applied.access_team) {
    try {
      const { grantBriefingsAccess } = await import('@/lib/briefings/access');
      await grantBriefingsAccess(normalizedEmail);
    } catch (err) {
      console.error(`[reconcile] KV mirror failed for ${normalizedEmail} (profile flag still set):`, err);
    }
  }

  if (Object.keys(applied).length > 0) {
    console.log(
      `[reconcile] replayed ${tiers.length} purchase(s) for ${normalizedEmail}: `
      + `${tiers.join(', ')} → ${Object.keys(applied).join(', ')}`,
    );
  }
  return { tiers, applied };
}

/** Best-effort auth.users id lookup for an email (service-role only). Returns null when the
 *  user has no auth account yet — callers treat that as a soft skip, never a hard error.
 *  Mirrors resolveAuthUserId in src/lib/admin/member-grants.ts. */
async function resolveAuthUserId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
): Promise<string | null> {
  // 1) Fast path: an existing row may already carry the user_id (covers a casing miss).
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('email', email)
      .not('user_id', 'is', null)
      .maybeSingle();
    if (data?.user_id) return data.user_id;
  } catch { /* fall through */ }
  // 2) Auth admin lookup (paginated); stop as soon as we match.
  try {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match = data.users.find((u: any) => (u.email || '').toLowerCase().trim() === email);
      if (match?.id) return match.id;
      if (data.users.length < 1000) break; // last page
    }
  } catch { /* no admin access / SDK shape mismatch — treat as not found */ }
  return null;
}

/**
 * Get user profile by email
 */
export async function getProfileByEmail(email: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle(); // may be empty — returns null instead of a PGRST116 error

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  return (data as UserProfile) || null;
}

/**
 * Get user profile by license key
 */
export async function getProfileByLicenseKey(licenseKey: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('license_key', licenseKey.toUpperCase().trim())
    .maybeSingle(); // may be empty — returns null instead of a PGRST116 error

  if (error) {
    console.error('Error fetching profile by license:', error);
    return null;
  }

  return data as UserProfile;
}

/**
 * Map tier to access flag
 */
export function tierToAccessFlag(tier: ProductTier): ProductAccessFlag {
  const mapping: Record<ProductTier, ProductAccessFlag> = {
    'hunter_pro': 'access_hunter_pro',
    'content_standard': 'access_content_standard',
    'content_full_fix': 'access_content_full_fix',
    'assassin_standard': 'access_assassin_standard',
    'assassin_premium': 'access_assassin_premium',
    'recompete': 'access_recompete',
    'contractor_db': 'access_contractor_db',
    'briefings': 'access_briefings',
    'briefings_monthly': 'access_briefings',
    'briefings_annual': 'access_briefings',
    'briefings_lifetime': 'access_briefings',
    'fhc_membership': 'access_assassin_standard', // FHC gets MA Standard + briefings separately
    // Mindy Team — primary flag is access_team; access_briefings
    // also gets set by the updateAccessFlags branch below since
    // Team is a superset of Pro.
    'team_monthly': 'access_team',
    'team_annual': 'access_team',
    // Upgrade tiers map to their premium access flags
    'assassin_premium_upgrade': 'access_assassin_premium',
    'content_full_fix_upgrade': 'access_content_full_fix',
  };
  return mapping[tier];
}

/**
 * Grant access to a product for a user
 */
export async function grantProductAccess(
  email: string,
  tier: ProductTier,
  options?: {
    name?: string;
    stripeCustomerId?: string;
    bundle?: string;
  }
): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Get or create profile first
  let profile = await getOrCreateProfile(normalizedEmail, options?.name);
  if (!profile) return null;

  // Get the access flag for this tier
  const accessFlag = tierToAccessFlag(tier);

  // Build update object
  const updates: Record<string, unknown> = {
    [accessFlag]: true,
  };

  // If granting content_full_fix, also grant content_standard
  if (tier === 'content_full_fix') {
    updates.access_content_standard = true;
  }

  // If granting assassin_premium, also grant assassin_standard
  if (tier === 'assassin_premium') {
    updates.access_assassin_standard = true;
  }

  // Add optional fields
  if (options?.stripeCustomerId) {
    updates.stripe_customer_id = options.stripeCustomerId;
  }
  if (options?.bundle) {
    updates.bundle = options.bundle;
  }
  if (options?.name && !profile.name) {
    updates.name = options.name;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('email', normalizedEmail)
    .select()
    .single();

  if (error) {
    console.error('Error granting product access:', error);
    return null;
  }

  console.log(`Granted ${accessFlag} to ${normalizedEmail}`);
  return data as UserProfile;
}

/**
 * Update access flags based on tier and/or bundle
 * Simplified function matching the Express pattern
 */
export async function updateAccessFlags(
  email: string,
  tier?: string,
  bundle?: string
): Promise<Record<string, boolean>> {
  const supabase = getAdminClient();
  if (!supabase) return {};

  const normalizedEmail = email.toLowerCase().trim();
  const updates: Record<string, boolean> = {};

  // Bundle access grants (supports both short names and full product IDs)
  if (bundle) {
    // GovCon Starter Bundle ($697): Hunter Pro + Recompete + Contractor DB (NO Market Intelligence)
    if (bundle === 'starter' || bundle === 'govcon-starter-bundle') {
      updates.access_hunter_pro = true;
      updates.access_recompete = true;
      updates.access_contractor_db = true;
      // No access_briefings - Starter bundle doesn't include Market Intelligence
    }
    // Pro Giant Bundle ($997): Contractor DB + Recompete + MA Standard + Content Reaper + 1 Year Briefings
    else if (bundle === 'pro' || bundle === 'pro-giant-bundle') {
      updates.access_contractor_db = true;
      updates.access_recompete = true;
      updates.access_assassin_standard = true;
      updates.access_content_standard = true;
      updates.access_briefings = true; // 1 year - handled by briefings_expires_at
    }
    // Ultimate GovCon Bundle ($1497): All products + MA Premium + Content Full Fix + Lifetime Briefings
    else if (bundle === 'ultimate' || bundle === 'ultimate-govcon-bundle' || bundle === 'complete') {
      updates.access_hunter_pro = true;
      updates.access_content_standard = true;
      updates.access_content_full_fix = true;
      updates.access_contractor_db = true;
      updates.access_recompete = true;
      updates.access_assassin_standard = true;
      updates.access_assassin_premium = true;
      updates.access_briefings = true; // Lifetime
    }
  } else if (tier) {
    // Single tier access grants (only if no bundle)
    if (tier === 'hunter_pro') updates.access_hunter_pro = true;
    if (tier === 'content_standard') updates.access_content_standard = true;
    if (tier === 'content_full_fix') updates.access_content_full_fix = true;
    if (tier === 'assassin_standard') updates.access_assassin_standard = true;
    if (tier === 'assassin_premium') updates.access_assassin_premium = true;
    if (tier === 'recompete') updates.access_recompete = true;
    if (tier === 'contractor_db') updates.access_contractor_db = true;

    // Briefings tiers
    if (tier === 'briefings' || tier === 'briefings_monthly' || tier === 'briefings_annual' || tier === 'briefings_lifetime') {
      updates.access_briefings = true;
    }

    // FHC membership - grants MA Standard + Briefings
    if (tier === 'fhc_membership') {
      updates.access_assassin_standard = true;
      updates.access_briefings = true;
    }

    // Mindy Team tier — superset of Pro. Sets both access_team
    // (drives the 'team' tier label in verifyMIAccess() and the
    // UnifiedSidebar) AND access_briefings (so Pro-tier feature
    // gates still light up automatically). Per-seat invite flow
    // is a separate workstream — see TODO-stripe-team-pricing.md
    // Step 6.
    if (tier === 'team_monthly' || tier === 'team_annual') {
      updates.access_team = true;
      updates.access_briefings = true;
    }

    // Upgrade tiers - grant the higher tier (user already has standard)
    if (tier === 'assassin_premium_upgrade') {
      updates.access_assassin_premium = true;
      updates.access_assassin_standard = true; // Ensure standard is also set
    }
    if (tier === 'content_full_fix_upgrade') {
      updates.access_content_full_fix = true;
      updates.access_content_standard = true; // Ensure standard is also set
    }

    // NOTE: Market Intelligence (access_briefings) is NOT auto-granted to tool purchasers.
    // It's only included in Pro/Ultimate bundles and explicit briefings purchases.
    // Daily Alerts (free during beta) are separate from Market Intelligence.
  }

  // Ensure the profile exists for EVERY paid checkout — BEFORE the no-flags early return.
  //
  // THE BUG THIS FIXES (measured 2026-07-30): getOrCreateProfile used to sit BELOW the
  // `updates.length === 0` return, so any purchase whose tier/bundle didn't match a branch
  // above created NO user_profiles row at all — not a row with wrong flags, no row. The
  // webhook still wrote `purchases` (money recorded), returned 200, and Stripe logged
  // success. Net: 53 of 137 buyers (39%) had paid with no profile, going back to 2024-08-17.
  // Venkat Veera was the newest — active $149/mo, zero access.
  //
  // A purchase is proof of a customer. Whether their product maps to a flag is a SEPARATE
  // concern: a Consultant Meeting buyer correctly gets a profile with all-false flags.
  await getOrCreateProfile(normalizedEmail);

  if (Object.keys(updates).length === 0) {
    // Loud on purpose. An unmapped tier is indistinguishable from "no flags needed" in the
    // return value ({} either way), which is how this stayed invisible for two years.
    console.warn(
      `[updateAccessFlags] no flag mapping for ${normalizedEmail} `
      + `(tier=${tier ?? 'none'}, bundle=${bundle ?? 'none'}) — profile ensured, no access granted`,
    );
    return {};
  }

  // Update access flags
  const { error } = await supabase
    .from('user_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('email', normalizedEmail);

  if (error) {
    console.error('Error updating access flags:', error);
    return {};
  }

  console.log(`Updated access flags for ${normalizedEmail}:`, Object.keys(updates));
  return updates;
}

/**
 * Grant bundle access (multiple products at once)
 */
export async function grantBundleAccess(
  email: string,
  bundle: 'starter' | 'govcon-starter-bundle' | 'pro' | 'pro-giant-bundle' | 'ultimate' | 'ultimate-govcon-bundle' | 'complete',
  options?: {
    name?: string;
    stripeCustomerId?: string;
  }
): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Get or create profile first
  const profile = await getOrCreateProfile(normalizedEmail, options?.name);
  if (!profile) return null;

  // Define what each bundle includes
  // NOTE: Market Intelligence (access_briefings) only in Pro ($997) and Ultimate ($1497) bundles
  // Daily Alerts are FREE for everyone during beta - separate from Market Intelligence
  const bundleProducts: Record<string, Record<string, unknown>> = {
    // GovCon Starter Bundle ($697) - NO Market Intelligence
    'starter': {
      access_hunter_pro: true,
      access_recompete: true,
      access_contractor_db: true,
      // No access_briefings
    },
    'govcon-starter-bundle': {
      access_hunter_pro: true,
      access_recompete: true,
      access_contractor_db: true,
      // No access_briefings
    },
    // Pro Giant Bundle ($997) - 1 Year Briefings
    'pro': {
      access_contractor_db: true,
      access_recompete: true,
      access_assassin_standard: true,
      access_content_standard: true,
      access_briefings: true,
    },
    'pro-giant-bundle': {
      access_contractor_db: true,
      access_recompete: true,
      access_assassin_standard: true,
      access_content_standard: true,
      access_briefings: true,
    },
    // Ultimate GovCon Bundle ($1497) - Lifetime Briefings
    'ultimate': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
      access_briefings: true,
    },
    'ultimate-govcon-bundle': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
      access_briefings: true,
    },
    'complete': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
      access_briefings: true,
    },
  };

  const updates = {
    ...bundleProducts[bundle],
    bundle,
    stripe_customer_id: options?.stripeCustomerId || profile.stripe_customer_id,
    name: options?.name || profile.name,
  };

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('email', normalizedEmail)
    .select()
    .single();

  if (error) {
    console.error('Error granting bundle access:', error);
    return null;
  }

  console.log(`Granted ${bundle} bundle to ${normalizedEmail}`);
  return data as UserProfile;
}

/**
 * Check if user has access to a specific product
 */
export async function hasAccess(email: string, accessFlag: ProductAccessFlag): Promise<boolean> {
  const profile = await getProfileByEmail(email);
  if (!profile) return false;
  return profile[accessFlag] === true;
}

/**
 * Activate a license and mark activation time
 */
export async function activateLicense(email: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      license_activated_at: new Date().toISOString(),
    })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single();

  if (error) {
    console.error('Error activating license:', error);
    return null;
  }

  return data as UserProfile;
}

/**
 * Get all user profiles (for admin)
 */
export async function getAllProfiles(options?: {
  limit?: number;
  offset?: number;
}): Promise<UserProfile[]> {
  const supabase = getAdminClient();
  if (!supabase) return [];

  let query = supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching profiles:', error);
    return [];
  }

  return (data || []) as UserProfile[];
}

/**
 * Map product_id from purchases to tier
 */
export function productIdToTier(productId: string, tier?: string): ProductTier | null {
  // Handle direct tier mapping
  if (tier) {
    const validTiers: ProductTier[] = [
      'hunter_pro', 'content_standard', 'content_full_fix',
      'assassin_standard', 'assassin_premium', 'recompete', 'contractor_db'
    ];
    if (validTiers.includes(tier as ProductTier)) {
      return tier as ProductTier;
    }
  }

  // Fallback mapping from product_id
  const mapping: Record<string, ProductTier> = {
    'market-assassin': 'assassin_standard',
    'content-generator': 'content_standard',
    'contractor-database': 'contractor_db',
    'opportunity-hunter-pro': 'hunter_pro',
    'recompete': 'recompete',
  };

  return mapping[productId] || null;
}
