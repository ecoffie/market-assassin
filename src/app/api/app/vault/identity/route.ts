import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

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

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { user_email: auth.email!, updated_at: new Date().toISOString() };
  for (const k of WRITABLE_FIELDS) {
    if (k in profile) row[k] = profile[k];
  }

  const { data, error } = await getSupabase()
    .from('user_identity_profile')
    .upsert(row, { onConflict: 'user_email' })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // NAICS SYNC (guarded): the daily-alerts cron reads NAICS from
  // user_notification_settings, NOT from the Vault. A user who set their NAICS
  // only in the Vault would never get matching alerts (the gap Eric flagged
  // 2026-06-04). Seed the alert NAICS from the Vault — but ONLY when the alert
  // NAICS is currently EMPTY. We must NOT overwrite a tuned alert filter:
  // Vault primary_naics = all registered codes (identity); alert naics_codes =
  // what the user chose to watch (preference). Verified those diverge in
  // practice, so a blind copy would clobber the filter. This makes the Vault a
  // helpful starting point for new users without being destructive.
  let alertNaicsSeeded = false;
  const vaultNaics = Array.isArray(row.primary_naics)
    ? row.primary_naics.filter((c: unknown) => typeof c === 'string' && /^\d{2,6}$/.test(c))
    : [];
  if (vaultNaics.length > 0) {
    try {
      const { data: ns } = await getSupabase()
        .from('user_notification_settings')
        .select('naics_codes')
        .eq('user_email', auth.email!)
        .maybeSingle();
      const alertEmpty = !ns || !Array.isArray(ns.naics_codes) || ns.naics_codes.length === 0;
      if (alertEmpty) {
        await getSupabase()
          .from('user_notification_settings')
          .upsert(
            { user_email: auth.email!, naics_codes: vaultNaics, updated_at: new Date().toISOString() },
            { onConflict: 'user_email' },
          );
        alertNaicsSeeded = true;
      }
    } catch (e) {
      // Non-fatal — the identity save already succeeded. Log only.
      console.error('[vault/identity] alert NAICS seed failed:', (e as Error)?.message);
    }
  }

  return NextResponse.json({ success: true, identity: data, alertNaicsSeeded });
}
