/**
 * MCP tool: generate_market_report — the whole market in ONE call.
 *
 * The "one-shot market report" (Eric, 2026-07-16): Mindy users were chaining
 * keyword-coverage → top-agencies → competition → recompetes → forecasts →
 * set-aside gap by hand. This collapses that whole workflow into a single agent
 * call and hands back BOTH structured JSON and a Mindy-branded, client-ready HTML
 * deliverable (Sue can show a client the entire market in one artifact).
 *
 * No new data engine — it fans out (parallel, each guarded) to existing pure fns:
 *   keywordCoverage / codeMarketSize · fetchFPDSByNaics+mapFPDSToAgencies ·
 *   searchContractors · expiringContracts · agencyForecasts ·
 *   getAgencySpendingDetailTool · getSbaGoalingShare.
 *
 * Pattern: pure fn, `_meta` ALWAYS ships, `_ai_hint` OFF by default (data-first),
 * honest-miss = never fabricate. Credits handled by the transport (runMeteredTool).
 *
 * The report is PERSISTED (market_reports) and handed back as a shareable
 * `deliverable.url` (/reports/<id>) — the link Sue actually sends a client. Saving is
 * best-effort: if storage is down the caller still gets the full JSON + inline HTML,
 * just without a link (they paid credits for this call — never lose the result).
 * PDF = the hosted page's Save-as-PDF (server-side HTML→PDF would need Chromium in
 * the lambda; puppeteer is a devDependency). See tasks/one-shot-tools-plan.md.
 */
import { keywordCoverage, codeMarketSize, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { resolveMarketScope, filtersForScope, fetchSpendingCategory } from '@/lib/market/spend-query';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { getAgencySpendingDetailTool } from '@/mcp/tools/agency-spending-detail';
import { getSbaGoalingShare } from '@/mcp/tools/sba-goaling';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';
import { saveMarketReport } from '@/lib/market/report-store';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export interface MarketReportInput {
  keyword?: string;
  naics?: string;
  agency?: string;
  state?: string;
  set_aside?: string;
  /** Optional label for the deliverable header (e.g. Sue's client name). */
  client_name?: string;
  /** The verified MCP caller (ctx.userEmail) — owns the saved report. Never from args. */
  userEmail?: string;
}

/**
 * A buying sub-agency and its obligated dollars, from the SAME spending_by_category
 * call the in-app FPDS leaderboards make — so the report and the panel reconcile.
 * (The old FPDS ATOM path also carried contract/vendor counts; spending_by_category
 * doesn't return counts, and inventing them would be fabrication. Dollars are the
 * figure that reconciles, which is the whole point.)
 */
interface TopAgency { name: string; amount: number }

export interface MarketReportSummary {
  subject: string;
  axis: 'keyword' | 'naics' | 'agency';
  total_market: number | null;
  naics_count: number | null;
  top_psc: { code: string; name: string } | null;
  buying_agencies: number;
  top_contractors: number;
  recompetes: number;
  forecasts: number;
}

/**
 * How to reconcile this report against a NAICS-anchored tool (HigherGov, SweetSpot…).
 *
 * Eric, 2026-07-16: "people who are comparing us to another platform that uses NAICS
 * may say our data is incorrect." An unlabelled number always loses that argument —
 * even when it's the more accurate one. So we show THEIR number on OUR page and
 * explain it: searching the single biggest code alone returns X (28% of drones); this
 * report covers the whole keyword market. Their figure becomes evidence for us.
 *
 * Only meaningful for a keyword report whose market sprawls; null otherwise (a
 * single-code market has nothing to reconcile — never manufacture a comparison).
 */
export interface MarketReconciliation {
  /** The code a NAICS-anchored search would use — the biggest by dollars. */
  single_naics: string;
  single_naics_name: string;
  /** What that one code returns, and its share of the real market. */
  single_naics_amount: number;
  single_naics_pct: number;
  /** What this report covers. */
  total_market: number;
  naics_count: number;
  /** The share a single-code search MISSES. */
  missed_pct: number;
}

/** What each section measured — so the report can say it out loud. */
export interface MarketReportBasis {
  /** keyword | keyword_psc | psc | naics — how the market was scoped. */
  scope: string;
  /** Human-readable ranking label, identical to the in-app leaderboards'. */
  label: string;
  /** True when a dominant-NAICS keyword was ranked by its lead code. */
  ranked_by_dominant_naics: boolean;
  /** The NAICS the NAICS-keyed sections (contractors/recompetes/forecasts) used. */
  naics_sections_code: string | null;
}

export interface MarketReportResult {
  subject: string;
  generated_for: string | null;
  summary: MarketReportSummary;
  /** What was measured, so every section can state its basis. */
  basis: MarketReportBasis | null;
  /** The "their number vs ours" line. Null when there's nothing to reconcile. */
  reconciliation: MarketReconciliation | null;
  sections: {
    market_size: KeywordCoverage | { basis: string; total_market: number; top_psc: unknown } | null;
    top_agencies: TopAgency[];
    competition: { contractors: unknown[]; count: number };
    recompetes: { contracts: unknown[]; count: number };
    forecasts: { forecasts: unknown[]; count: number };
    agency_detail: unknown | null;
    set_aside_gap: unknown | null;
  };
  /**
   * Client-ready deliverable. `html` is a self-contained Mindy-branded report;
   * `url` is the hosted, shareable version of that same report — the link to send a
   * client. `url` is null when the report could not be saved (storage unavailable or
   * no verified caller); the html is still valid.
   */
  deliverable: { html: string; url: string | null; report_id: string | null };
  _meta: { grounded: boolean; degraded: boolean; sections_grounded: number; sections_total: number; saved: boolean };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
}

/** Settle a guarded section; a throw becomes { value:null, degraded:true } (never rejects). */
async function guard<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    console.error('[mcp:generate_market_report] section failed:', err);
    return { value: null, degraded: true };
  }
}

