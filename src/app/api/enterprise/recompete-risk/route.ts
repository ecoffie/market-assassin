/**
 * POST /api/enterprise/recompete-risk — the Enterprise/API feed WEDGE (GOS #018).
 *
 * The question every feed buyer (funds, lenders, PE, surety) pays to answer:
 * "which of my book's federal revenue is at risk — before the 8-K?"
 *
 * Body: { ueis: string[] }  (a watchlist / loan book / portfolio — up to MAX_UEIS)
 * Returns, per UEI: their federal contract book, revenue expiring in 6/12/18-month windows,
 * slip history (recorded change log — the moat), concentration, and a transparent risk score.
 *
 * Auth: a valid Mindy API key (Bearer / X-Mindy-API-Key) OR admin password. NOT credit-metered
 * — enterprise is a data LICENSE (#016), so this reads the corpus without debiting credits.
 *
 * Reads the indexed Supabase tables (recompete_opportunities + recompete_changes), NOT BigQuery,
 * so it's cheap and can't touch the app's shared BQ quota.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { verifyApiKey } from '@/lib/mcp/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UEIS = 500;

interface OppRow {
  contract_id: string; incumbent_uei: string | null; incumbent_name: string | null;
  awarding_agency: string | null; naics_code: string | null;
  potential_total_value: number | null; period_of_performance_current_end: string | null;
  recompete_likelihood: number | null;
}

async function authorize(request: NextRequest): Promise<boolean> {
  if (request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD) return true;
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-mindy-api-key');
  if (!raw) return false;
  return Boolean(await verifyApiKey(raw));
}

const monthsFromNow = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let ueis: string[];
  try {
    const body = await request.json();
    ueis = Array.isArray(body?.ueis) ? body.ueis : [];
  } catch { return NextResponse.json({ error: 'body must be { ueis: string[] }' }, { status: 400 }); }
  ueis = [...new Set(ueis.map((u) => String(u || '').toUpperCase().trim()).filter(Boolean))];
  if (!ueis.length) return NextResponse.json({ error: 'no ueis provided' }, { status: 400 });
  const capped = ueis.length > MAX_UEIS;
  ueis = ueis.slice(0, MAX_UEIS);

  const db = getReadClient();
  const today = new Date().toISOString().slice(0, 10);
  const w6 = monthsFromNow(6), w12 = monthsFromNow(12), w18 = monthsFromNow(18);

  // One pass over the book's contracts.
  const { data: opps, error } = await db
    .from('recompete_opportunities')
    .select('contract_id,incumbent_uei,incumbent_name,awarding_agency,naics_code,potential_total_value,period_of_performance_current_end,recompete_likelihood')
    .in('incumbent_uei', ueis)
    .is('quality_flag', null)
    .limit(50000);
  if (error) return NextResponse.json({ error: `query failed: ${error.message}` }, { status: 500 });
  const rows = (opps || []) as OppRow[];

  // THE MOAT SIGNAL — the recorded diff on this book's contracts. Expiry is public (anyone can
  // read a PoP end date off USASpending); "it slipped twice, the incumbent novated, the ceiling
  // grew" exists ONLY in our append-only log. The risk score leads on this, not on expiry.
  const contractIds = rows.map((r) => r.contract_id).filter(Boolean);
  type Chg = { slips: number; ceiling_moves: number; novations: number };
  const changesByContract = new Map<string, Chg>();
  for (let i = 0; i < contractIds.length; i += 1000) {
    const { data: ch, error: chErr } = await db
      .from('recompete_changes')
      .select('contract_id,field')
      .in('contract_id', contractIds.slice(i, i + 1000))
      .limit(20000);
    if (chErr) return NextResponse.json({ error: `changes query failed: ${chErr.message}` }, { status: 500 });
    for (const c of (ch || []) as { contract_id: string; field: string }[]) {
      const cur = changesByContract.get(c.contract_id) || { slips: 0, ceiling_moves: 0, novations: 0 };
      if (c.field === 'period_of_performance_current_end') cur.slips++;
      else if (c.field === 'potential_total_value') cur.ceiling_moves++;
      else if (c.field === 'incumbent_uei') cur.novations++;
      changesByContract.set(c.contract_id, cur);
    }
  }

  const byUei = new Map<string, OppRow[]>();
  for (const r of rows) { if (!r.incumbent_uei) continue; const k = r.incumbent_uei.toUpperCase(); (byUei.get(k) || byUei.set(k, []).get(k)!).push(r); }

  const results = ueis.map((uei) => {
    const list = byUei.get(uei) || [];
    if (!list.length) return { uei, found: false, contract_count: 0, revenue_at_risk: { mo6: 0, mo12: 0, mo18: 0 }, total_ceiling: 0, change_signals: { slips: 0, ceiling_moves: 0, novations: 0, total: 0 }, risk_score: 0, risk_tier: 'unknown' as const };
    const val = (r: OppRow) => Number(r.potential_total_value) || 0;
    const end = (r: OppRow) => r.period_of_performance_current_end || '';
    const inWin = (r: OppRow, w: string) => end(r) >= today && end(r) <= w;
    const total_ceiling = list.reduce((s, r) => s + val(r), 0);
    const mo6 = list.filter((r) => inWin(r, w6)).reduce((s, r) => s + val(r), 0);
    const mo12 = list.filter((r) => inWin(r, w12)).reduce((s, r) => s + val(r), 0);
    const mo18 = list.filter((r) => inWin(r, w18)).reduce((s, r) => s + val(r), 0);
    const chg = list.reduce((a, r) => { const c = changesByContract.get(r.contract_id); if (c) { a.slips += c.slips; a.ceiling_moves += c.ceiling_moves; a.novations += c.novations; } return a; }, { slips: 0, ceiling_moves: 0, novations: 0 });
    const change_events = chg.slips + chg.ceiling_moves + chg.novations;
    // concentration
    const agg = (key: 'awarding_agency' | 'naics_code') => {
      const m = new Map<string, number>();
      for (const r of list) { const k = r[key]; if (k) m.set(k, (m.get(k) || 0) + val(r)); }
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? { name: top[0], value: top[1], share: total_ceiling ? Math.round((top[1] / total_ceiling) * 100) : 0 } : null;
    };
    // MOAT-WEIGHTED score: the recorded CHANGE is the differentiated signal (a slip is real
    // schedule instability; a novation is a recipient change; a ceiling move is scope drift) —
    // it dominates (60) over the commodity expiry exposure (40). A novation weighs 2×, a ceiling
    // move 0.5×. As the append-only log accrues, this score becomes something no expiry-reader has.
    const atRiskPct = total_ceiling ? mo12 / total_ceiling : 0;
    const changeSignal = list.length ? Math.min(1, (chg.slips + chg.novations * 2 + chg.ceiling_moves * 0.5) / list.length) : 0;
    const risk_score = Math.min(100, Math.round(changeSignal * 60 + atRiskPct * 40));
    const risk_tier = risk_score >= 60 ? 'high' : risk_score >= 30 ? 'medium' : 'low';
    return {
      uei, found: true, incumbent_name: list.find((r) => r.incumbent_name)?.incumbent_name || null,
      contract_count: list.length, total_ceiling,
      revenue_at_risk: { mo6, mo12, mo18 }, at_risk_pct_12mo: Math.round(atRiskPct * 100),
      change_signals: { slips: chg.slips, ceiling_moves: chg.ceiling_moves, novations: chg.novations, total: change_events },
      top_agency: agg('awarding_agency'), top_naics: agg('naics_code'),
      risk_score, risk_tier,
    };
  });

  return NextResponse.json({
    success: true,
    as_of: today,
    requested: ueis.length, capped, max_ueis: MAX_UEIS,
    found: results.filter((r) => r.found).length,
    _meta: { source: 'recompete_opportunities + recompete_changes', windows_months: [6, 12, 18], note: 'risk_score LEADS on the recorded change signal (slips/novations/ceiling-moves — the append-only moat log, weighted 60), with 12mo expiry exposure as the commodity base (40). change_signals are returned raw; today the log is young (recording since 2026-07-16) so change signals are sparse and grow over time — that accrual IS the moat.' },
    results,
  });
}
