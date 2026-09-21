/**
 * GET /api/app/forecast-detail?id=fc-<uuid>
 *
 * The map's forecast PIN is deliberately thin (title/agency/naics/est/loc). When a user opens a
 * forecast in the drawer they need the REAL detail the agency published — the description, the POC
 * to reach out to NOW (the whole point of a forecast: engage before the solicitation posts), the
 * likely incumbent, the contracting/program office, the estimated value band, and when it is
 * expected on the street. All of that lives on `agency_forecasts`; this route returns it.
 *
 * Honest by construction: forecasts carry no solicitation number, deadline, or attachments — those
 * fields simply don't exist yet, so the drawer says so rather than showing blanks. Only fields the
 * row actually populated are returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// The fields worth surfacing in the drawer (skip internal/geo/embedding columns).
const COLS = [
  'id', 'title', 'description', 'source_agency', 'department', 'bureau',
  'contracting_office', 'program_office', 'naics_code', 'naics_description',
  'psc_code', 'psc_description', 'set_aside_type', 'competition_type', 'contract_type',
  'estimated_value_min', 'estimated_value_max', 'estimated_value_range',
  'fiscal_year', 'anticipated_quarter', 'solicitation_date', 'anticipated_award_date',
  'performance_end_date', 'pop_city', 'pop_state', 'pop_country',
  'incumbent_name', 'incumbent_contract_number',
  'poc_name', 'poc_email', 'poc_phone', 'status', 'source_url', 'last_synced_at',
].join(', ');

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('id') || '').trim();
  if (!raw) return NextResponse.json({ success: false, error: 'missing id' }, { status: 400 });
  // The pin id is `fc-<uuid>`; the table key is the bare uuid.
  const id = raw.startsWith('fc-') ? raw.slice(3) : raw;

  const { data, error } = await sb()
    .from('agency_forecasts')
    .select(COLS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[forecast-detail] query failed:', error.message);
    return NextResponse.json({ success: false, error: 'lookup failed' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

  // Return only the populated fields (a blank field is genuinely absent on a forecast — don't ship it).
  const row = data as unknown as Record<string, unknown>;
  const forecast: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v !== null && v !== '' && v !== undefined) forecast[k] = v;
  }
  return NextResponse.json({ success: true, forecast });
}