export async function generateMarketReport(input: MarketReportInput): Promise<MarketReportResult> {
  const keyword = (input.keyword || '').trim();
  const naicsIn = (input.naics || '').trim();
  const agency = (input.agency || '').trim();
  const state = (input.state && normalizeStateCode(input.state)) || undefined;
  const setAside = (input.set_aside || '').trim() || undefined;

  const axis: 'keyword' | 'naics' | 'agency' = keyword ? 'keyword' : naicsIn ? 'naics' : 'agency';
  const subject = keyword || naicsIn || agency || 'the federal market';

  // Market size first (keyword mode needs the coverage NAICS set to drive the rest).
  const coverage = keyword ? (await guard(keywordCoverage(keyword))).value : null;
  const marketSize = keyword
    ? coverage
    : naicsIn
      ? (await guard(codeMarketSize({ naics: naicsIn }))).value
      : null;

  // Resolve the market scope through the SHARED decision (src/lib/market/spend-query),
  // so this report's "Who is buying" is the IDENTICAL query the in-app FPDS
  // leaderboards run. Computing our own answer here is how TMR and the leaderboards
  // drifted until their totals couldn't be reconciled (PR #245) — a client-facing
  // report that disagrees with our own panel is indefensible.
  const scope = keyword || naicsIn ? (await guard(resolveMarketScope({ keyword, naics: naicsIn, coverage }))).value : null;

  /**
   * A DOMINANT keyword is ranked by its lead NAICS, so the headline total must be that
   * code's market too — or the report contradicts itself. Measured on "roofing": the
   * keyword total ($578M, awards whose TEXT says roofing) sat above a "Who is buying"
   * table summing past $1.1B (ALL of 238160). Same market, two bases, no explanation —
   * exactly the "numbers don't match" read we're trying to kill. Re-measure the total
   * on the SAME basis the sections use.
   */
  const dominantSize = scope?.rankedByDominantNaics && scope.naicsCodes[0]
    ? (await guard(codeMarketSize({ naics: scope.naicsCodes[0] }))).value
    : null;

  // NAICS-keyed sections still need ONE code: an explicit code, else the market's lead.
  // (The lead is the semantically-right code after promotion — NOT necessarily the
  // biggest; see keyword-coverage's lead-vs-biggest split.)
  const primaryNaics = naicsIn || coverage?.allNaics?.[0]?.code || coverage?.coverageCodes?.[0] || undefined;

  // Fan out the remaining sections in parallel — each independently guarded.
  const [agenciesR, competitionR, recompetesR, forecastsR, agencyDetailR, sbaR] = await Promise.all([
    scope
      ? guard(
          fetchSpendingCategory('awarding_subagency', filtersForScope(scope, state), 10, 'market-report').then((rows) =>
            rows.map((r) => ({ name: r.name, amount: r.amount })),
          ),
        )
      : Promise.resolve({ value: null, degraded: false }),
    guard(searchContractors({ keyword: keyword || undefined, naics: primaryNaics, state, limit: 15 })),
    guard(expiringContracts({ naics: primaryNaics, agency: agency || undefined, state, limit: 15 })),
    guard(agencyForecasts({ keyword: keyword || undefined, naics: primaryNaics, agency: agency || undefined, state, set_aside: setAside, limit: 15 })),
    agency ? guard(getAgencySpendingDetailTool({ agency })) : Promise.resolve({ value: null, degraded: false }),
    agency ? guard(getSbaGoalingShare({ agency })) : Promise.resolve({ value: null, degraded: false }),
  ]);

  const topAgencies: TopAgency[] = Array.isArray(agenciesR.value)
    ? (agenciesR.value as TopAgency[]).filter((a) => a.amount > 0).slice(0, 10)
    : [];

  const contractors = competitionR.value?.contractors ?? [];
  const contracts = recompetesR.value?.contracts ?? [];
  const forecasts = forecastsR.value?.forecasts ?? [];

  const summary: MarketReportSummary = {
    subject,
    axis,
    // Dominant keyword → the lead code's total (same basis as every section below).
    total_market: dominantSize?.totalMarket
      ?? coverage?.totalMarket
      ?? (marketSize && 'totalMarket' in marketSize ? marketSize.totalMarket : marketSize && 'total_market' in marketSize ? (marketSize as { total_market: number }).total_market : null),
    naics_count: coverage?.naicsCount ?? null,
    top_psc: coverage?.topPsc ?? (marketSize && 'topPsc' in marketSize ? (marketSize as { topPsc: { code: string; name: string } | null }).topPsc : null),
    buying_agencies: topAgencies.length,
    top_contractors: contractors.length,
    recompetes: contracts.length,
    forecasts: forecasts.length,
  };

  const basis: MarketReportBasis | null = scope
    ? {
        scope: scope.basis,
        label: scope.label,
        ranked_by_dominant_naics: scope.rankedByDominantNaics,
        naics_sections_code: primaryNaics ?? null,
      }
    : null;

  // "Their number vs ours." Shown ONLY when this report genuinely ranks across the
  // whole keyword market — i.e. we actually did the thing the line brags about.
  //
  // ⚠️ NOT on the dominant path: there we rank by the lead code, so we and the
  // NAICS-anchored tool are using THE SAME code. Claiming "a single-code search misses
  // 22%" while our own agencies section is that single code would be a lie the report
  // tells about itself. Nothing to reconcile → null (an honest omission).
  // Also skipped when the biggest code already IS ~the whole market (nothing missed).
  const biggest = coverage?.allNaics?.length
    ? [...coverage.allNaics].sort((a, b) => b.amount - a.amount)[0]
    : null;
  const reconciliation: MarketReconciliation | null =
    coverage && biggest && !scope?.rankedByDominantNaics
      && coverage.totalMarket > 0 && coverage.naicsCount > 1 && coverage.topCodePct < 0.9
      ? {
          single_naics: biggest.code,
          single_naics_name: biggest.name,
          single_naics_amount: biggest.amount,
          single_naics_pct: coverage.topCodePct,
          total_market: coverage.totalMarket,
          naics_count: coverage.naicsCount,
          missed_pct: Math.max(0, 1 - coverage.topCodePct),
        }
      : null;

  const sections: MarketReportResult['sections'] = {
    market_size: marketSize as MarketReportResult['sections']['market_size'],
    top_agencies: topAgencies,
    competition: { contractors, count: contractors.length },
    recompetes: { contracts, count: contracts.length },
    forecasts: { forecasts, count: forecasts.length },
    agency_detail: agencyDetailR.value ?? null,
    set_aside_gap: sbaR.value ?? null,
  };

  // A section is "grounded" if it returned real rows/values.
  const groundedFlags = [
    !!summary.total_market,
    topAgencies.length > 0,
    contractors.length > 0,
    contracts.length > 0,
    forecasts.length > 0,
    !!agencyDetailR.value,
    !!sbaR.value,
  ];
  const sectionsGrounded = groundedFlags.filter(Boolean).length;
  const degraded = [coverage === null && keyword !== '', agenciesR.degraded, competitionR.degraded, recompetesR.degraded, forecastsR.degraded, agencyDetailR.degraded, sbaR.degraded].some(Boolean);

  const result: MarketReportResult = {
    subject,
    generated_for: input.client_name?.trim() || null,
    summary,
    basis,
    reconciliation,
    sections,
    deliverable: { html: '', url: null, report_id: null },
    _meta: { grounded: sectionsGrounded > 0, degraded, sections_grounded: sectionsGrounded, sections_total: groundedFlags.length, saved: false },
  };

  // Client-ready deliverable (Mindy-branded, self-contained).
  result.deliverable.html = renderMarketReportHtml(result);

  // Persist → shareable link. Only for a verified caller, and only when we actually
  // found something (an empty report isn't a deliverable worth a client link).
  // Best-effort: a storage failure must not lose the report the caller paid for.
  if (input.userEmail && sectionsGrounded > 0) {
    const { deliverable: _omit, ...payload } = result; // store the payload; HTML re-renders on view
    const id = await saveMarketReport({
      ownerEmail: input.userEmail,
      subject,
      clientName: input.client_name?.trim() || null,
      params: { keyword, naics: naicsIn, agency, state, set_aside: setAside, client_name: input.client_name || null },
      payload: payload as unknown as Record<string, unknown>,
    });
    if (id) {
      result.deliverable.report_id = id;
      result.deliverable.url = `${SITE_URL.replace(/\/$/, '')}/reports/${id}`;
      result._meta.saved = true;
    }
  }

  if (mcpFlags.aiHint) {
    result._ai_hint = buildHint(result);
  }

  return result;
}

