/**
 * GET /api/app/market-dashboard — the grounded data behind the Reports (Market
 * Intelligence) dashboard.
 *
 * ONE call answers a whole saved market from TWO grounded sources — never a fabricated
 * figure, and anything not grounded is OMITTED (null), never a placeholder:
 *
 *  (A) The EXISTING market-report engine (`generateMarketReport`, src/mcp/tools/market-report.ts)
 *      supplies the market spine — total market $, top buying agencies, recompetes, forecasts,
 *      contacts, its grounded summary. We call the SAME generator the /api/app/market-report
 *      route uses (no re-implemented sizing), then read off its `MarketReportResult`.
 *  (B) Open-opportunity aggregations over the SAME saved filter, using the SHARED map engine
 *      (`parseMapFilters` + `applyMapFilters`) against `sam_opportunities` — so the dashboard's
 *      "Open Opportunities" reconciles with the live map/alerts. From the matches we compute
 *      open count, largest-open, $ by place-of-performance state, and Opportunity-DNA strand
 *      counts (from the persisted `opportunity_dna_keys` TEXT[]).
 *
 * NO delta / percent-change / trend / "heating up" data — none of that is grounded (there are no
 * historical snapshots), so those fields are OMITTED entirely.
 *
 * MI-token authed exactly like the market-report route (`requireMIAuthSession`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getAppSupabase, normalizeEmail } from '@/lib/app/workspace';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
import { generateMarketReport } from '@/mcp/tools/market-report';
import { sapBuyerTier } from '@/lib/opportunities/sap-friendly-agencies';
import { normalizeStateCode, US_STATE_NAMES } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // the live market-report generator can take a few seconds

// Cap the open-opp scan (PostgREST hard-caps at 1000 anyway); flag when we hit it so the UI
// can label the figure as a floor rather than an exact total.
const OPEN_SCAN_LIMIT = 500;

/** Human labels for the persisted opportunity_dna_keys strand keys (from STRATEGY_STRAND_KEYS). */
const DNA_LABELS: Record<string, string> = {
  recompete: 'Recompete',
  forecast: 'Forecast',
  sources_sought: 'Sources sought',
  closes_soon: 'Closes soon',
  last_chance: 'Last chance',
  early_cycle: 'Early cycle',
  sb_friendly: 'SB-friendly buyer',
  repeat_buyer: 'Repeat buyer',
  posts_early: 'Posts early',
  set_aside: 'Set-aside',
  full_open: 'Full & open',
};

interface OpenOppRow {
  notice_id: string | null;
  title: string | null;
  response_deadline: string | null;
  intel_value_range: { low?: number; median?: number; high?: number } | null;
  pop_state: string | null;
  office_address: { state?: string } | null;
  department: string | null;
  sub_tier: string | null;
  set_aside_code: string | null;
  naics_code: string | null;
  opportunity_dna_keys: string[] | null;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email')?.toLowerCase().trim() || '';
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const naics = (sp.get('naics') || '').trim();
  const psc = (sp.get('psc') || '').trim();
  const q = (sp.get('q') || sp.get('search') || '').trim();
  const agency = (sp.get('agency') || '').trim();
  const state = (sp.get('state') || '').trim();
  const setAside = (sp.get('set_aside') || sp.get('setAside') || '').trim();

  // A market needs at least one axis; without one there's nothing grounded to build.
  if (!naics && !psc && !q && !agency) {
    return NextResponse.json({ success: false, error: 'naics, psc, q, or agency is required' }, { status: 400 });
  }

  const supabase = getAppSupabase();

  // ── (A) The market spine — REUSE the report generator (no re-implemented sizing). ──
  let report: Awaited<ReturnType<typeof generateMarketReport>> | null = null;
  try {
    report = await generateMarketReport({
      keyword: q || undefined,
      naics: naics || undefined,
      psc: psc || undefined,
      agency: agency || undefined,
      set_aside: setAside || undefined,
      state: state || undefined,
      // No userEmail → do NOT persist a report row here; the dashboard is a read surface. The
      // Share/Export flow mints the hosted /reports/<id> via POST /api/app/market-report instead.
    });
  } catch (err) {
    console.error('[market-dashboard] generator failed:', err);
    return NextResponse.json({ success: false, error: 'Market data could not be assembled. Try again shortly.' }, { status: 502 });
  }

