/**
 * GET /api/app/recompete-row?id=<contract_id|piid>
 *
 * By-id Awarded/Recompete pin for Share / deep-link restore. The map viewport is bbox-capped
 * at 1,000 pins (MAX_PINS), so a shared contract is almost never in the recipient's initial
 * pin set. This route looks the row up directly — viewport and pin cap have ZERO bearing.
 *
 * NOT /api/app/recompete-detail (that is intel: naics/agency/title → agency/pricing).
 * Gold master: /api/app/forecast-detail — by-id fetch, honest 404, never fabricate.
 *
 * Lookup: contract_id first (Share emits CUR.id = nid = contract_id), then piid.
 * Pin shape: shared toPin() — same as /api/app/recompete-map so the drawer matches a pin click.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RECOMPETE_PIN_COLS, toPin } from '@/lib/recompete/map-pin';

export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('id') || '').trim();
  if (!raw) return NextResponse.json({ success: false, error: 'missing id' }, { status: 400 });

  try {
    const db = sb();
    const { data: byContract, error: contractErr } = await db
      .from('recompete_opportunities')
      .select(RECOMPETE_PIN_COLS)
      .eq('contract_id', raw)
      .maybeSingle();

    if (contractErr) {
      console.error('[recompete-row] contract_id lookup failed:', contractErr.message);
      return NextResponse.json({ success: false, error: 'lookup failed' }, { status: 500 });
    }
    if (byContract) {
      return NextResponse.json({ success: true, pin: toPin(byContract as unknown as Record<string, unknown>) });
    }

    // PIID fallback — Share uses contract_id, but a pasted PIID must still resolve.
    // limit(1): a PIID can theoretically match more than one row; maybeSingle() errors on that.
    const { data: byPiid, error: piidErr } = await db
      .from('recompete_opportunities')
      .select(RECOMPETE_PIN_COLS)
      .eq('piid', raw)
      .limit(1);

    if (piidErr) {
      console.error('[recompete-row] piid lookup failed:', piidErr.message);
      return NextResponse.json({ success: false, error: 'lookup failed' }, { status: 500 });
    }
    const row = Array.isArray(byPiid) ? byPiid[0] : byPiid;
    if (!row) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });

    return NextResponse.json({ success: true, pin: toPin(row as unknown as Record<string, unknown>) });
  } catch (e) {
    console.error('[recompete-row] lookup failed:', (e as Error).message);
    return NextResponse.json({ success: false, error: 'lookup failed' }, { status: 500 });
  }
}
