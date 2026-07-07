import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Whitelist of fields the user can write — keeps the API
// resistant to junk payloads + makes upgrades explicit.
const WRITABLE_FIELDS = [
  'uei', 'cage_code', 'duns', 'ein',
  'legal_name', 'dba', 'year_founded', 'employee_count', 'annual_revenue',
  'certifications', 'primary_naics',
  'one_liner', 'elevator_pitch',
  'hq_state', 'hq_city', 'service_states',
  'contract_vehicles',
  // Point of contact + cert-package fields (#41) — proposals need these to fill
  // "Responsible Office / Contact Person" instead of [placeholders].
  'contact_name', 'contact_title', 'contact_phone', 'contact_email', 'website',
  'office_address', 'bonding_single', 'bonding_aggregate',
];

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const profile = body.profile || {};

  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Coach Mode: write the Vault identity to the ACTIVE CLIENT, not the coach.
  // Without this a coach editing a client's cap statement (UEI/CAGE/past perf)
  // saved it onto the COACH's own Vault — and synced the CLIENT's NAICS into the
  // COACH's alerts. This is the coach_mode_header_drop data-corruption class.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const writeEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { user_email: writeEmail, updated_at: new Date().toISOString() };
  for (const k of WRITABLE_FIELDS) {
    if (k in profile) row[k] = profile[k];
  }
  // Invalidate the cached capability vector — the meaning text may have changed;
  // the embed-user-capabilities cron will re-embed. (No-op if the column is absent.)
  row.capability_embedded_at = null;

  const { data, error } = await getSupabase()
    .from('user_identity_profile')
    .upsert(row, { onConflict: 'user_email' })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // NAICS SYNC (additive): the daily-alerts cron reads NAICS from
  // user_notification_settings (Settings = the single source of truth alerts
  // read), NOT the Vault. A user who set NAICS only in the Vault would never get
  // matching alerts (the gap Eric flagged 2026-06-04). So Vault Identity NAICS
  // now SYNC INTO Settings — but ADDITIVELY: we only ADD Vault codes the alert
  // filter is missing, never remove/overwrite the user's tuned picks (Vault
  // primary_naics = all registered codes; alert naics_codes = what they chose to
  // watch — those legitimately diverge). The route returns how many were added so
  // the UI can confirm "synced to your alerts" instead of the old silent seed.
  // (Eric, Jun 25: Settings owns targeting; Vault auto-syncs into it, visibly.)
  let alertNaicsSeeded = false;       // kept for back-compat (true if any added)
  let alertNaicsAdded = 0;
  let alertNaicsTotal = 0;
  const vaultNaics = Array.isArray(row.primary_naics)
    ? row.primary_naics.filter((c: unknown) => typeof c === 'string' && /^\d{2,6}$/.test(c))
    : [];
  if (vaultNaics.length > 0) {
    try {
      const { data: ns } = await getSupabase()
        .from('user_notification_settings')
        .select('naics_codes')
        .eq('user_email', writeEmail)
        .maybeSingle();
      const current: string[] = Array.isArray(ns?.naics_codes) ? ns!.naics_codes.map(String) : [];
      const currentSet = new Set(current);
      const missing = vaultNaics.filter((c: string) => !currentSet.has(c));
      if (missing.length > 0) {
        const merged = [...current, ...missing];
        await getSupabase()
          .from('user_notification_settings')
          .upsert(
            { user_email: writeEmail, naics_codes: merged, updated_at: new Date().toISOString() },
            { onConflict: 'user_email' },
          );
        alertNaicsAdded = missing.length;
        alertNaicsSeeded = true;
        alertNaicsTotal = merged.length;
      } else {
        alertNaicsTotal = current.length;
      }
    } catch (e) {
      // Non-fatal — the identity save already succeeded. Log only.
      console.error('[vault/identity] alert NAICS sync failed:', (e as Error)?.message);
    }
  }

  return NextResponse.json({ success: true, identity: data, alertNaicsSeeded, alertNaicsAdded, alertNaicsTotal });
}