  const summary = report.summary;
  const topAgencies = report.sections.top_agencies || [];
  const topForecasts = (report.sections.forecasts?.forecasts || []).slice(0, 12).map((f) => {
    const r = f as Record<string, unknown>;
    return {
      title: String(r.title ?? ''),
      agency: String(r.agency ?? r.department ?? ''),
      naics: String(r.naics_code ?? ''),
      fiscalYear: [r.fiscal_year, r.quarter].filter(Boolean).join(' ') || null,
      setAside: (r.set_aside_type as string) || null,
    };
  });

  // Repeat-buyer / SB-friendly derived from the report's top agencies via the EXISTING lib.
  // sapBuyerTier === 'most' == SB-friendly (PO-share tier). Count agencies where it holds.
  // A grounded per-agency repeat signal is NOT cleanly available at the agency-name level here
  // (it needs agency+NAICS), so repeatBuyers is derived from the OPEN corpus below (dna strand)
  // instead of guessed — see repeatBuyerAgencies.
  let sbFriendlyBuyers: number | null = null;
  if (topAgencies.length) {
    sbFriendlyBuyers = topAgencies.filter((a) => sapBuyerTier(a.name) === 'most').length;
  }

  // ── (B) Open-opportunity aggregations over the SAME saved filter (shared map engine). ──
  const f = parseMapFilters((k) => {
    switch (k) {
      case 'q':
      case 'search': return q || null;
      case 'naics': return naics || null;
      case 'psc': return psc || null;
      case 'agency': return agency || null;
      case 'state': return state || null;
      case 'setAside': return setAside || null;
      default: return null;
    }
  });
  f.postedDays = f.postedDays || 30;

  let openQuery = supabase
    .from('sam_opportunities')
    .select('notice_id, title, response_deadline, intel_value_range, pop_state, office_address, department, sub_tier, set_aside_code, naics_code, opportunity_dna_keys')
    .limit(OPEN_SCAN_LIMIT);
  openQuery = applyMapFilters(openQuery, f);
  const { data: openData, error: openErr } = await openQuery.order('posted_date', { ascending: false });
  if (openErr) {
    console.error('[market-dashboard] open-opps query failed:', openErr.message);
    return NextResponse.json({ success: false, error: openErr.message }, { status: 500 });
  }

  const openRows = (openData || []) as OpenOppRow[];
  const openOpportunities = openRows.length;
  const openCapped = openOpportunities >= OPEN_SCAN_LIMIT;

  const median = (r: OpenOppRow): number | null =>
    r.intel_value_range && typeof r.intel_value_range.median === 'number' ? r.intel_value_range.median : null;

  // Largest open opportunities — top 5 by M-Estimate median (skip null medians = UNKNOWN, not $0).
  const largestOpen = openRows
    .map((r) => ({ r, m: median(r) }))
    .filter((x): x is { r: OpenOppRow; m: number } => x.m != null && x.m > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, 5)
    .map(({ r, m }) => ({
      noticeId: r.notice_id || null,
      title: r.title || 'Untitled opportunity',
      agency: r.sub_tier || r.department || '',
      value: m,
      deadline: r.response_deadline || null,
    }));

