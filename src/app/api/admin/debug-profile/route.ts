/**
 * Debug what's actually saved in user_notification_settings for a given email.
 * GET /api/admin/debug-profile?password=xxx&email=user@example.com
 *
 * Returns raw row + a side-by-side comparison of the columns onboarding
 * is supposed to write. Used to diagnose "I onboarded but my NAICS aren't
 * showing up" reports.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pull from every table onboarding might touch
  const notification = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', email)
    .maybeSingle();

  // DIAGNOSTIC: reproduce the EXACT query /api/app/workspace runs for profile.notification
  // (same client, same select, same normalized email) to prove whether the server
  // produces the data the Settings card/form read. Isolates "server returns empty"
  // from "client ignores it". (Eric QC 2026-06-16: keywords feature shows empty.)
  let workspaceNotificationQuery: { data: unknown; error: string | null } = { data: null, error: null };
  try {
    const r = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, keywords, business_type, aggregated_profile')
      .eq('user_email', email)
      .maybeSingle();
    workspaceNotificationQuery = { data: r.data, error: r.error?.message || null };
  } catch (err) {
    workspaceNotificationQuery = { data: null, error: err instanceof Error ? err.message : 'query threw' };
  }

  let business: { data: Record<string, unknown> | null; error: string | null } = { data: null, error: null };
  try {
    const result = await supabase
      .from('user_business_profiles')
      .select('*')
      .eq('user_email', email)
      .maybeSingle();
    business = { data: result.data, error: result.error?.message || null };
  } catch (err) {
    business = { data: null, error: err instanceof Error ? err.message : 'table missing or query failed' };
  }

  // The Market Research panel ALSO reads these two tables (via /api/app/workspace).
  // debug-profile used to omit them — so a profile that looked "empty" here could
  // still hold a stale/INVALID NAICS that auto-runs Market Research into
  // "No matching agencies". Surface them + flag invalid codes.
  const briefing = await safeSelect(supabase, 'user_briefing_profile', email);
  const miBeta = await safeSelect(supabase, 'mi_beta_user_settings', email);
  // The Vault (user_identity_profile) holds the UEI-imported company identity —
  // primary_naics from SAM. Market Research does NOT read it directly; it only
  // feeds alerts/research after a Vault-identity SAVE seeds user_notification_settings.
  // So a user can have a populated Vault but an empty research profile. Surface it
  // here so "no profile" is never a false negative again.
  const vault = await safeSelect(supabase, 'user_identity_profile', email);

  // Look up the Supabase Auth user so we can tell whether the account
  // exists, what providers it has (oauth vs email), and whether it has
  // a password set — covers the "invalid email or password" mystery.
  let supabaseAuth: {
    exists: boolean;
    userId?: string;
    providers?: string[];
    hasEmailIdentity?: boolean;
    lastSignInAt?: string | null;
    error?: string;
  } = { exists: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (listError) {
      supabaseAuth = { exists: false, error: listError.message };
    } else {
      const user = list?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any;
        const identities = Array.isArray(u.identities) ? u.identities : [];
        supabaseAuth = {
          exists: true,
          userId: u.id,
          providers: identities.map((id: { provider?: string }) => id.provider || 'unknown'),
          hasEmailIdentity: identities.some((id: { provider?: string }) => id.provider === 'email'),
          lastSignInAt: u.last_sign_in_at || null,
        };
      }
    }
  } catch (err) {
    supabaseAuth = { exists: false, error: err instanceof Error ? err.message : 'auth lookup failed' };
  }

  return NextResponse.json({
    email,
    supabaseAuth,
    // What the Settings card/form's profile.notification would contain (server side).
    workspaceNotificationQuery,
    user_notification_settings: notification.data
      ? {
          present: true,
          naics_codes: notification.data.naics_codes,
          naics_codes_length: Array.isArray(notification.data.naics_codes) ? notification.data.naics_codes.length : null,
          psc_codes: notification.data.psc_codes,
          keywords: notification.data.keywords,
          set_aside_preferences: notification.data.set_aside_preferences,
          business_type: notification.data.business_type,
          agencies: notification.data.agencies,
          location_states: notification.data.location_states,
          location_state: notification.data.location_state,
          alert_frequency: notification.data.alert_frequency,
          alerts_enabled: notification.data.alerts_enabled,
          briefings_enabled: notification.data.briefings_enabled,
          treatment_type: notification.data.treatment_type,
          created_at: notification.data.created_at,
          updated_at: notification.data.updated_at,
          // Anything else
          all_keys: Object.keys(notification.data),
        }
      : { present: false, error: notification.error?.message },
    user_business_profiles: business.data
      ? {
          present: true,
          extracted_naics_codes: business.data.extracted_naics_codes,
          invalid_naics: invalidNaics(business.data.extracted_naics_codes),
          extracted_keywords: business.data.extracted_keywords,
          extracted_agencies: business.data.extracted_agencies,
          business_description: business.data.business_description,
        }
      : { present: false },
    user_briefing_profile: briefing
      ? { present: true, naics_codes: briefing.naics_codes, invalid_naics: invalidNaics(briefing.naics_codes) }
      : { present: false },
    mi_beta_user_settings: miBeta
      ? { present: true, naics_codes: miBeta.naics_codes, invalid_naics: invalidNaics(miBeta.naics_codes) }
      : { present: false },
    user_identity_profile: vault
      ? {
          present: true,
          uei: vault.uei,
          legal_name: vault.legal_name,
          primary_naics: vault.primary_naics,
          invalid_naics: invalidNaics(vault.primary_naics),
          certifications: vault.certifications,
          // Did the Vault NAICS make it into the research/alerts table? If false,
          // the user has a profile they can't see in Market Research.
          seeded_to_notification_settings: Array.isArray(notification.data?.naics_codes) && notification.data.naics_codes.length > 0,
        }
      : { present: false },
  });
}

const NAICS_NCOL: Record<string, string> = {
  user_notification_settings: 'naics_codes',
  user_briefing_profile: 'naics_codes',
  mi_beta_user_settings: 'naics_codes',
  user_business_profiles: 'extracted_naics_codes',
  user_identity_profile: 'primary_naics', // Vault — UEI-imported company NAICS
};

const VALID_SECTORS = ['11','21','22','23','31','32','33','42','44','45','48','49','51','52','53','54','55','56','61','62','71','72','81','92'];
function isValidNaics(code: unknown): boolean {
  const s = String(code ?? '').trim();
  return /^\d{2,6}$/.test(s) && VALID_SECTORS.includes(s.slice(0, 2));
}
function invalidNaics(codes: unknown): string[] {
  return (Array.isArray(codes) ? codes : []).filter((c) => !isValidNaics(c)).map(String);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeSelect(supabase: any, table: string, email: string): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await supabase.from(table).select('*').eq('user_email', email).maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/debug-profile?password=xxx&email=user@example.com
 * Scrubs INVALID NAICS codes (bad sector / malformed) out of every profile table
 * for the user. Fixes the "No matching agencies" dead end caused by a stale code
 * that was half-replaced in onboarding. Idempotent. Returns what it removed.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const changes: Array<Record<string, unknown>> = [];
  for (const [table, ncol] of Object.entries(NAICS_NCOL)) {
    const row = await safeSelect(supabase, table, email);
    if (!row) continue;
    const codes = Array.isArray(row[ncol]) ? (row[ncol] as unknown[]).map(String) : [];
    const cleaned = codes.filter(isValidNaics);
    const removed = codes.filter((c) => !isValidNaics(c));
    if (removed.length === 0) continue; // nothing invalid → leave untouched
    const { error } = await supabase.from(table).update({ [ncol]: cleaned }).eq('user_email', email);
    changes.push({ table, removed, kept: cleaned, persisted: !error, error: error?.message || null });
  }

  return NextResponse.json({
    success: true,
    email,
    scrubbed: changes.length > 0,
    changes,
    note: changes.length === 0 ? 'No invalid NAICS found in any profile table.' : undefined,
  });
}
