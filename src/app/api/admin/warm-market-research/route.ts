/**
 * Admin: pre-warm the market-research result cache for the demo markets.
 *
 * WHY: a cold determination is a live Supabase pool scan + a BigQuery activity
 * join — 3-4s at a desk, and unbounded on conference wifi. Warm, it is ~300ms.
 * Run this before a demo and the first query a contracting officer watches is
 * instant instead of a spinner.
 *
 * Deliberately admin-gated and manual: warming is a demo-prep action, not a
 * cron. The result cache has a 6h TTL, so re-run it the morning of.
 *
 *   GET /api/admin/warm-market-research?password=...
 *   GET /api/admin/warm-market-research?password=...&naics=541512&state=VA
 */
import { NextRequest, NextResponse } from 'next/server';
import { runMarketResearch } from '@/lib/gov-buyer/market-research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The markets a Gold Coast / NAPEX demo is most likely to open with. */
const DEMO_MARKETS: Array<{ naics: string; state?: string; setAside?: string }> = [
  { naics: '541512', state: 'VA' },   // IT services, Navy-adjacent
  { naics: '541512' },                // same, nationwide
  { naics: '541330', state: 'VA' },   // engineering services
  { naics: '236220' },                // construction — the "not just IT" proof
  { naics: '541611' },                // management consulting
  { naics: '541715' },                // R&D — the hypersonics story
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Single-market mode, for warming something specific right before you present.
  const one = sp.get('naics');
  const markets = one
    ? [{ naics: one, state: sp.get('state') || undefined, setAside: sp.get('setAside') || undefined }]
    : DEMO_MARKETS;

  const results: Array<Record<string, unknown>> = [];
  for (const m of markets) {
    const started = Date.now();
    try {
      // limit:500 matches what the page and the .docx export request, so the
      // warmed key is the one they will actually read.
      const r = await runMarketResearch({ ...m, limit: 500 });
      results.push({
        ...m,
        ok: true,
        marketDepth: r.marketDepth,
        capableDepth: r.capableDepth,
        ruleOfTwoMet: r.ruleOfTwoMet,
        ms: Date.now() - started,
      });
    } catch (err) {
      // Report the miss rather than failing the sweep — one bad market must not
      // stop the others from warming.
      results.push({ ...m, ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
    }
  }

  const warmed = results.filter((r) => r.ok).length;
  return NextResponse.json({
    success: true,
    warmed,
    failed: results.length - warmed,
    note: 'Result cache TTL is 6h — re-run the morning of a demo.',
    results,
  });
}