  // Where the money is — sum medians by place-of-performance state (pop_state, else office state).
  // SKIP null medians (a null is UNKNOWN, never $0 — never fabricate a total).
  const stateSum = new Map<string, number>();
  for (const r of openRows) {
    const m = median(r);
    if (m == null || m <= 0) continue;
    const st = normalizeStateCode(r.pop_state || r.office_address?.state || '');
    if (!st) continue;
    stateSum.set(st, (stateSum.get(st) || 0) + m);
  }
  const byStateTotal = [...stateSum.values()].reduce((t, v) => t + v, 0);
  const byState = [...stateSum.entries()]
    .map(([code, value]) => ({
      state: US_STATE_NAMES[code] || code,
      code,
      value,
      pct: byStateTotal > 0 ? value / byStateTotal : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Opportunity DNA — count persisted genome strands across the matched open opps. The column is
  // populated (opportunity_dna_keys TEXT[]); if a whole match set had none we return null (do NOT
  // invent percentages).
  const strandCount = new Map<string, number>();
  let rowsWithDna = 0;
  for (const r of openRows) {
    const keys = Array.isArray(r.opportunity_dna_keys) ? r.opportunity_dna_keys : [];
    if (keys.length) rowsWithDna++;
    for (const k of keys) strandCount.set(k, (strandCount.get(k) || 0) + 1);
  }
  const opportunityDna = rowsWithDna > 0
    ? [...strandCount.entries()]
        .map(([key, count]) => ({
          key,
          label: DNA_LABELS[key] || key,
          count,
          pct: openOpportunities > 0 ? count / openOpportunities : 0,
        }))
        .sort((a, b) => b.count - a.count)
    : null;

  // Repeat-buyer count grounded from the OPEN corpus: distinct buying agencies among opps whose
  // genome carries the repeat_buyer strand. Grounded (the strand is computed from real award
  // history); null when no matched opp carries it, rather than a guess.
  const repeatBuyerAgencies = new Set<string>();
  for (const r of openRows) {
    if (Array.isArray(r.opportunity_dna_keys) && r.opportunity_dna_keys.includes('repeat_buyer')) {
      const a = r.sub_tier || r.department;
      if (a) repeatBuyerAgencies.add(a);
    }
  }
  const repeatBuyers = repeatBuyerAgencies.size > 0 ? repeatBuyerAgencies.size : null;

  // Top buyers — from the report's grounded agency table (dollars from the same USASpending
  // source the in-app leaderboards use). opps column intentionally omitted (the report's
  // spending_by_category has no per-agency open-opp count; inventing one is fabrication).
  const topBuyers = topAgencies.map((a) => ({ name: a.name, amount: a.amount }));

  return NextResponse.json({
    success: true,
    subject: report.subject,
    market: {
      naics: naics || null,
      psc: psc || null,
      q: q || null,
      agency: agency || null,
      state: state || null,
      set_aside: setAside || null,
      axis: summary.axis,
    },
    kpis: {
      openOpportunities,
      openCapped,
      totalMarketValue: summary.total_market,       // may be null (honest unknown)
      forecasts: summary.forecasts,
      buyingNaics: summary.naics_count,              // null when not a keyword market
      repeatBuyers,                                  // null when no grounded signal
      sbFriendlyBuyers,                              // null when no agency table
    },
    topBuyers,
    topBuyersTotal: report.sections.top_agencies_total ?? topBuyers.length,
    opportunityDna,                                  // null when no per-row genome (never invented)
    byState,
    topForecasts,
    largestOpen,
    summaryText: buildSummaryText(report),
    basis: report.basis,
    reconciliation: report.reconciliation,
    degraded: report._meta.degraded,
    grounded: report._meta.grounded,
  });
}

/**
 * A grounded one-paragraph market summary from the report's real figures — no LLM narration
 * (the generator's `_ai_hint` is off by default), and no fabricated numbers. When nothing is
 * grounded, say so honestly rather than invent a market.
 */
function buildSummaryText(report: Awaited<ReturnType<typeof generateMarketReport>>): string {
  const s = report.summary;
  if (!report._meta.grounded) {
    return `No federal market data was found for "${report.subject}". Try a broader keyword, a 6-digit NAICS, or remove the state filter.`;
  }
  const money = (v: number | null): string => {
    if (v == null || !Number.isFinite(v) || v <= 0) return 'an unstated total';
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  };
  const parts: string[] = [];
  parts.push(
    `The ${report.subject} market represents ${money(s.total_market)} in recent federal contract obligations` +
      (s.naics_count ? ` across ${s.naics_count} buying NAICS codes` : '') + '.',
  );
  if (s.buying_agencies) {
    parts.push(`${s.buying_agencies} top buying ${s.buying_agencies === 1 ? 'agency accounts' : 'agencies account'} for the bulk of the spend.`);
  }
  if (s.recompetes) parts.push(`${s.recompetes} incumbent ${s.recompetes === 1 ? 'contract is' : 'contracts are'} expiring and likely to recompete.`);
  if (s.forecasts) parts.push(`${s.forecasts} planned ${s.forecasts === 1 ? 'procurement is' : 'procurements are'} forecast 6–18 months out.`);
  if (report.reconciliation) {
    parts.push(
      `Searching the single biggest code (${report.reconciliation.single_naics}) alone would miss ${Math.round(report.reconciliation.missed_pct * 100)}% of this market.`,
    );
  }
  return parts.join(' ');
}
