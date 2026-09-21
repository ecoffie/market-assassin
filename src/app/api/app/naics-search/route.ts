/**
 * GET /api/app/naics-search?q=petroleum → the picker's lookup.
 *
 * Returns catalog matches ANNOTATED WITH LIVE INVENTORY, so the answer is
 *
 *   324110 — Petroleum Refineries · 10 open · 117 recompetes · 17 forecasts
 *
 * rather than a bare code. The counts are the point: they turn a static list into a discovery
 * surface and let a contractor see immediately whether their market has anything in it.
 *
 * Search accepts a code ("324110") or plain English ("petroleum"); both resolve to the same
 * canonical entry.
 *
 * Read-only. No auth — the catalog is public reference data and the counts are aggregate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchNaics } from '@/lib/naics-catalog';
import { getCountClient } from '@/lib/supabase/server-clients';

export const dynamic = 'force-dynamic';

/** Count open SAM + mappable recompetes + forecasts for one code, mirroring the map's scope. */
async function inventoryFor(codes: string[]) {
  // getCountClient, NOT getReadClient. The read replica rejects EVERY HTTP HEAD with a 400,
  // and `head: true` counts issue a HEAD — so these queries always fail through the replica.
  // Documented in server-clients.ts and verified live 2026-07-16. It passed locally because
  // there is no replica there, so getReadClient() fell through to the primary; production has
  // one, and every count came back empty. (Caught on prod because the error is BOUND rather
  // than coalesced to 0 — a `count ?? 0` would have shown "0 open" for Petroleum Refineries,
  // which is the exact lie this whole thread has been about.)
  const db = getCountClient();
  const now = new Date().toISOString();
  const out: Record<string, { open?: number; recompetes?: number; forecasts?: number }> = {};

  await Promise.all(
    codes.map(async (code) => {
      // A short code means the family; a full code means itself. Same rule as the map
      // (src/lib/opportunities/map-filters.ts) so the picker never promises a different
      // universe than the map delivers.
      const isPrefix = code.length < 6;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const naics = <T extends { like: any; eq: any }>(q: T): T =>
        (isPrefix ? q.like('naics_code', `${code}%`) : q.eq('naics_code', code)) as T;

      const [open, recompetes, forecasts] = await Promise.all([
        naics(db.from('sam_opportunities').select('*', { count: 'exact', head: true }))
          .gte('response_deadline', now),
        naics(db.from('recompete_opportunities').select('*', { count: 'exact', head: true }))
          .is('quality_flag', null)
          .not('map_lat', 'is', null),
        naics(db.from('agency_forecasts').select('*', { count: 'exact', head: true })),
      ]);

      // A failed count must NOT render as "0 open". That is the exact lie this whole
      // investigation started with: a user reads zero as "you don't cover my industry" and
      // leaves. On error we omit the number entirely — the UI shows the code with no counts,
      // which is honest, rather than a confident wrong zero.
      const num = (r: { count: number | null; error: unknown }) =>
        r.error ? undefined : (r.count ?? 0);

      out[code] = {
        open: num(open),
        recompetes: num(recompetes),
        forecasts: num(forecasts),
      };
    }),
  );

  return out;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const withCounts = req.nextUrl.searchParams.get('counts') !== '0';
  if (!q) return NextResponse.json({ success: true, results: [] });

  // Cap the annotated set: each result costs 3 count queries, so a 25-row response would be 75
  // round trips. The top matches are what a picker shows before the user narrows.
  const matches = searchNaics(q, 12);
  if (!matches.length) return NextResponse.json({ success: true, results: [] });

  let counts: Record<string, { open?: number; recompetes?: number; forecasts?: number }> = {};
  if (withCounts) {
    try {
      counts = await inventoryFor(matches.map((m) => m.code));
    } catch {
      // A counting failure must not empty the picker — the codes are still the answer.
      counts = {};
    }
  }

  return NextResponse.json({
    success: true,
    results: matches.map((m) => ({
      code: m.code,
      title: m.title,
      level: m.level,
      ...(counts[m.code] ?? {}),
    })),
  });
}
