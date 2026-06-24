/**
 * Seed the canary Vault for eric@govcongiants.com — the account Eric checks to
 * confirm Mindy is working end-to-end. Completes the Vault (identity + past
 * performance) so hidden-match builds a capability vector and the Start-Here card
 * can reach 5/5, WITHOUT touching the existing construction/Caribbean alerts
 * profile (Eric: "leave this profile").
 *
 * Past performance is REPRESENTATIVE TEST DATA (CANARY-* contract numbers) — GovCon
 * Giants has no real federal construction awards. It's aligned to the kept profile
 * (vertical/heavy construction + A-E engineering, Caribbean) so hidden-match returns
 * genuinely relevant construction SOWs. Replace with real data anytime.
 *
 * GET  ?password=...                       → preview the payload (no writes)
 * POST ?password=...&mode=execute&email=   → seed (email defaults to the canary)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEFAULT_EMAIL = 'eric@govcongiants.com';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function buildIdentity(email: string) {
  return {
    user_email: email,
    uei: 'CANARYGCG234',                      // test UEI (no O/I/0/1) — clearly synthetic
    legal_name: 'GOVCON GIANTS — CANARY (Construction / Infrastructure)',
    dba: 'GovCon Giants',
    primary_naics: ['236220', '237310', '541330', '237990', '236210'],
    certifications: ['Small Business'],
    one_liner: 'Vertical and heavy construction plus A-E engineering for federal facilities and infrastructure across the Caribbean (Puerto Rico, USVI).',
    elevator_pitch:
      'A federal construction and engineering firm delivering design-build vertical construction (NAICS 236220), highway and heavy-civil reconstruction (237310, 237990), and architect-engineer design (541330) for Navy, Army Corps, and GSA facilities throughout the Caribbean. Experienced with hurricane-rated reinforced-concrete construction, roadway and drainage rehabilitation, and federal facility design in Puerto Rico and the U.S. Virgin Islands.',
    hq_state: 'PR',
    service_states: ['PR', 'VI', 'FL'],
    updated_at: new Date().toISOString(),
  };
}

function buildPastPerformance(email: string) {
  return [
    {
      user_email: email,
      contract_title: 'NAVFAC Atlantic — Vertical Construction, Naval Station, Puerto Rico',
      contract_number: 'CANARY-N40080-VC-001',
      agency: 'Department of the Navy',
      sub_agency: 'Naval Facilities Engineering Systems Command (NAVFAC Atlantic)',
      period_start: '2021-06-01',
      period_end: '2024-09-30',
      contract_value: 24300000,
      role: 'prime',
      scope_description:
        'Design-build vertical construction of administrative and maintenance facilities at a Navy installation in Puerto Rico. Hurricane-rated reinforced-concrete structures, site civil work, utilities, and interior fit-out delivered under an active-installation phasing plan.',
      cpars_rating: 'Very Good',
      relevance_keywords: ['vertical construction', 'design-build', 'reinforced concrete', 'NAVFAC', 'Puerto Rico', 'facility construction'],
      naics_codes: ['236220'],
    },
    {
      user_email: email,
      contract_title: 'USACE — Roadway & Drainage Reconstruction, U.S. Virgin Islands',
      contract_number: 'CANARY-W912-HWY-002',
      agency: 'Department of the Army',
      sub_agency: 'U.S. Army Corps of Engineers',
      period_start: '2022-03-15',
      period_end: '2025-02-28',
      contract_value: 18750000,
      role: 'prime',
      scope_description:
        'Reconstruction of primary roadways and storm drainage on St. Croix following hurricane damage. Asphalt paving, culvert and drainage installation, guardrail, and traffic control across multiple road segments under a heavy-civil construction task order.',
      cpars_rating: 'Exceptional',
      relevance_keywords: ['highway construction', 'road reconstruction', 'drainage', 'asphalt paving', 'USACE', 'heavy civil', 'Virgin Islands'],
      naics_codes: ['237310'],
    },
    {
      user_email: email,
      contract_title: 'GSA — Architect-Engineer Design Services, Federal Facility, San Juan',
      contract_number: 'CANARY-GS-AE-003',
      agency: 'General Services Administration',
      sub_agency: 'Public Buildings Service',
      period_start: '2023-01-10',
      period_end: '2025-06-30',
      contract_value: 6100000,
      role: 'prime',
      scope_description:
        'Architect-engineer design services for a federal facility in San Juan, Puerto Rico. Structural, civil, and MEP design, seismic and hurricane resilience analysis, construction documents, and design-phase support under an A-E indefinite-delivery contract.',
      cpars_rating: 'Very Good',
      relevance_keywords: ['architect-engineer', 'A-E design', 'structural engineering', 'MEP', 'GSA', 'federal facility', 'San Juan'],
      naics_codes: ['541330'],
    },
  ];
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || DEFAULT_EMAIL).toLowerCase().trim();
  return NextResponse.json({
    success: true,
    message: 'Preview only — POST ?mode=execute to seed. Does NOT touch user_notification_settings.',
    data: { email, identity: buildIdentity(email), pastPerformance: buildPastPerformance(email) },
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get('mode') !== 'execute') {
    return NextResponse.json(
      { success: false, message: 'Add ?mode=execute to seed (GET to preview first).' },
      { status: 400 },
    );
  }
  const email = (request.nextUrl.searchParams.get('email') || DEFAULT_EMAIL).toLowerCase().trim();
  const supabase = getSupabase();
  const errors: string[] = [];

  // 1) Identity (upsert by user_email).
  const idRes = await supabase.from('user_identity_profile').upsert(buildIdentity(email), { onConflict: 'user_email' });
  if (idRes.error) errors.push(`identity: ${idRes.error.message}`);

  // 2) Past performance — replace canary rows, then insert.
  const delRes = await supabase.from('user_past_performance').delete().eq('user_email', email);
  if (delRes.error) errors.push(`clear past-perf: ${delRes.error.message}`);
  const ppRows = buildPastPerformance(email);
  const ppRes = await supabase.from('user_past_performance').insert(ppRows);
  if (ppRes.error) errors.push(`past-perf: ${ppRes.error.message}`);

  // 3) Null the capability vector so the embed-user-capabilities cron (re)embeds.
  const nullRes = await supabase.from('user_identity_profile').update({ capability_embedded_at: null }).eq('user_email', email);
  if (nullRes.error) errors.push(`null vector: ${nullRes.error.message}`);

  // Read back.
  const { data: check } = await supabase
    .from('user_identity_profile')
    .select('legal_name, uei, one_liner, primary_naics, capability_embedded_at')
    .eq('user_email', email)
    .maybeSingle();
  const { count } = await supabase
    .from('user_past_performance')
    .select('*', { count: 'exact', head: true })
    .eq('user_email', email);

  return NextResponse.json({
    success: errors.length === 0,
    message: errors.length === 0
      ? `Canary Vault seeded for ${email}. NOT touched: user_notification_settings. Embed cron will build the hidden-match vector on its next run.`
      : `Seeded with ${errors.length} error(s).`,
    data: { email, identity: check, pastPerformanceRows: count, untouched: 'user_notification_settings (alerts/dossier profile)' },
    ...(errors.length > 0 ? { errors } : {}),
  });
}
