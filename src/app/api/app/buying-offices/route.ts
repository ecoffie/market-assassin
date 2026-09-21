/**
 * GET /api/app/buying-offices?q=<text> — the Filters panel's "Buying office" picker.
 *
 * WHY THIS EXISTS: the Buying office field was a BARE 6-CHARACTER TEXT INPUT (placeholder
 * "DoDAAC e.g. W912PL"). A user who does not already know the DoDAAC of the office they want
 * had no way to find one, and a wrong guess returns zero pins with no explanation — the filter
 * was effectively unusable unless you were an insider. Measured 2026-08-17.
 *
 * WHY NOT REUSE /api/app/dodaac-directory: that returns all ~4,825 code→name pairs for DECODING
 * an office you already have. A picker needs the opposite — the few offices actually worth
 * choosing, ranked. Most of those 4,825 have nothing on the map right now, so listing them would
 * be a menu of dead ends.
 *
 * WHAT IT RETURNS: only offices with REAL OPEN VOLUME on the map (>= MIN_OPEN open, mappable
 * notices), ranked by that count, each with the name from the shared dodaac directory. Measured
 * live: 206 offices carry >= 5 open opportunities, covering 5,980 notices; 187 of the 206 (91%)
 * resolve to a real name.
 *
 * GROUNDING (rule #1): the count and the code both come from `sam_opportunities` itself — the
 * SAME solicitation-number prefix the filter matches on, so a listed office can never be one the
 * filter would then find nothing for. The name comes from the shared `loadDodaacNames()`
 * directory. An office with no directory entry is returned with `name: null` and the client
 * shows the bare code — never a guessed or prettified label.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadDodaacNames } from '@/lib/gov-contacts/dodaac-directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Below this an office is noise on the map — a 1-notice office is not a browsable choice. */
const MIN_OPEN = 5;
/** Rows the picker can return. The client shows the top 8; this is the searchable pool. */
const MAX_OFFICES = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface BuyingOffice {
  dodaac: string;
  name: string | null;
  openCount: number;
}

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().toUpperCase();
  try {
    const db = sb();
    // Only ACTIVE, still-open, MAPPABLE notices — the same population the map's Open horizon
    // draws, so the count beside each office is the count the user will actually see.
    //
    // ⚠️ PAGED, because PostgREST hard-caps a response at 1000 rows NO MATTER WHAT `.limit()`
    // says. The first version passed `.limit(50000)` against ~10,435 matching rows and looked
    // fine — it silently counted only the first 1000, returning 15 offices instead of 206 and
    // UNDERSTATING every count (NAVSUP N00104 read "137 open" against a real 912). A wrong count
    // beside a real name is worse than no picker: it reads as authoritative. Pages after the
    // first are fetched concurrently.
    const now = new Date().toISOString();
    const PAGE = 1000;
    const pageQuery = (from: number, withCount: boolean) =>
      db.from('sam_opportunities')
        .select('solicitation_number', withCount ? { count: 'exact' } : undefined)
        .not('map_lat', 'is', null)
        .eq('active', true)
        .gt('response_deadline', now)
        .not('solicitation_number', 'is', null)
        .order('notice_id', { ascending: true })
        .range(from, from + PAGE - 1);

    const { data: first, count, error } = await pageQuery(0, true);
    if (error) throw error;
    const rows: Array<{ solicitation_number: string | null }> =
      [...((first ?? []) as Array<{ solicitation_number: string | null }>)];

    // A null count is UNKNOWN, not zero (Bug Prevention Rule #11) — page sequentially rather
    // than silently ranking offices off whatever the first page happened to hold.
    if (count == null) {
      for (let from = PAGE; ; from += PAGE) {
        const { data: page, error: pErr } = await pageQuery(from, false);
        if (pErr) throw pErr;
        if (!page || !page.length) break;
        rows.push(...(page as typeof rows));
        if (page.length < PAGE) break;
      }
    } else if (rows.length < count) {
      const offsets: number[] = [];
      for (let from = PAGE; from < count; from += PAGE) offsets.push(from);
      const pages = await Promise.all(offsets.map(async (from) => {
        const { data: page, error: pErr } = await pageQuery(from, false);
        if (pErr) throw pErr;
        return (page ?? []) as typeof rows;
      }));
      for (const page of pages) rows.push(...page);
    }

    const counts = new Map<string, number>();
    for (const r of rows) {
      const sol = String(r.solicitation_number ?? '').trim().toUpperCase();
      // A DoDAAC is the leading 6 chars: a letter then 5 alphanumerics. Anything else is not an
      // office code (some notices carry free-form numbers) and is skipped rather than guessed at.
      if (!/^[A-Z][A-Z0-9]{5}/.test(sol)) continue;
      const code = sol.slice(0, 6);
      counts.set(code, (counts.get(code) || 0) + 1);
    }

    let names = new Map<string, string>();
    try { names = await loadDodaacNames(); } catch { /* names are a nicety — codes still work */ }

    let offices: BuyingOffice[] = [];
    for (const [dodaac, openCount] of counts) {
      if (openCount < MIN_OPEN) continue;
      offices.push({ dodaac, name: names.get(dodaac) ?? null, openCount });
    }
    offices.sort((a, b) => b.openCount - a.openCount || a.dodaac.localeCompare(b.dodaac));

    if (q) {
      offices = offices.filter((o) => o.dodaac.startsWith(q) || (o.name || '').toUpperCase().includes(q));
    }

    return NextResponse.json(
      { success: true, offices: offices.slice(0, MAX_OFFICES), minOpen: MIN_OPEN },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' } },
    );
  } catch (e) {
    // Honest failure: an empty list + success:false, so the client can say "couldn't load" rather
    // than render an empty menu that reads as "there are no buying offices".
    console.error('[buying-offices]', e);
    return NextResponse.json({ success: false, offices: [], error: 'lookup_failed' }, { status: 200 });
  }
}
