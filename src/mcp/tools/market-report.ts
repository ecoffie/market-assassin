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
}

export interface MarketReportSummary {
  subject: string;
  axis: 'keyword' | 'naics' | 'agency';
  total_market: number | null;
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
  recompetes: number;
  forecasts: number;
  contacts: number;
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
): Promise<{ name: string; amount: number }[]> {
  if (filterSets.length === 1) {
    return (await fetchSpendingCategory(category, filterSets[0], limit, 'market-report')).map((r) => ({
      name: r.name,
      amount: r.amount,
    }));
  }
  // Fetch each set with extra headroom so the merged top-N is accurate (a firm ranked
  // #12 in one set + #14 in the other can be top-10 combined).
  const perSet = await Promise.all(
    filterSets.map((f) => fetchSpendingCategory(category, f, limit * 2, 'market-report')),
  );
  const merged = new Map<string, number>();
  for (const rows of perSet) {
    for (const r of rows) {
      if (!r.name || !(r.amount > 0)) continue;
      merged.set(r.name, (merged.get(r.name) || 0) + r.amount);
    }
  }
  return [...merged.entries()]
    .map(([name, amount]) => ({ name, amount }))
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
  const coverage = keyword ? (await guard(keywordCoverage(keyword))).value : null;
  const marketSize = keyword
    ? coverage
    : naicsCodes.length
      ? (await guard(codeMarketSize({ naics: naicsCodes[0] }))).value
      : null;

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
   * They are now reconciled by SCOPE rather than by re-basing the headline. A dominant
   * keyword resolves to a 'keyword_naics' filter (keyword AND lead code), so the
   * sections stay inside the keyword market and `coverage.totalMarket` — the
   * keyword-scoped number — is already the right headline.
   *
   * This re-measure remains ONLY for the legacy fall-through where the scope carries a
   * bare NAICS list and no market filter (no lead code to pin). `scope.naicsCodes` is
   * empty on the keyword_naics path, so this evaluates to null there.
   */
  const dominantSize = scope?.rankedByDominantNaics && scope.naicsCodes[0]
    ? (await guard(codeMarketSize({ naics: scope.naicsCodes[0] }))).value
    : null;

  // The forecasts section is single-NAICS-keyed; use the market's lead code (the
  // semantically-right code after promotion — NOT necessarily the biggest).
  const primaryNaics = naicsCodes[0] || coverage?.allNaics?.[0]?.code || coverage?.coverageCodes?.[0] || undefined;

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
      ? guard(unionSpendingCategory('awarding_subagency', scopedFilterSets, 10))
      : Promise.resolve({ value: null, degraded: false }),
    // Leading contractors from the SAME scoped filter set(s) (USASpending recipient
    // category), so they're the top firms in the exact market — and reconcile with
    // agencies. Unions across the filter sets for a "A OR B" market (Cyber).
    scopedFilterSets.length
      ? guard(
          unionSpendingCategory('recipient', scopedFilterSets, 15).then((rows) => ({
            contractors: rows.map((r) => ({ recipient_name: r.name, total_obligated: r.amount })),
          })),
        )
      : Promise.resolve({ value: null, degraded: false }),
    // Recompetes honor the FULL NAICS union + agency (queryExpiringContracts takes a list).
    guard(expiringContracts({ naicsCodes: naicsCodes.length ? naicsCodes : undefined, naics: naicsCodes.length ? undefined : primaryNaics, agency: agency || undefined, state, limit: 15 })),
    // Forecasts honor the FULL NAICS UNION (queryForecasts splits a comma list), NOT one code —
    // a DOD-IT search of 4 codes was reading only the first (541511) and missing 541519's 2,668
    // rows. And NO toptier agency filter: agency_forecasts.source_agency is stored as SHORT CODES
    // (NAVY / USACE / DOD / GSA…), so passing the toptier name "Department of Defense" matched
    // NOTHING and zeroed the section (Eric 2026-08-02: "the market report shows no forecast?").
    // NAICS scope is the right market for forecasts; the saved-search agency was a $-section
    // narrowing the forecast table can't honor by name anyway.
    guard(agencyForecasts({ keyword: keyword || undefined, naics: naicsCodes.length ? naicsCodes.join(',') : primaryNaics, state, set_aside: setAside, limit: 15 })),
    agency ? guard(getAgencySpendingDetailTool({ agency })) : Promise.resolve({ value: null, degraded: false }),
    agency ? guard(getSbaGoalingShare({ agency })) : Promise.resolve({ value: null, degraded: false }),
  ]);

  const agenciesWithSpend: TopAgency[] = Array.isArray(agenciesR.value)
    ? (agenciesR.value as TopAgency[]).filter((a) => a.amount > 0)
    : [];
  const TOP_AGENCIES_CAP = 10;
  const topAgencies = agenciesWithSpend.slice(0, TOP_AGENCIES_CAP);

  const contractors = competitionR.value?.contractors ?? [];
  const contracts = recompetesR.value?.contracts ?? [];
  const forecasts = forecastsR.value?.forecasts ?? [];

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
        // The roster occasionally appends phone/DSN junk to the name (data quirk):
        // "Stephen Weaver6142923131", "Joseph WerstakDSN(...". Strip a trailing run of
        // digits/DSN and cut at the first digit or a bare "DSN".
        name: (c.contact_fullname || '')
          .replace(/\s*DSN.*$/i, '')
          .replace(/\d[\d\s().-]*$/, '')
          .trim(),
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
    const leadCode = coverage.allNaics?.[0]?.code || null;
    const codeTotal = leadCode ? (await guard(codeMarketSize({ naics: leadCode }))).value : null;

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
      fetchSpendingCategory('awarding_subagency', buildSpendingFilters({ marketFilter: { keywords: kws, mode: 'keyword', rankingLabel: '' } }), 100, tag)
        .then((rows) => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
    )).value;

    const literalOnly = await tierTotal([keyword], 'tier-named');
    const expandedTotal = expanded.length > 1 ? await tierTotal(expanded, 'tier-expanded') : literalOnly;

    const tiers: MarketSizeTier[] = [{
      basis: 'named',
      label: `Awards that say "${keyword}"`,
      amount: literalOnly ?? null,
      method: `USASpending award text contains "${keyword}" (FY23-25, contract awards). A FLOOR — classified, component-level and indirectly-titled work never says the name.`,
      inputs: [keyword],
    }];

    if (expanded.length > 1) {
      tiers.push({
        basis: 'term_of_art',
        label: 'Plus the words this market is actually bought under',
        // Sections measure this same expanded set — this IS the reported market.
        amount: expandedTotal ?? null,
        method: `Adds ${expanded.length - 1} curated term-of-art synonyms, each verified against live USASpending before inclusion. This is the market the report measures.`,
        inputs: expanded,
      });
    }

    if (codeTotal && leadCode) {
      const codeName = coverage.allNaics?.[0]?.name || leadCode;
      tiers.push({
        basis: 'code_total',
        label: `All of NAICS ${leadCode}`,
        amount: codeTotal.totalMarket ?? null,
        method: `Everything bought under ${codeName} — the surrounding industry, of which this market is a slice. A CEILING for context, NOT the market size.`,
        inputs: [leadCode],
      });
    }
    return tiers;
  })();

  // Honest-gap note: the market's own vocabulary doesn't contain the keyword, so the
  // literal total is a floor. Names the words buyers DO use, which is both the reader's
  // context and the curation shortlist.
  const undercount = keyword
    ? await detectUndercount(keyword, coverage?.allNaics?.[0]?.code || null).catch(() => null)
    : null;
  const undercountNote = undercount?.undercounts
    ? `Contracts in this market rarely use the word "${keyword}" — its lead code's vocabulary reads: ${undercount.marketVocabulary.slice(0, 6).join(', ')}. Treat the total as a floor and search these terms too.`
    : null;

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