function buildHint(r: MarketReportResult): NonNullable<MarketReportResult['_ai_hint']> {
  if (r._meta.degraded && r._meta.sections_grounded === 0) {
    return {
      summary: `A market report for "${r.subject}" could not be assembled — upstream sources errored.`,
      how_to_use: 'Retry; do not state the market is empty.',
      key_caveats: 'Degraded: at least one data source failed. Do NOT invent totals, agencies, or contractors.',
    };
  }
  if (r._meta.sections_grounded === 0) {
    return {
      summary: `No market data was found for "${r.subject}".`,
      how_to_use: 'Suggest a broader keyword or a specific NAICS/agency. Do not fabricate a market.',
      key_caveats: 'Genuine empty result — nothing to report. Do NOT invent figures.',
    };
  }
  const dollars = r.summary.total_market ? `$${Math.round(r.summary.total_market).toLocaleString()}` : 'an unstated total';
  return {
    summary: `Market report for "${r.subject}": ${dollars} across ${r.summary.naics_count ?? 'several'} NAICS, ${r.summary.buying_agencies} top buying agencies, ${r.summary.top_contractors} leading contractors, ${r.summary.recompetes} recompetes, ${r.summary.forecasts} forecasts.${
      r.deliverable.url ? ` Shareable report: ${r.deliverable.url}` : ''
    }`,
    how_to_use: r.deliverable.url
      ? `Use the structured sections for facts. Give the user deliverable.url (${r.deliverable.url}) — a hosted, client-ready page they can send straight to a client, with a Save-as-PDF button. deliverable.html is the same report inline. Every figure traces to a returned section.`
      : 'Use the structured sections for facts; hand deliverable.html to the client as the report. No hosted link was created for this run — do NOT invent a report URL. Every figure traces to a returned section.',
    key_caveats: 'Only cite sections that returned rows. NAICS totals are contract obligations (FY window), not budget authority. Place-of-performance/agency filters are as labeled.',
  };
}
