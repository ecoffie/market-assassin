/**
 * POST /api/enterprise/uei-financials — Enterprise/API feed endpoint #2 (GOS #018).
 *
 * Turns "federal revenue at risk" into "% of the COMPANY at risk" — the number a fund trades on.
 * For a list of UEIs, joins each incumbent to SEC EDGAR (ticker + annual revenue + net income)
 * and pairs it with their federal footprint from our corpus (ceiling + revenue expiring soon).
 *
 * Body: { ueis: string[] }  (up to MAX_UEIS — capped low because each is an EDGAR lookup)
 * Auth: Mindy API key (Bearer / X-Mindy-API-Key) OR admin password. NOT credit-metered.
 *
 * Honest by construction: a PRIVATE incumbent has no EDGAR filing → grounded=false, edgar=null
 * (never invents financials). Note: our federal figure is contract CEILING (lifetime), EDGAR
 * revenue is ANNUAL — the exposure ratio is a rough indicator, flagged in _meta, not a GAAP claim.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { verifyApiKey } from '@/lib/mcp/api-keys';
import { getIncumbentFinancialsFromEdgar, getFinancialsByTicker } from '@/lib/edgar';
import { primeTickerFor } from '@/lib/enterprise/prime-tickers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_UEIS = 50; // each UEI = one EDGAR company lookup (rate-limited, cached)

interface OppRow {
  incumbent_uei: string | null; incumbent_name: string | null;
  potential_total_value: number | null; period_of_performance_current_end: string | null;
}

async function authorize(request: NextRequest): Promise<boolean> {
  if (request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD) return true;
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-mindy-api-key');
  return raw ? Boolean(await verifyApiKey(raw)) : false;
}

const monthsFromNow = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let ueis: string[];
  try { const b = await request.json(); ueis = Array.isArray(b?.ueis) ? b.ueis : []; }
  catch { return NextResponse.json({ error: 'body must be { ueis: string[] }' }, { status: 400 }); }
  ueis = [...new Set(ueis.map((u) => String(u || '').toUpperCase().trim()).filter(Boolean))];
  if (!ueis.length) return NextResponse.json({ error: 'no ueis provided' }, { status: 400 });
  const capped = ueis.length > MAX_UEIS;
  ueis = ueis.slice(0, MAX_UEIS);

  const db = getReadClient();
  const today = new Date().toISOString().slice(0, 10), w12 = monthsFromNow(12);

  // Federal footprint per UEI (one pass).
  const { data: opps, error } = await db
    .from('recompete_opportunities')
    .select('incumbent_uei,incumbent_name,potential_total_value,period_of_performance_current_end')
    .in('incumbent_uei', ueis).is('quality_flag', null).limit(50000);
  if (error) return NextResponse.json({ error: `query failed: ${error.message}` }, { status: 500 });
  const byUei = new Map<string, OppRow[]>();
  for (const r of (opps || []) as OppRow[]) { if (!r.incumbent_uei) continue; const k = r.incumbent_uei.toUpperCase(); (byUei.get(k) || byUei.set(k, []).get(k)!).push(r); }

  // EDGAR join, small concurrency to respect the 10 req/s ceiling (results are cached).
  const CONC = 5;
  const results: unknown[] = [];
  for (let i = 0; i < ueis.length; i += CONC) {
    const batch = await Promise.all(ueis.slice(i, i + CONC).map(async (uei) => {
      const list = byUei.get(uei) || [];
      const name = list.find((r) => r.incumbent_name)?.incumbent_name || null;
      const val = (r: OppRow) => Number(r.potential_total_value) || 0;
      const total_ceiling = list.reduce((s, r) => s + val(r), 0);
      const at_risk_12mo = list.filter((r) => { const e = r.period_of_performance_current_end || ''; return e >= today && e <= w12; }).reduce((s, r) => s + val(r), 0);
      const federal = { incumbent_name: name, contract_count: list.length, total_ceiling, revenue_at_risk_12mo: at_risk_12mo };

      if (!name) return { uei, ...federal, grounded: false, edgar: null };
      // Curated ticker override first (fixes legacy/merged-name misses like Raytheon → RTX);
      // fall back to the fuzzy EDGAR name match; genuinely private → grounded=false.
      const override = primeTickerFor(name);
      let intel = null, resolved_via = override ? 'ticker_override' : 'name_match';
      try {
        intel = override ? await getFinancialsByTicker(override) : null;
        if (!intel) { intel = await getIncumbentFinancialsFromEdgar(name); if (override) resolved_via = 'name_match_fallback'; }
      } catch { /* honest miss below */ }
      const latest = intel?.financials?.[0];
      const annualRevenue = latest?.revenue ?? null;
      const grounded = !!(intel && (intel.financials.length > 0 || intel.latest_10k_url));
      return {
        uei, ...federal, grounded,
        edgar: grounded && intel ? {
          matched_name: intel.company.name, ticker: intel.company.ticker, cik: intel.company.cik,
          match_score: intel.company.match_score, resolved_via,
          latest_fy: latest?.fy ?? null, annual_revenue: annualRevenue, net_income: latest?.net_income ?? null,
          latest_10k_filed: intel.latest_10k_filed,
        } : null,
        // Rough materiality: federal ceiling expiring in 12mo vs the company's latest annual
        // revenue. Ceiling ≠ annual revenue, so this is an indicator, not a GAAP figure.
        exposure_pct_rough: annualRevenue && annualRevenue > 0 ? Math.round((at_risk_12mo / annualRevenue) * 100) : null,
      };
    }));
    results.push(...batch);
  }

  const groundedCount = results.filter((r) => (r as { grounded: boolean }).grounded).length;
  return NextResponse.json({
    success: true, as_of: today, requested: ueis.length, capped, max_ueis: MAX_UEIS,
    grounded: groundedCount, private_or_unmatched: results.length - groundedCount,
    _meta: {
      source: 'recompete_opportunities + SEC EDGAR',
      caveat: 'federal figure is contract CEILING (lifetime); EDGAR revenue is ANNUAL — exposure_pct_rough is an indicator, not a GAAP ratio. Private incumbents have no EDGAR filing (grounded=false), never fabricated.',
    },
    results,
  });
}
