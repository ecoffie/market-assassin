/**
 * /api/app/disa/vehicles
 *
 * GET  ?email=                 → list watched vehicles + dashboard summary
 * POST ?email=  { csv }        → upload/parse a vehicle spreadsheet (CSV), upsert rows
 * POST ?email=  { vehicles }   → upsert structured rows (manual add / edit)
 *
 * DISA's manual IDIQ/IDV spreadsheet → an automated expiry-watch. Live incumbent
 * notifications are sent by the cron (dry-run gated). (DISA-VEHICLE-WATCH-SPEC.md)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { parseVehicleCsv, summarize, currentStage, daysUntil, type WatchedVehicle } from '@/lib/disa/vehicle-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

function nowUtc(): Date {
  return new Date();
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('disa_watched_vehicles')
    .select('*')
    .eq('org_email', email)
    .order('expiration_date', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const vehicles = (data || []) as WatchedVehicle[];
  const now = nowUtc();
  // Decorate each row with stage + days-left so the UI doesn't recompute.
  const decorated = vehicles.map(v => ({
    ...v,
    daysUntilExpiration: daysUntil(v.expiration_date, now),
    stage: currentStage(v, now),
  }));

  return NextResponse.json({
    success: true,
    summary: summarize(vehicles, now),
    vehicles: decorated,
  });
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { csv?: string; vehicles?: Array<Partial<WatchedVehicle>> };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = body.csv ? parseVehicleCsv(body.csv) : (body.vehicles || []);
  if (!parsed.length) {
    return NextResponse.json({ success: false, error: 'No vehicles found. Check the CSV has a PIID/contract column + at least one data row.' }, { status: 400 });
  }

  const sb = getSupabase();
  const rows = parsed
    .filter(v => v.vehicle_piid)
    .map(v => ({
      org_email: email,
      vehicle_piid: v.vehicle_piid,
      vehicle_title: v.vehicle_title ?? null,
      incumbent_name: v.incumbent_name ?? null,
      incumbent_uei: v.incumbent_uei ?? null,
      incumbent_email: v.incumbent_email ?? null,
      expiration_date: v.expiration_date ?? null,
      ceiling_value: v.ceiling_value ?? null,
      naics: v.naics ?? null,
      agency: v.agency ?? null,
      source: body.csv ? 'upload' : 'manual',
      updated_at: new Date().toISOString(),
    }));

  const { error } = await sb
    .from('disa_watched_vehicles')
    .upsert(rows, { onConflict: 'org_email,vehicle_piid' });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Honest counts: how many rows had the email we need to actually notify.
  const withEmail = rows.filter(r => r.incumbent_email).length;
  const withDate = rows.filter(r => r.expiration_date).length;
  return NextResponse.json({
    success: true,
    imported: rows.length,
    withIncumbentEmail: withEmail,
    withExpirationDate: withDate,
    note: withEmail < rows.length
      ? `${rows.length - withEmail} vehicles have no incumbent email — add one to enable notifications.`
      : undefined,
  });
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const id = request.nextUrl.searchParams.get('id');
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();
  const { error } = await sb.from('disa_watched_vehicles').delete().eq('org_email', email).eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
