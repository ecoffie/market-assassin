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
import { keywordCoverage, codeMarketSize, marketKeywords, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { detectUndercount } from '@/lib/market/undercount-signal';
import { resolveMarketScope, filtersForScope, fetchSpendingCategory, buildSpendingFilters } from '@/lib/market/spend-query';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { queryFederalContacts } from '@/lib/gov-contacts/contact-roster';
import { displayContactName } from '@/lib/gov-contacts/contact-quality';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { getAgencySpendingDetailTool } from '@/mcp/tools/agency-spending-detail';
import { getSbaGoalingShare } from '@/mcp/tools/sba-goaling';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';
import { saveMarketReport } from '@/lib/market/report-store';
import {
  runSection,
  isFailed,
  type SectionOutcome,
  type SectionStatus,
} from '@/lib/market/section-outcome';
import {
  dedupeForecasts,
  dedupeRecompetes,
  normalizeForecastSetAside,
  presentRecompete,
} from '@/lib/market/report-presentation';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export interface MarketReportInput {
  keyword?: string;
  /**
   * One NAICS, or a comma-separated list (a saved search's full code set, e.g.
   * "541511,541512,541513,541519"). A list is measured as ONE market (the union) —
   * a faithful readout of the search, never one code picked for the user.
   */
  naics?: string;
  /**
   * A PSC code (or comma list) — for a market defined by WHAT WAS BOUGHT rather than the
   * seller's NAICS. Cybersecurity is the case: it has no NAICS home, so a Cyber saved
   * search scopes by PSC DJ01/DJ10. Takes precedence over naics when both are absent of a
   * keyword (the scope resolver ranks PSC by the security product bought).
   */
  psc?: string;
  agency?: string;
  state?: string;
  set_aside?: string;
  /** Optional label for the deliverable header (e.g. Sue's client name). */
  client_name?: string;
  /** The verified MCP caller (ctx.userEmail) — owns the saved report. Never from args. */
  userEmail?: string;
}

/**
 * A saved search stores the map's SHORT agency code ("DEFENSE", "VETERANS AFFAIRS"),
 * but USASpending's toptier agency filter needs the FULL name ("Department of Defense").
 * Map the known short codes → full toptier names (mirrors AGENCY_PRESETS on the map). An
 * already-full name (or an unknown value) passes through unchanged — the toptier filter
 * either matches it or returns empty honestly, never a wrong agency.
 */
const AGENCY_SHORT_TO_TOPTIER: Record<string, string> = {
  DEFENSE: 'Department of Defense',
  'VETERANS AFFAIRS': 'Department of Veterans Affairs',
  INTERIOR: 'Department of the Interior',
  'HOMELAND SECURITY': 'Department of Homeland Security',
  AGRICULTURE: 'Department of Agriculture',
  'HEALTH AND HUMAN SERVICES': 'Department of Health and Human Services',
  'STATE, DEPARTMENT': 'Department of State',
  JUSTICE: 'Department of Justice',
  COMMERCE: 'Department of Commerce',
  'NATIONAL AERONAUTICS': 'National Aeronautics and Space Administration',
  'GENERAL SERVICES': 'General Services Administration',
  ENERGY: 'Department of Energy',
  TRANSPORTATION: 'Department of Transportation',
  LABOR: 'Department of Labor',
  'ENVIRONMENTAL PROTECTION': 'Environmental Protection Agency',
  TREASURY: 'Department of the Treasury',
};
function normalizeAgencyToToptier(v: string): string {
  const k = v.trim().toUpperCase();
  return AGENCY_SHORT_TO_TOPTIER[k] || v.trim();
}

/**
 * Saved-search set-aside label/code → USASpending set_aside_type_codes (mirrors the
 * buckets in agency-spending-detail.ts). Returns undefined for an unknown/blank value
 * so the report just skips the filter rather than fabricating a scope.
 */
function setAsideToUsaspendingCodes(v: string | undefined): string[] | undefined {
  const k = (v || '').trim().toUpperCase();
  if (!k) return undefined;
  const MAP: Record<string, string[]> = {
    SB: ['SBA', 'SBP'], SMALL: ['SBA', 'SBP'], 'SMALL BUSINESS': ['SBA', 'SBP'],
    '8A': ['8A', '8AN'], '8(A)': ['8A', '8AN'],
    SDVOSB: ['SDVOSBC', 'SDVOSBS'],
    WOSB: ['WOSB', 'EDWOSB'], EDWOSB: ['WOSB', 'EDWOSB'],
    HZ: ['HZC', 'HZS'], HUBZONE: ['HZC', 'HZS'],
  };
  return MAP[k];
}

/**
 * A buying sub-agency and its obligated dollars, from the SAME spending_by_category
 * call the in-app FPDS leaderboards make — so the report and the panel reconcile.
 * (The old FPDS ATOM path also carried contract/vendor counts; spending_by_category
 * doesn't return counts, and inventing them would be fabrication. Dollars are the
 * figure that reconciles, which is the whole point.)
 */
interface TopAgency { name: string; amount: number }

/**
 * How a market total was derived — the audit trail behind the headline.
 *
 * A keyword market has three honest readings, and a report that shows only one
 * cannot be checked. Naming each derivation is the difference between "our number"
 * and "a number nobody computed":
 *
 *   named       — awards whose TEXT contains the keyword. A FLOOR, never the market:
 *                 classified, component-level and indirectly-titled work never says
 *                 the name.
 *   term_of_art — named PLUS the curated synonyms this market is actually bought
 *                 under (hypersonic → scramjet, boost glide, CPS…). Every term
 *                 live-verified; the rejected ones are documented too.
 *   code_total  — everything in the surrounding NAICS. The CEILING, and mostly NOT
 *                 this market — 332993 is bombs and ammunition, of which hypersonics
 *                 is a slice. Shown for context, never as the answer.
 */
export interface MarketSizeTier {
  basis: 'named' | 'term_of_art' | 'code_total';
  label: string;
  amount: number | null;
  /** Plain-English derivation, rendered verbatim so the reader can audit it. */
  method: string;
  /** Terms/codes the tier was measured with. */
  inputs: string[];
  /**
   * EXPLAIN (Poteto 2026-09-22): what this reading is FOR in the report. A tier and
   * the headline measure different things (period, term set); without a role each one
   * read as "the market", and the construction literal-phrase $0 sat beside a $919.7M
   * headline as if both described the same market.
   *   sections_basis — the term set the agency + contractor tables are ranked on
   *   floor          — literal phrase only; context, not the market
   */
  role: 'sections_basis' | 'floor';
  /** Plain-English relationship to the headline, rendered beside the amount. */
  note: string | null;
}

export interface MarketReportSummary {
  subject: string;
  axis: 'keyword' | 'naics' | 'agency';
  total_market: number | null;
  /**
   * RC-5 — provenance for `total_market`, so a headline and a section total that
   * measure different things are LABELLED rather than read as a contradiction.
   * `state_scoped:false` with a non-null `requested_state` is the explicit
   * disclosure that the headline is national while the sections are not.
   */
  total_market_basis?: {
    source: 'lead_naics_code' | 'keyword_description_match' | 'explicit_code';
    window: string | null;
    state_scoped: boolean;
    requested_state: string | null;
    /** Measurement terms that recovered the market — evidence, not a rename. */
    identity_resolved_via: string[] | null;
  } | null;
  /**
   * The bridge: how we got from the literal keyword to the reported market.
   * Null for a NAICS/agency report, where there is no keyword to bridge from.
   */
  size_tiers: MarketSizeTier[] | null;
  /**
   * Set when the market's own vocabulary does NOT contain the keyword — the total
   * is a floor and the report says so, rather than implying precision it lacks.
   */
  undercount_note: string | null;
  naics_count: number | null;
  top_psc: { code: string; name: string } | null;
  buying_agencies: number;
  top_contractors: number;
  /** Rows SHOWN (after identity dedupe). */
  recompetes: number;
  forecasts: number;
  contacts: number;
  /**
   * The population the shown rows were drawn from — null when the source states no
   * count (unknown, never zero). A KPI prints "15 shown of N", never the display cap
   * as if it were the market's count.
   */
  recompetes_total?: number | null;
  /** Source forecast RECORDS matched (can include cross-listed copies). */
  forecasts_total?: number | null;
  /** Cross-listed forecast copies removed from the shown rows. */
  forecasts_duplicates_removed?: number;
}

/** "Who to call" — the market's #1 buying agency, its office, and real contacts. */
export interface MarketReportContacts {
  /** The agency the contacts belong to (the report's top buyer, or the saved agency). */
  agency: string;
  /** The buying office the roster is anchored on, when one is identifiable. */
  office: string | null;
  /** A few real, emailable POCs (CO / small-business / specialists). */
  people: Array<{ name: string; role: string; email: string; office: string | null }>;
  /** Total matched (before the display cap) so truncation is explicit. */
  total: number;
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
    /** Total buying agencies with spend BEFORE the top-10 display cap — so the
     *  truncation is explicit, not a silent .slice(). Equals top_agencies.length
     *  when nothing was cut. */
    top_agencies_total: number;
    competition: { contractors: unknown[]; count: number };
    recompetes: { contracts: unknown[]; count: number };
    forecasts: { forecasts: unknown[]; count: number };
    /** Who to call — the market's #1 buyer's office + a few real contacts. */
    contacts: MarketReportContacts | null;
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
  _meta: {
    grounded: boolean;
    degraded: boolean;
    sections_grounded: number;
    sections_total: number;
    saved: boolean;
    /** True when the report was too thin to publish as a client-facing artifact. */
    deliverable_withheld?: boolean;
    /**
     * Why the deliverable did or did not publish:
     *   publish              — required evidence ok + adequate grounding
     *   insufficient_evidence— required evidence succeeded but the market is thin
     *   measurement_failure  — the REQUIRED measurement failed; market UNKNOWN
     */
    publication_state?: 'publish' | 'insufficient_evidence' | 'measurement_failure';
    /** Per-section outcome so a missing section states WHY it is missing. */
    section_status?: { name: string; status: SectionStatus; required: boolean }[];
    /** Sections whose query FAILED — unknown, never an established zero. */
    sections_failed?: string[];
    /** Operator-readable diagnostic when the deliverable is withheld. */
    deliverable_withheld_reason?: string | null;
  };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
}

/** Settle a guarded section; a throw becomes { value:null, degraded:true } (never rejects). */
/**
 * Guard a section AND record which of the three things happened.
 *
 * `degraded` is kept for back-compat with existing readers, but it is now
 * DERIVED from `status === 'failed'` rather than being the only signal. The
 * status is what downstream logic must branch on: a failed section is UNKNOWN,
 * a successful-empty section is an established zero, and collapsing the two is
 * the P2 defect (see section-outcome.ts).
 */
async function guard<T>(
  p: Promise<T>,
  hasEvidence?: (v: T) => boolean,
): Promise<{ value: T | null; degraded: boolean; status: SectionStatus; outcome: SectionOutcome<T> }> {
  // A tool that CATCHES its own upstream error returns `_meta.degraded:true` with an
  // empty list rather than throwing. Resolving that as success made a failed forecast
  // or recompete query read as "empty" — an established zero. Re-raise it so the
  // section is reported as failed (unknown).
  const outcome = await runSection(
    p.then((v) => {
      if ((v as { _meta?: { degraded?: boolean } } | null)?._meta?.degraded === true) {
        throw new Error('upstream reported degraded');
      }
      return v;
    }),
    hasEvidence,
  );
  if (outcome.status === 'failed') {
    console.error('[mcp:generate_market_report] section failed:', outcome.failure?.message);
  }
  return { value: outcome.value, degraded: isFailed(outcome), status: outcome.status, outcome };
}

/**
 * Fetch a spending_by_category aggregation across the UNION of several filter sets and
 * merge by name (summing amounts). USASpending ANDs its filters, so a market that is
 * "518210 OR DJ01/DJ10" (Cybersecurity = hosting OR security work) CANNOT be one query —
 * it must be one query per set, merged. With a single set this is identical to a plain
 * fetchSpendingCategory. Re-sorts by amount desc and caps at `limit`.
 */
async function unionSpendingCategory(
  category: 'awarding_subagency' | 'recipient',
  filterSets: Record<string, unknown>[],
  limit: number,
): Promise<{ name: string; amount: number; uei?: string | null }[]> {
  // strict: a USAspending failure must surface as a FAILED section, not as an
  // empty table (the default swallows it into []).
  const strict = { strict: true };
  if (filterSets.length === 1) {
    return (await fetchSpendingCategory(category, filterSets[0], limit, 'market-report', strict)).map((r) => ({
      name: r.name,
      amount: r.amount,
      uei: r.uei ?? null,
    }));
  }
  // Fetch each set with extra headroom so the merged top-N is accurate (a firm ranked
  // #12 in one set + #14 in the other can be top-10 combined).
  const perSet = await Promise.all(
    filterSets.map((f) => fetchSpendingCategory(category, f, limit * 2, 'market-report', strict)),
  );
  // Merge on UEI when present (the entity), else on name — so two registrations that
  // share a legal name stay two rows, and one entity found in both sets sums.
  const merged = new Map<string, { name: string; amount: number; uei: string | null }>();
  for (const rows of perSet) {
    for (const r of rows) {
      if (!r.name || !(r.amount > 0)) continue;
      const key = r.uei ? `uei:${r.uei}` : `name:${r.name}`;
      const prev = merged.get(key);
      merged.set(key, { name: r.name, amount: (prev?.amount || 0) + r.amount, uei: r.uei ?? null });
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export async function generateMarketReport(input: MarketReportInput): Promise<MarketReportResult> {
  const keyword = (input.keyword || '').trim();
  const naicsIn = (input.naics || '').trim();
  // A saved search's FULL code set — parse the comma list into exact 6-digit codes and
  // measure their UNION as one market (never pick one for the user, Eric 2026-08-02).
  const naicsCodes = naicsIn
    .split(',').map((c) => c.trim()).filter((c) => /^[0-9]{6}$/.test(c));
  // A PSC-defined market (Cybersecurity: DJ01/DJ10). resolveMarketScope ranks ONE PSC, so
  // use the first — the security-support code is the anchor; DJ10 (auditing) is the tail.
  const pscIn = (input.psc || '').trim().split(',').map((c) => c.trim()).filter(Boolean)[0] || '';
  // Normalize a short saved-search agency code ("DEFENSE") to the full toptier name
  // USASpending needs ("Department of Defense") — else the agency filter matches nothing.
  const agency = normalizeAgencyToToptier(input.agency || '');
  const state = (input.state && normalizeStateCode(input.state)) || undefined;
  const setAside = (input.set_aside || '').trim() || undefined;
  const setAsideCodes = setAsideToUsaspendingCodes(setAside);
  // The saved-search scoping threaded onto every $ section so agencies + contractors
  // reconcile (same filters, same source).
  const scopeExtra = { agency: agency || undefined, setAsideCodes };

  // PSC is the defining signal when present (Cybersecurity: the security PSC IS the
  // market, even alongside a NAICS like 518210 hosting) — so it leads the subject/axis,
  // matching what resolveMarketScope actually ranks by (it prefers pscCode over the NAICS
  // list). Keeps the displayed label honest with the query.
  const axis: 'keyword' | 'naics' | 'agency' = keyword ? 'keyword' : pscIn ? 'agency' : naicsCodes.length ? 'naics' : 'agency';
  const subject = keyword
    || (pscIn ? `PSC ${input.psc}` : '')
    || (naicsCodes.length === 1 ? naicsCodes[0] : naicsCodes.length ? `${naicsCodes.length} NAICS codes` : '')
    || agency || 'the federal market';

  // Market size first (keyword mode needs the coverage NAICS set to drive the rest).
  // For a NAICS list, codeMarketSize measures the FIRST code as a size reference; the
  // authoritative union total comes from the agencies query below (sum of buyers).
  //
  // ── REQUIRED EVIDENCE ────────────────────────────────────────────────────
  // This is the measurement that ESTABLISHES THE MARKET. Derived from the
  // report contract, not from convenience: `summary.total_market` is fed by
  // dominantSize ?? coverage ?? marketSize, and every other section is an
  // attribute OF that market (who buys it, who holds it, what recompetes).
  // Without it the report has no subject — so its FAILURE must withhold the
  // deliverable, while a legitimate empty result is a different answer that
  // the existing evidence bar already handles.
  const coverageOutcome: SectionOutcome<Awaited<ReturnType<typeof keywordCoverage>>> = keyword
    ? await runSection(keywordCoverage(keyword), (c) => !!c && (c.totalMarket ?? 0) > 0)
    : { status: 'empty', value: null };
  const coverage = coverageOutcome.value;
  const codeSizeOutcome: SectionOutcome<Awaited<ReturnType<typeof codeMarketSize>>> =
    !keyword && naicsCodes.length
      ? await runSection(codeMarketSize({ naics: naicsCodes[0] }), (m) => !!m && (m.totalMarket ?? 0) > 0)
      : { status: 'empty', value: null };
  const marketSize = keyword ? coverage : codeSizeOutcome.value;
  /** The outcome of the REQUIRED market measurement for THIS report's axis. */
  const requiredMeasurement: SectionOutcome<unknown> = keyword ? coverageOutcome : codeSizeOutcome;

  // Resolve the market scope through the SHARED decision (src/lib/market/spend-query),
  // so this report's "Who is buying" is the IDENTICAL query the in-app FPDS
  // leaderboards run. Computing our own answer here is how TMR and the leaderboards
  // drifted until their totals couldn't be reconciled (PR #245) — a client-facing
  // report that disagrees with our own panel is indefensible. A NAICS list scopes to
  // the UNION of all codes (the saved search's full market).
  const scope = keyword || naicsCodes.length || pscIn
    ? (await guard(resolveMarketScope({ keyword, naicsCodes, pscCode: pscIn || undefined, coverage }))).value
    : null;

  /**
   * Headline and sections must share ONE basis or the report contradicts itself
   * (measured on "roofing": a $578M keyword total above a "Who is buying" table
   * summing past $1.1B — all of 238160).
   *
   * They are now reconciled by SCOPE rather than by re-basing the headline.
   * Coverage lead NAICS % is measurement, not identity — keyword scopes stay
   * keyword-ranked (`rankedByDominantNaics` is false). This re-measure remains
   * ONLY for an explicit NAICS list with no market filter.
   */
  const dominantSize = scope?.rankedByDominantNaics && scope.naicsCodes[0]
    ? (await guard(codeMarketSize({ naics: scope.naicsCodes[0] }))).value
    : null;

  // Forecasts/recompetes may use an operator-supplied NAICS list. Coverage dollar-lead
  // is measurement, not identity — do not pin those sections to allNaics[0].
  const primaryNaics = naicsCodes[0] || undefined;

  // The FULL scoped filter set (NAICS union + agency + set-aside + state) — shared by the
  // agencies AND contractors sections so their dollars reconcile (same filters, same
  // USASpending source). This is what makes the report a faithful readout of the search.
  const scopedFilters = scope ? filtersForScope(scope, state, scopeExtra) : null;

  // UNION filter sets for a market that is "A OR B" (Cybersecurity = NAICS 518210 hosting
  // OR PSC DJ01/DJ10 security). USASpending ANDs its filters, so this can't be one query —
  // the agencies/contractors sections run each set + merge (unionSpendingCategory). When
  // the resolved scope ranked by PSC (pscIn present) AND the search ALSO carried a NAICS
  // union, we build BOTH sets so the report covers the whole cyber market, not just one
  // axis. Otherwise it's the single scopedFilters set (identical behavior for everyone else).
  const scopedFilterSets: Record<string, unknown>[] = (() => {
    if (!scopedFilters) return [];
    if (pscIn && naicsCodes.length) {
      const naicsScope = { basis: 'naics' as const, marketFilter: null, naicsCodes, coverage: null, rankedByDominantNaics: false, label: '' };
      return [scopedFilters, filtersForScope(naicsScope, state, scopeExtra)];
    }
    return [scopedFilters];
  })();
  const isUnion = scopedFilterSets.length > 1;

  // Fan out the remaining sections in parallel — each independently guarded.
  const [agenciesR, competitionR, recompetesR, forecastsR, agencyDetailR, sbaR] = await Promise.all([
    scopedFilterSets.length
      ? guard(unionSpendingCategory('awarding_subagency', scopedFilterSets, 10), (rows) => rows.some((r) => r.amount > 0))
      : Promise.resolve({ value: null, degraded: false, status: 'empty' as SectionStatus, outcome: { status: 'empty' as SectionStatus, value: null } }),
    // Leading contractors from the SAME scoped filter set(s) (USASpending recipient
    // category), so they're the top firms in the exact market — and reconcile with
    // agencies. Unions across the filter sets for a "A OR B" market (Cyber).
    scopedFilterSets.length
      ? guard(
          unionSpendingCategory('recipient', scopedFilterSets, 15).then((rows) => ({
            contractors: rows.map((r) => ({ recipient_name: r.name, recipient_uei: r.uei ?? null, total_obligated: r.amount })),
          })),
          (v) => v.contractors.length > 0,
        )
      : Promise.resolve({ value: null, degraded: false, status: 'empty' as SectionStatus, outcome: { status: 'empty' as SectionStatus, value: null } }),
    // Recompetes honor the FULL NAICS union + agency (queryExpiringContracts takes a list).
    //
    // ⚠️ RC-2 (2026-09-22): on the KEYWORD axis `resolveMarketScope` returns
    // basis='keyword' with naicsCodes=[], so this call used to receive NO subject
    // filter at all and returned the global head of recompete_opportunities. A
    // "drones" report and a "building construction and renovation" report both
    // returned the SAME 15 rows — dental equipment (339114), bullion/nonferrous
    // (331491), textiles (314910). Unrelated recompetes in a branded report read
    // as the market's real recompetes, so they are worse than none.
    //
    // The defensible subject boundary on the keyword axis is the keyword's own
    // measured buying NAICS (`coverage.allNaics` — the same set the coverage
    // banner reports). When neither axis yields one, we return NO recompetes
    // rather than unrelated ones.
    (() => {
      const subjectNaics = naicsCodes.length
        ? naicsCodes
        // Use the ~90% COVERAGE SET, not the full measured tail. The tail of a
        // multi-trade family carries long-tail noise — a construction family
        // measures 187 NAICS, of which 314910 textiles (0.004%) and 339112/339113
        // surgical (0.002%/0.007%) are rounding error. Filtering recompetes on
        // the whole tail put those back on the page, which is exactly the
        // off-subject defect the P0 lock exists to prevent. coverageCodes is the
        // smallest set covering ~90% of the measured market — 14 clean
        // construction codes here — so it is the defensible subject boundary.
        : (coverage?.coverageCodes?.length
            ? coverage.coverageCodes
            : (coverage?.allNaics ?? []).map((n) => n.code)
          ).filter(Boolean);
      if (!subjectNaics.length && !primaryNaics) {
        // No defensible subject filter exists → withhold the section.
        return Promise.resolve({
          value: { contracts: [] as Array<Record<string, unknown>>, count: 0, withheld_reason: 'no_subject_naics', _meta: { total: 0 } },
          degraded: false,
          status: 'withheld_no_subject' as SectionStatus,
          outcome: { status: 'withheld_no_subject' as SectionStatus, value: null },
        });
      }
      return guard(expiringContracts({
        naicsCodes: subjectNaics.length ? subjectNaics : undefined,
        naics: subjectNaics.length ? undefined : primaryNaics,
        agency: agency || undefined,
        state,
        limit: 15,
      }), (v) => (v.contracts?.length ?? 0) > 0);
    })(),
    // Forecasts honor the FULL NAICS UNION (queryForecasts splits a comma list), NOT one code —
    // a DOD-IT search of 4 codes was reading only the first (541511) and missing 541519's 2,668
    // rows. And NO toptier agency filter: agency_forecasts.source_agency is stored as SHORT CODES
    // (NAVY / USACE / DOD / GSA…), so passing the toptier name "Department of Defense" matched
    // NOTHING and zeroed the section (Eric 2026-08-02: "the market report shows no forecast?").
    // NAICS scope is the right market for forecasts; the saved-search agency was a $-section
    // narrowing the forecast table can't honor by name anyway.
    guard(agencyForecasts({ keyword: keyword || undefined, naics: naicsCodes.length ? naicsCodes.join(',') : primaryNaics, state, set_aside: setAside, limit: 15 }), (v) => (v.forecasts?.length ?? 0) > 0),
    agency ? guard(getAgencySpendingDetailTool({ agency }), (v) => v._meta?.grounded === true) : Promise.resolve({ value: null, degraded: false, status: 'empty' as SectionStatus, outcome: { status: 'empty' as SectionStatus, value: null } }),
    agency ? guard(getSbaGoalingShare({ agency }), (v) => v._meta?.grounded === true) : Promise.resolve({ value: null, degraded: false, status: 'empty' as SectionStatus, outcome: { status: 'empty' as SectionStatus, value: null } }),
  ]);

  const agenciesWithSpend: TopAgency[] = Array.isArray(agenciesR.value)
    ? (agenciesR.value as TopAgency[]).filter((a) => a.amount > 0)
    : [];
  const TOP_AGENCIES_CAP = 10;
  const topAgencies = agenciesWithSpend.slice(0, TOP_AGENCIES_CAP);

  const contractors = competitionR.value?.contractors ?? [];
  // LIST — one row per customer-visible record, labelled for what it is.
  const contracts = dedupeRecompetes((recompetesR.value?.contracts ?? []) as Array<Record<string, unknown>>).map((c) => presentRecompete(c));
  const forecastDedupe = dedupeForecasts(forecastsR.value?.forecasts ?? []);
  const forecasts = forecastDedupe.rows.map((f) => ({
    ...f,
    // A category the reader can act on, or null ("not stated"). The source value is
    // kept beside it so nothing is hidden — it is just no longer presented AS a category.
    set_aside_type: normalizeForecastSetAside(f.set_aside_type),
    set_aside_source_value: f.set_aside_type ?? null,
  }));
  /**
   * COUNT — the population each list was drawn from, when the source can state it.
   * The table shows at most 15 rows; the KPI used to print that display cap as if it
   * were the market's number of recompetes. null = the source gave no count (unknown,
   * never zero). The forecast total is the source's record count, which can include
   * the cross-listed copies removed above — so it is labelled "records", not listings.
   */
  const recompetesTotal: number | null =
    recompetesR.status === 'ok' ? (recompetesR.value?._meta?.total ?? null) : recompetesR.status === 'empty' ? 0 : null;
  const forecastsTotal: number | null =
    forecastsR.status === 'ok' ? (forecastsR.value?._meta?.total ?? null) : forecastsR.status === 'empty' ? 0 : null;

  // WHO TO CALL — the market's buyer, its office, and a few real, emailable POCs. Anchor
  // on the saved AGENCY filter when present (that's the department the user scoped to);
  // otherwise the report's #1 buying sub-agency. Needs the agencies result, so it runs
  // after the fan-out (a small serial cost). Grounded: only emailable rows, never invented.
  const contactAgency = agency || topAgencies[0]?.name || '';
  const CONTACTS_CAP = 6;
  let contactsSection: MarketReportContacts | null = null;
  if (contactAgency) {
    const roster = (await guard(queryFederalContacts({ agency: contactAgency, limit: CONTACTS_CAP * 3 }))).value;
    const people = (roster?.contacts ?? [])
      .filter((c) => (c.contact_email || '').includes('@'))
      .map((c) => ({
        // The roster appends phone/DSN junk to the name on 12.8% of rows ("Stephen
        // Weaver6142923131", "Natalya RadykDSN312-850-4033"). This cleaner used to live ONLY
        // here, so the report showed clean names while every other surface showed the raw
        // pollution. It is now the shared contract.
        name: displayContactName(c.contact_fullname) || '',
        role: c.role_category_label || c.contact_title || c.role || '',
        email: c.contact_email || '',
        office: c.derived_office || c.sub_agency || null,
      }))
      .filter((p) => p.name && p.email)
      .slice(0, CONTACTS_CAP);
    if (people.length) {
      contactsSection = {
        agency: contactAgency,
        office: people[0].office,
        people,
        total: roster?.total ?? people.length,
      };
    }
  }

  /**
   * THE BRIDGE (Eric, 2026-08-15). A keyword market has three honest readings and the
   * report used to show one, unlabeled — so a $46.3B hypersonics headline could not be
   * reconciled with its own supporting tables. Compute all three, name each derivation,
   * and let the reader audit the jump.
   *
   * code_total is measured but deliberately framed as a CEILING: it is the surrounding
   * industry (332993 is bombs and ammunition), not this market. It exists so the reader
   * can see the gap the keyword leaves, never to be quoted as the market size.
   */
  const sizeTiers: MarketSizeTier[] | null = await (async () => {
    if (!keyword || !coverage) return null;
    const expanded = marketKeywords(keyword);
    // Do not treat coverage.allNaics[0] as the surrounding industry. That is Senses /
    // identity. Size tiers stay on the keyword measurements.

    /**
     * Both keyword tiers MUST be measured the same way or the ladder is nonsense.
     *
     * coverage.totalMarket is NOT usable here: it is the sum of the top-N NAICS rows
     * the coverage step happened to return (16 codes, $585M for hypersonics), which is
     * a truncated breakdown, not a market total. Comparing it to a full agency-category
     * sum produced a NEGATIVE expansion delta — the expanded market appearing SMALLER
     * than the literal one — which is exactly the "numbers don't reconcile" failure
     * this bridge exists to end.
     *
     * So measure both tiers with the same call, same category, same depth: literal
     * keyword vs expanded keyword set. Apples to apples, hypersonics reads
     * $1.63B → $1.75B (+$110.7M from the expansion).
     */
    const tierTotal = async (kws: string[], tag: string) => (await guard(
      fetchSpendingCategory('awarding_subagency', buildSpendingFilters({ marketFilter: { keywords: kws, mode: 'keyword', rankingLabel: '' } }), 100, tag, { strict: true })
        .then((rows) => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
    )).value;

    const literalOnly = await tierTotal([keyword], 'tier-named');
    const expandedTotal = expanded.length > 1 ? await tierTotal(expanded, 'tier-expanded') : literalOnly;

    const hasSynonyms = expanded.length > 1;
    // What resolved the headline when the literal phrase is not how the work is written.
    const resolvedVia = coverage.identityResolvedVia?.length ? coverage.identityResolvedVia : null;
    const namedNote = literalOnly === 0
      ? resolvedVia
        ? `$0 means no contract award text contains this exact phrase — NOT that the market is $0. The headline total was measured from the words this work is actually written in: ${resolvedVia.join(', ')}.`
        : `$0 means no contract award text contains this exact phrase over FY23-25 — the phrase itself, not necessarily the market.`
      : literalOnly == null
        ? 'This reading did not complete (upstream error) — unknown, not zero.'
        : hasSynonyms
          ? 'Floor only: the literal word. Shown so the jump to the next reading can be audited.'
          : 'This literal-phrase reading is what the agency and contractor tables below are ranked on (FY23-25). The headline total is a different measurement (see its label).';

    const tiers: MarketSizeTier[] = [{
      basis: 'named',
      label: `Awards that say "${keyword}"`,
      amount: literalOnly ?? null,
      method: `USASpending award text contains "${keyword}" (FY23-25, contract awards). A FLOOR — classified, component-level and indirectly-titled work never says the name.`,
      inputs: [keyword],
      // With no synonyms the sections are ranked on this very phrase.
      role: hasSynonyms ? 'floor' : 'sections_basis',
      note: namedNote,
    }];

    if (hasSynonyms) {
      tiers.push({
        basis: 'term_of_art',
        label: 'Plus the words this market is actually bought under',
        amount: expandedTotal ?? null,
        // WAS: "This is the market the report measures." It is the basis of the agency
        // and contractor tables — but the HEADLINE is a separate 1-FY description-match
        // measurement (drones: $90.0M headline vs $11.0B here). Say which is which.
        method: `Adds ${expanded.length - 1} curated term-of-art synonyms, each verified against live USASpending before inclusion (FY23-25, contract awards).`,
        inputs: expanded,
        role: 'sections_basis',
        note: expandedTotal == null
          ? 'This reading did not complete (upstream error) — unknown, not zero.'
          : 'The agency and contractor tables below are ranked on this term set over FY23-25. The headline total is a narrower 1-fiscal-year measurement (see its label), so the two figures differ by design.',
      });
    }

    return tiers;
  })();

  // Honest-gap note: the market's own vocabulary doesn't contain the keyword, so the
  // literal total is a floor. Names the words buyers DO use, which is both the reader's
  // context and the curation shortlist.
  const undercount = keyword
    ? await detectUndercount(keyword, null).catch(() => null)
    : null;
  const undercountNote = undercount?.undercounts
    ? `Contracts in this market rarely use the word "${keyword}" — its lead code's vocabulary reads: ${undercount.marketVocabulary.slice(0, 6).join(', ')}. Treat the total as a floor and search these terms too.`
    : null;

  /**
   * RC-5 (2026-09-22) — WHAT the headline number measures.
   *
   * Two independent measurements were presented as interchangeable totals.
   * Traced on d80cad92:
   *   MA / 236220 -> headline $30.6B (codeMarketSize, 1 FY, NATIONAL) vs
   *                  sections   $851.3M (spend-query, 3 FY, MA-scoped)
   *   drones      -> headline $90.0M (keywordCoverage, 1 FY, literal term) vs
   *                  sections   $10.3B (spend-query, 3 FY, +6 synonyms)
   * The gap is never one bug: PERIOD, TERM SET and GEOGRAPHY all differ. A
   * customer seeing both figures without labels reads a contradiction.
   */
  const totalMarketBasis = (() => {
    const source = dominantSize?.totalMarket
      ? ('lead_naics_code' as const)
      : coverage?.totalMarket
        ? ('keyword_description_match' as const)
        : marketSize
          ? ('explicit_code' as const)
          : null;
    if (!source) return null;
    return {
      source,
      /** Measurement window for THIS number — not the sections' window. */
      window: coverage?.windowLabel
        ?? (dominantSize && 'windowLabel' in dominantSize ? dominantSize.windowLabel : null)
        ?? (marketSize && 'windowLabel' in marketSize ? (marketSize as { windowLabel?: string }).windowLabel ?? null : null),
      /**
       * The headline measurements are NATIONAL; the sections honour `state`.
       * That asymmetry is the entire MA/236220 discrepancy, so state it.
       */
      state_scoped: false,
      requested_state: state ?? null,
      /** What resolved identity when the literal phrase measured nothing (RC-1). */
      identity_resolved_via: coverage?.identityResolvedVia ?? null,
    };
  })();


  const summary: MarketReportSummary = {
    subject,
    axis,
    size_tiers: sizeTiers,
    undercount_note: undercountNote,
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
    contacts: contactsSection?.people.length ?? 0,
    recompetes_total: recompetesTotal,
    forecasts_total: forecastsTotal,
    forecasts_duplicates_removed: forecastDedupe.removed,
    total_market_basis: totalMarketBasis,
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
    top_agencies_total: agenciesWithSpend.length,
    competition: { contractors, count: contractors.length },
    recompetes: { contracts, count: contracts.length },
    forecasts: { forecasts, count: forecasts.length },
    contacts: contactsSection,
    agency_detail: agencyDetailR.value ?? null,
    set_aside_gap: sbaR.value ?? null,
  };

  // A section is "grounded" ONLY when it returned usable evidence. A FAILED
  // section is unknown — it must never be counted, and must never be reported
  // as an established zero.
  const sectionStatuses: { name: string; status: SectionStatus; required: boolean }[] = [
    // REQUIRED: the measurement that establishes the market itself.
    {
      name: 'market_measurement',
      status: summary.total_market ? 'ok' : requiredMeasurement.status,
      required: true,
    },
    // OPTIONAL enrichment: attributes OF the market, not the market itself.
    { name: 'top_agencies', status: agenciesR.status, required: false },
    { name: 'competition', status: competitionR.status, required: false },
    { name: 'recompetes', status: recompetesR.status, required: false },
    { name: 'forecasts', status: forecastsR.status, required: false },
    { name: 'agency_detail', status: agencyDetailR.status, required: false },
    { name: 'sba_goaling', status: sbaR.status, required: false },
  ];
  /**
   * ONE definition of grounded: a section whose status is `ok`. This used to be a
   * second, parallel list of truthiness flags, and the two disagreed — construction
   * reported `sections_grounded: 2/7` beside FOUR `ok` statuses, because `guard()`
   * classified any returned OBJECT as `ok` (a `{ contractors: [] }` wrapper included)
   * while the flags counted rows. Each section now states its own evidence predicate
   * in `guard(..., hasEvidence)`, and the count is derived from the statuses, so the
   * two cannot drift again.
   */
  const sectionsGrounded = sectionStatuses.filter((x) => x.status === 'ok').length;
  const sectionsTotal = sectionStatuses.length;
  const sectionsFailed = sectionStatuses.filter((x) => x.status === 'failed').map((x) => x.name);
  /** The REQUIRED measurement failed — the market itself is unknown. */
  const requiredFailed = !summary.total_market && requiredMeasurement.status === 'failed';

  /**
   * RC-4 (2026-09-22) — a degraded report may not become a branded deliverable.
   *
   * Ports the refusal principle already working in capability_market_match: below
   * the evidence bar the artifact is WITHHELD and a diagnostic is returned, because
   * a Mindy-branded page a customer forwards to their client reads as a researched
   * answer regardless of how thin it is. A one-section report is a diagnostic, not
   * a market report.
   *
   * The bar is the MARKET TOTAL plus at least one more grounded section. The total
   * is required specifically because every other section is a list that can be
   * plausibly empty, while a report whose headline dollar figure is unknown has no
   * subject at all. Measured: the known construction case grounds 1/7 (withheld);
   * the drones case grounds 5/7 (published).
   */
  const MIN_GROUNDED_SECTIONS = 2;

  /**
   * P2 — publication is STATE-AWARE, not a single boolean.
   *
   *   required ok + adequate grounding      -> publish
   *   required ok but empty/insufficient    -> withhold: insufficient_evidence
   *   required FAILED                       -> withhold: measurement_failure
   *   optional failed, core still defensible-> may publish (statuses retained)
   *
   * The third case is the one this exists for. Before, a required-measurement
   * TIMEOUT scored the same as a thin market, cleared the bar on whatever other
   * sections happened to return, and minted a NEW permanent share URL (ids are
   * random) holding a materially thinner answer that looked complete. Two
   * identical requests could therefore produce two different client artifacts.
   */
  const publicationState: 'publish' | 'insufficient_evidence' | 'measurement_failure' = requiredFailed
    ? 'measurement_failure'
    : !!summary.total_market && sectionsGrounded >= MIN_GROUNDED_SECTIONS
      ? 'publish'
      : 'insufficient_evidence';
  const deliverableWorthy = publicationState === 'publish';
  const degraded = [coverage === null && keyword !== '', agenciesR.degraded, competitionR.degraded, recompetesR.degraded, forecastsR.degraded, agencyDetailR.degraded, sbaR.degraded].some(Boolean);

  const result: MarketReportResult = {
    subject,
    generated_for: input.client_name?.trim() || null,
    summary,
    basis,
    reconciliation,
    sections,
    deliverable: { html: '', url: null, report_id: null },
    _meta: {
      grounded: sectionsGrounded > 0,
      degraded,
      sections_grounded: sectionsGrounded,
      sections_total: sectionsTotal,
      saved: false,
      /** False when the report is too thin to be a client-facing artifact. */
      deliverable_withheld: !deliverableWorthy,
      /** publish | insufficient_evidence | measurement_failure */
      publication_state: publicationState,
      /** Per-section outcome — tells the caller WHY a section is missing. */
      section_status: sectionStatuses,
      /** Sections whose query FAILED (unknown, never an established zero). */
      sections_failed: sectionsFailed,
      deliverable_withheld_reason: deliverableWorthy
        ? null
        : requiredFailed
        ? 'The measurement that establishes this market did not complete (upstream timeout or error), ' +
          'so the market size is UNKNOWN — not zero. No report was published. Retry; do not treat this ' +
          'as evidence that the market is small.'
        : !summary.total_market
          ? `No market total could be established for "${subject}", so there is no subject to report on. ` +
            'Refine the keyword, or supply an explicit NAICS/PSC scope.'
          : `Only ${sectionsGrounded} of ${sectionsTotal} sections returned data — too thin to ` +
            'publish as a client-facing report. The structured sections below are still usable as a diagnostic.',
    },
  };

  // Client-ready deliverable (Mindy-branded, self-contained).
  result.deliverable.html = renderMarketReportHtml(result);

  // Persist → shareable link. Only for a verified caller, and only when we actually
  // found something (an empty report isn't a deliverable worth a client link).
  // Best-effort: a storage failure must not lose the report the caller paid for.
  if (input.userEmail && deliverableWorthy) {
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
