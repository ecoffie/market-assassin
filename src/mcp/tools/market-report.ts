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
import { fetchFPDSByNaics, mapFPDSToAgencies } from '@/lib/utils/fpds-api';
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

interface TopAgency { name: string; sub_agency: string; contract_count: number; unique_vendors: number }

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

export interface MarketReportResult {
  subject: string;
  generated_for: string | null;
  summary: MarketReportSummary;
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

  // Primary NAICS = explicit code, else the biggest buyer from coverage.
  const primaryNaics = naicsIn || coverage?.allNaics?.[0]?.code || coverage?.coverageCodes?.[0] || undefined;

  // Fan out the remaining sections in parallel — each independently guarded.
  const [agenciesR, competitionR, recompetesR, forecastsR, agencyDetailR, sbaR] = await Promise.all([
    primaryNaics
      ? guard(fetchFPDSByNaics(primaryNaics, { maxRecords: 300 }).then(mapFPDSToAgencies))
      : Promise.resolve({ value: null, degraded: false }),
    guard(searchContractors({ keyword: keyword || undefined, naics: primaryNaics, state, limit: 15 })),
    guard(expiringContracts({ naics: primaryNaics, agency: agency || undefined, state, limit: 15 })),
    guard(agencyForecasts({ keyword: keyword || undefined, naics: primaryNaics, agency: agency || undefined, state, set_aside: setAside, limit: 15 })),
    agency ? guard(getAgencySpendingDetailTool({ agency })) : Promise.resolve({ value: null, degraded: false }),
    agency ? guard(getSbaGoalingShare({ agency })) : Promise.resolve({ value: null, degraded: false }),
  ]);

  const topAgencies: TopAgency[] = Array.isArray(agenciesR.value)
    ? agenciesR.value.slice(0, 10).map((a) => ({
        name: a.parentAgency || a.name,
        sub_agency: a.subAgency || a.name,
        contract_count: a.contractCount || 0,
        unique_vendors: a.uniqueVendorCount || 0,
      }))
    : [];

  const contractors = competitionR.value?.contractors ?? [];
  const contracts = recompetesR.value?.contracts ?? [];
  const forecasts = forecastsR.value?.forecasts ?? [];

  const summary: MarketReportSummary = {
    subject,
    axis,
    total_market: coverage?.totalMarket ?? (marketSize && 'totalMarket' in marketSize ? marketSize.totalMarket : marketSize && 'total_market' in marketSize ? (marketSize as { total_market: number }).total_market : null),
    naics_count: coverage?.naicsCount ?? null,
    top_psc: coverage?.topPsc ?? (marketSize && 'topPsc' in marketSize ? (marketSize as { topPsc: { code: string; name: string } | null }).topPsc : null),
    buying_agencies: topAgencies.length,
    top_contractors: contractors.length,
    recompetes: contracts.length,
    forecasts: forecasts.length,
  };

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
