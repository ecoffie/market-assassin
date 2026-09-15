/**
 * MCP tool: capability_market_match — "where do I actually fit?"
 *
 * Combination tool #1. Turns a company's OWN words into a complete addressable-market
 * read in ONE call, by chaining existing atomic tools:
 *   derive_company_keywords → rank capability anchor → keyword-coverage →
 *   (market vocabulary · NAICS-scoped competitors · forecasts · recompetes).
 *
 * No new data engine — it orchestrates pure fns, each GUARDED (honest-miss: a failed
 * section degrades to empty, never fabricates). `_meta` always ships. Credits are
 * charged by the transport (runMeteredTool).
 *
 * Budget (P1): CAPABILITY_MARKET_MATCH_BUDGET_MS soft wall. keywordCoverage gets
 * AbortSignal; optional enrichment is wrapped in guardedWithDeadline so a hung
 * downstream call cannot burn the remaining Vercel window. Core market grounded
 * ⇒ full price; coverage timeout ⇒ degraded+!grounded ⇒ DEFECT-7 uncharged.
 */
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
import { keywordCoverage, CoverageDeadlineError, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { getVocabulary } from '@/lib/market/vocabulary';
import { termOfArtSynonyms } from '@/lib/market/sector-expansions';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { topRecipientsByPsc } from '@/lib/usaspending/psc-recipients';
import type { RecipientSearchRow as RecipientRow } from '@/lib/bigquery/recipients';
import {
  pickBestAnchor,
  pickLeadKeyword,
  pickLeadNaicsFromCoverage,
  validateMarketAnchor,
  resolveLeadNaicsWithEvidence,
  type AnchorConfidence,
  type EntityIdentityStatus,
} from '@/lib/market/capability-anchor';
import { loadAnchorEvidence } from '@/lib/market/capability-anchor-evidence';
import {
  filterCompetitorsFabricatedRelevance,
  describeCompetitorDerivation,
  type CompetitorDerivation,
} from '@/lib/market/capability-competitors';

export { pickLeadKeyword, pickBestAnchor };

export type CapabilitySectionName =
  | 'buyer_vocabulary'
  | 'competitors'
  | 'forecasts'
  | 'recompetes';

export interface CapabilityMarketMatchInput {
  description?: string;
  past_performance?: string[];
  capabilities?: string[];
  client_name?: string;
  userEmail?: string;
}

export interface CapabilityMarketMatchResult {
  subject: string;
  keywords: string[];
  market: {
    lead_keyword: string;
    /** Null unless the anchor is corroborated — an unverified TAM is a guess with a dollar sign. */
    total_market: number | null;
    naics_count: number;
    /** Populated only when the market is verified. Otherwise see `candidate_naics`. */
    top_naics: KeywordCoverage['allNaics'];
    /** Keyword-derived codes when nothing corroborates them. Never a selected market. */
    candidate_naics: KeywordCoverage['allNaics'] | null;
    naics_status: 'verified' | 'unverified';
    top_psc: KeywordCoverage['topPscList'];
    single_code_share_pct: number;
  } | null;
  buyer_vocabulary: string[];
  competitors: unknown[];
  upcoming_forecasts: unknown[];
  recompete_opportunities: unknown[];
  _meta: {
    grounded: boolean;
    degraded: boolean;
    /** Machine reason when degraded — e.g. deadline_exceeded. Timed-out ≠ no market. */
    degraded_reason?: 'deadline_exceeded' | 'section_failed';
    /** Optional enrichment skipped for time — does NOT flip degraded / does NOT cut price. */
    sections_omitted?: CapabilitySectionName[];
    /** Optional enrichment that threw — does NOT flip degraded for core billing. */
    sections_failed?: CapabilitySectionName[];
    anchor_verified?: boolean;
    anchor_confidence?: AnchorConfidence;
    anchor_note?: string;
    lead_keyword: string | null;
    lead_naics: string | null;
    selected_anchor?: string | null;
    tam_verified?: boolean;
    competitor_derivation?: CompetitorDerivation;
    evidence?: {
      identity: EntityIdentityStatus;
      identity_uei: string | null;
      identity_candidates: number;
      sam_naics: string[];
      award_naics: string[];
      award_obligated_usd: number | null;
      sources: ('sam_entities' | 'contractor_history')[];
    };
    sections: Record<
      'keywords' | 'top_naics' | 'top_psc' | 'buyer_vocabulary' | 'competitors' | 'forecasts' | 'recompetes',
      { shown: number; available: number }
    >;
    elapsed_ms: number;
    note?: string;
  };
}

/** Soft wall for the whole tool — under MCP maxDuration 60s.
 * Measured 2026-09-15 on preview: get_keyword_coverage('drones') alone ≈29s cold.
 * 22s made every representative call deadline_exceeded. 48s leaves ~12s for
 * transport + optional enrichment after a slow coverage. */
export const CAPABILITY_MARKET_MATCH_BUDGET_MS = 48_000;

/** Minimum remaining budget before we even start an optional enrichment section. */
const MIN_SECTION_MS = 500;

type SectionOutcome<T> =
  | { value: T | null; status: 'ok' | 'failed' | 'omitted' };

async function guarded<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    if (err instanceof CoverageDeadlineError) throw err;
    console.error('[capability_market_match] section failed:', err);
    return { value: null, degraded: true };
  }
}

/**
 * Bound an OPTIONAL enrichment promise to the remaining tool budget.
 * Does not require the downstream helper to honor AbortSignal — we stop waiting.
 * Omitted/failed sections are metadata, not fabricated empty "sourced" results.
 */
export async function guardedWithDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
  _sectionName: CapabilitySectionName,
): Promise<SectionOutcome<T>> {
  if (remainingMs < MIN_SECTION_MS) {
    // Detach — do not await; let it settle in the background.
    void promise.catch(() => {});
    return { value: null, status: 'omitted' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      promise.then((value) => ({ kind: 'ok' as const, value })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), remainingMs);
      }),
    ]);
    if (raced.kind === 'timeout') {
      void promise.catch(() => {});
      return { value: null, status: 'omitted' };
    }
    return { value: raced.value, status: 'ok' };
  } catch (err) {
    console.error(`[capability_market_match] ${_sectionName} failed:`, err);
    return { value: null, status: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function miss(note: string, started: number, partial?: Partial<CapabilityMarketMatchResult>): CapabilityMarketMatchResult {
  return {
    subject: partial?.subject ?? 'your company',
    keywords: partial?.keywords ?? [],
    market: null,
    buyer_vocabulary: [],
    competitors: [],
    upcoming_forecasts: [],
    recompete_opportunities: [],
    _meta: {
      grounded: false,
      degraded: false,
      anchor_verified: false,
      anchor_confidence: 'unverified',
      lead_keyword: null,
      lead_naics: null,
      selected_anchor: null,
      sections: {
        keywords: { shown: partial?.keywords?.length ?? 0, available: partial?.keywords?.length ?? 0 },
        top_naics: { shown: 0, available: 0 },
        top_psc: { shown: 0, available: 0 },
        buyer_vocabulary: { shown: 0, available: 0 },
        competitors: { shown: 0, available: 0 },
        forecasts: { shown: 0, available: 0 },
        recompetes: { shown: 0, available: 0 },
      },
      elapsed_ms: Date.now() - started,
      note,
    },
  };
}

/**
 * Deadline abort during keywordCoverage — market is UNKNOWN, not empty.
 * grounded=false + degraded=true → runMeteredTool DEFECT-7 leaves this uncharged.
 * Do NOT return fabricated total_market: 0.
 */
function deadlineMiss(started: number, partial?: Partial<CapabilityMarketMatchResult>): CapabilityMarketMatchResult {
  const base = miss(
    'Analysis stopped early — market coverage timed out before USASpending finished. This is not "no market found"; retry or narrow the capability statement.',
    started,
    partial,
  );
  return {
    ...base,
    _meta: {
      ...base._meta,
      degraded: true,
      degraded_reason: 'deadline_exceeded',
      grounded: false,
    },
  };
}

export async function capabilityMarketMatch(
  input: CapabilityMarketMatchInput,
): Promise<CapabilityMarketMatchResult> {
  const started = Date.now();
  const deadline = started + CAPABILITY_MARKET_MATCH_BUDGET_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CAPABILITY_MARKET_MATCH_BUDGET_MS);
  const remainingMs = () => Math.max(0, deadline - Date.now());

  try {
    return await capabilityMarketMatchInner(input, started, ac.signal, remainingMs);
  } catch (err) {
    if (err instanceof CoverageDeadlineError || ac.signal.aborted) {
      return deadlineMiss(started, {
        subject: input.client_name || 'your company',
        keywords: [],
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function capabilityMarketMatchInner(
  input: CapabilityMarketMatchInput,
  started: number,
  signal: AbortSignal,
  remainingMs: () => number,
): Promise<CapabilityMarketMatchResult> {
  const capabilityText = [input.description, ...(input.capabilities ?? []), ...(input.past_performance ?? [])]
    .filter(Boolean)
    .join('\n');
  const brandCtx = {
    clientName: input.client_name,
    extraExclude: input.client_name
      ? [input.client_name.replace(/\(.*?\)/g, '').replace(/\b(llc|inc|corp|co|ltd|the)\b/gi, '').trim()]
      : undefined,
    sourceText: capabilityText,
  };

  const kw = await guarded(
    deriveCompanyKeywords({
      description: input.description,
      past_performance: input.past_performance,
      capabilities: input.capabilities,
      limit: 25,
      brand_exclude: brandCtx.clientName
        ? [brandCtx.clientName.replace(/\(.*?\)/g, '').replace(/\b(llc|inc|corp|co|ltd|the)\b/gi, '').trim(), brandCtx.clientName]
        : undefined,
    }),
  );
  const keywords = kw.value?.keywords ?? [];
  if (!keywords.length) {
    return miss(
      'Not enough about the company to derive keywords — add a description, capabilities, or past performance.',
      started,
      { subject: input.client_name || 'your company' },
    );
  }

  const bestAnchor = pickBestAnchor(keywords, brandCtx);
  if (!bestAnchor) {
    return miss(
      'No defensible capability anchor from the supplied text — add a clearer capability statement or past performance.',
      started,
      { subject: input.client_name || 'your company', keywords },
    );
  }
  const lead = bestAnchor.phrase;

  if (signal.aborted || remainingMs() < 1_500) {
    return deadlineMiss(started, { subject: input.client_name || 'your company', keywords });
  }

  // Propagate remaining deadline into keywordCoverage — every USASpending fetch aborts.
  // Also race the await: if a fetch ignores AbortSignal, we still stop waiting.
  let coverage: KeywordCoverage | null = null;
  let covFailed = false;
  try {
    const covBudget = remainingMs();
    let covTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      coverage = await Promise.race([
        keywordCoverage(lead, 0.9, { signal }),
        new Promise<never>((_, reject) => {
          covTimer = setTimeout(() => reject(new CoverageDeadlineError()), covBudget);
          signal.addEventListener(
            'abort',
            () => reject(new CoverageDeadlineError()),
            { once: true },
          );
        }),
      ]);
    } finally {
      if (covTimer) clearTimeout(covTimer);
    }
  } catch (err) {
    if (err instanceof CoverageDeadlineError || signal.aborted) {
      return deadlineMiss(started, { subject: input.client_name || 'your company', keywords });
    }
    console.error('[capability_market_match] keywordCoverage failed:', err);
    covFailed = true;
    coverage = null;
  }

  const GENERIC_SERVICES = new Set(['561210', '561990', '541990', '561499', '541611', '541618']);
  const isPscPinned = Boolean(coverage?.pinnedPscCodes?.length);
  const pinnedPsc = coverage?.pinnedPscCodes?.[0];
  const nonGenericLead = coverage?.allNaics?.find((n) => !GENERIC_SERVICES.has(n.code))?.code;
  const rawLeadNaics = isPscPinned
    ? (nonGenericLead ?? coverage?.allNaics?.[0]?.code)
    : pickLeadNaicsFromCoverage(coverage);

  const evidence = await loadAnchorEvidence(input.client_name);
  const leadNaics = resolveLeadNaicsWithEvidence(coverage, evidence, rawLeadNaics ?? null);

  const validation = validateMarketAnchor({
    anchor: lead,
    coverage,
    leadNaics: leadNaics ?? null,
    evidence,
    topCodeShare: coverage?.topCodePct,
  });

  /**
   * A market is only "selected" when something outside the company's own prose agrees
   * with it. Below that bar the codes are candidates, the TAM is withheld, and no
   * competitor list is built — otherwise a keyword fallback like 541611 reads to the
   * caller as a researched answer.
   */
  const marketVerified =
    validation.anchor_confidence === 'high' || validation.anchor_confidence === 'medium';

  const tamVerified =
    validation.anchor_confidence === 'high' &&
    !validation.tamFlag &&
    validation.anchor_verified;

  const fetchCompetitors = marketVerified && Boolean(leadNaics);
  const sectionsOmitted: CapabilitySectionName[] = [];
  const sectionsFailed: CapabilitySectionName[] = [];

  const track = <T>(name: CapabilitySectionName, outcome: SectionOutcome<T>): T | null => {
    if (outcome.status === 'omitted') sectionsOmitted.push(name);
    if (outcome.status === 'failed') sectionsFailed.push(name);
    return outcome.value;
  };

  // Optional enrichment — each section is independently deadline-bounded so a hung
  // competitor/forecast call cannot hold the tool past the global budget.
  // CHARGING: omitted enrichment does NOT set degraded=true (core market still bills).
  const budgetLeft = () => remainingMs();

  const vocabOutcome = !marketVerified
    ? ({ value: null, status: 'ok' } as SectionOutcome<Awaited<ReturnType<typeof getVocabulary>>>)
    : await guardedWithDeadline(
        isPscPinned && pinnedPsc
          ? getVocabulary(pinnedPsc, { codeType: 'psc', limit: 25 })
          : leadNaics
            ? getVocabulary(leadNaics, { codeType: 'naics', limit: 25 })
            : Promise.resolve([] as Awaited<ReturnType<typeof getVocabulary>>),
        budgetLeft(),
        'buyer_vocabulary',
      );
  const vocabValue = track('buyer_vocabulary', vocabOutcome);

  const competitorOutcome = !fetchCompetitors
    ? ({ value: null, status: 'ok' } as SectionOutcome<Awaited<ReturnType<typeof searchContractors>>>)
    : await guardedWithDeadline(
        searchContractors({ naics: leadNaics!, limit: 10 }),
        budgetLeft(),
        'competitors',
      );
  let competitorsValue = track('competitors', competitorOutcome);

  const forecastOutcome = await guardedWithDeadline(
    agencyForecasts({ keyword: lead, limit: 10 }),
    budgetLeft(),
    'forecasts',
  );
  const forecastsValue = track('forecasts', forecastOutcome);

  const expiringOutcome =
    marketVerified && leadNaics
      ? await guardedWithDeadline(
          expiringContracts({ naics: leadNaics, limit: 10 }),
          budgetLeft(),
          'recompetes',
        )
      : ({ value: null, status: 'ok' } as SectionOutcome<Awaited<ReturnType<typeof expiringContracts>>>);
  const expiringValue = track('recompetes', expiringOutcome);

  let usedPscPeers = false;
  if (
    fetchCompetitors &&
    isPscPinned &&
    coverage?.pinnedPscCodes?.length &&
    budgetLeft() >= MIN_SECTION_MS
  ) {
    const pscPeers = await guardedWithDeadline(
      topRecipientsByPsc(coverage.pinnedPscCodes, 10),
      budgetLeft(),
      'competitors',
    );
    if (pscPeers.status === 'ok' && (pscPeers.value?.length ?? 0) > 0) {
      usedPscPeers = true;
      // Prefer PSC peers when available; remove a prior competitors omit if we recovered.
      const omitIdx = sectionsOmitted.lastIndexOf('competitors');
      if (omitIdx >= 0 && competitorOutcome.status === 'omitted') sectionsOmitted.splice(omitIdx, 1);
      competitorsValue = {
        queried: { naics: leadNaics ?? undefined, sort_by: 'total_obligated' as const },
        contractors: pscPeers.value as RecipientRow[],
        _meta: { grounded: true, degraded: false, count: (pscPeers.value as RecipientRow[]).length },
      } as Awaited<ReturnType<typeof searchContractors>>;
    } else if (pscPeers.status === 'omitted' && !competitorsValue) {
      if (!sectionsOmitted.includes('competitors')) sectionsOmitted.push('competitors');
    } else if (pscPeers.status === 'failed' && !competitorsValue) {
      if (!sectionsFailed.includes('competitors')) sectionsFailed.push('competitors');
    }
  }

  const rawCompetitorRows = competitorsValue?.contractors ?? [];
  const competitorRows = filterCompetitorsFabricatedRelevance(rawCompetitorRows, lead);
  const competitorDerivation = describeCompetitorDerivation({
    usedPscPeers,
    leadNaics: leadNaics ?? null,
    anchorConfidence: validation.anchor_confidence,
    rowCount: competitorRows.length,
  });

  // Core billing signal: only coverage failure / timeout flips degraded for DEFECT-7.
  // Optional enrichment omit/fail is sections_omitted / sections_failed — still billable
  // when grounded. Coverage timeout already returned via deadlineMiss.
  const coreDegraded = covFailed;

  const NAICS_CAP = 8, PSC_CAP = 6, VOCAB_CAP = 25, LIST_CAP = 10;
  const allNaics = coverage?.allNaics ?? [];
  const allPsc = coverage?.topPscList ?? [];
  let vocabTerms = (vocabValue ?? []).map((t) => (t as { term?: string }).term ?? String(t));
  if (isPscPinned && vocabTerms.length === 0) {
    const artTerms = termOfArtSynonyms(lead) ?? [];
    const pscTitles = (coverage?.topPscList ?? [])
      .map((p) => (p.name || '').trim())
      .filter(Boolean);
    vocabTerms = Array.from(new Set([...artTerms, ...pscTitles]));
  }
  // Omitted/failed enrichment → empty arrays that are NOT claimed as sourced counts
  // (available=0 when omitted; shown=0). Never invent a "0 competitors found" story.
  const vocabOmitted = sectionsOmitted.includes('buyer_vocabulary') || sectionsFailed.includes('buyer_vocabulary');
  const competitorsOmitted = sectionsOmitted.includes('competitors') || sectionsFailed.includes('competitors');
  const forecastsOmitted = sectionsOmitted.includes('forecasts') || sectionsFailed.includes('forecasts');
  const recompetesOmitted = sectionsOmitted.includes('recompetes') || sectionsFailed.includes('recompetes');

  const forecastRows = forecastsOmitted ? [] : (forecastsValue?.forecasts ?? []);
  const recompeteRows = recompetesOmitted ? [] : (expiringValue?.contracts ?? []);
  const shownAvail = (shown: number, available: number) => ({ shown: Math.min(shown, available), available });

  return {
    subject: input.client_name || 'your company',
    keywords,
    market: coverage
      ? {
          lead_keyword: lead,
          total_market: tamVerified ? coverage.totalMarket : null,
          naics_count: coverage.naicsCount,
          top_naics: marketVerified ? allNaics.slice(0, NAICS_CAP) : [],
          candidate_naics: marketVerified ? null : allNaics.slice(0, NAICS_CAP),
          naics_status: marketVerified ? ('verified' as const) : ('unverified' as const),
          top_psc: allPsc.slice(0, PSC_CAP),
          single_code_share_pct: coverage.topCodePct,
        }
      : null,
    buyer_vocabulary: vocabOmitted ? [] : vocabTerms.slice(0, VOCAB_CAP),
    competitors: competitorsOmitted ? [] : competitorRows.slice(0, LIST_CAP),
    upcoming_forecasts: forecastRows.slice(0, LIST_CAP),
    recompete_opportunities: recompeteRows.slice(0, LIST_CAP),
    _meta: {
      grounded: validation.grounded,
      // Only core coverage failure — NOT enrichment omission (Eric charging decision 2026-09-15).
      degraded: coreDegraded,
      ...(coreDegraded ? { degraded_reason: 'section_failed' as const } : {}),
      ...(sectionsOmitted.length ? { sections_omitted: [...new Set(sectionsOmitted)] } : {}),
      ...(sectionsFailed.length ? { sections_failed: [...new Set(sectionsFailed)] } : {}),
      anchor_verified: validation.anchor_verified,
      anchor_confidence: validation.anchor_confidence,
      anchor_note: validation.anchor_note,
      selected_anchor: lead,
      lead_keyword: lead,
      lead_naics: marketVerified ? (leadNaics ?? null) : null,
      tam_verified: tamVerified,
      competitor_derivation: competitorDerivation,
      evidence: {
        identity: evidence.identity,
        identity_uei: evidence.identityUei,
        identity_candidates: evidence.identityCandidates,
        sam_naics: evidence.samNaics,
        award_naics: evidence.awardNaics,
        award_obligated_usd: evidence.awardObligatedUsd,
        sources: [
          ...(evidence.samNaics.length ? (['sam_entities'] as const) : []),
          ...(evidence.awardNaics.length || evidence.awardObligatedUsd != null
            ? (['contractor_history'] as const)
            : []),
        ],
      },
      sections: {
        keywords: shownAvail(keywords.length, keywords.length),
        top_naics: shownAvail(NAICS_CAP, allNaics.length),
        top_psc: shownAvail(PSC_CAP, allPsc.length),
        buyer_vocabulary: vocabOmitted
          ? { shown: 0, available: 0 }
          : shownAvail(VOCAB_CAP, vocabTerms.length),
        competitors: competitorsOmitted
          ? { shown: 0, available: 0 }
          : shownAvail(LIST_CAP, competitorsValue?._meta?.count ?? competitorRows.length),
        forecasts: forecastsOmitted
          ? { shown: 0, available: 0 }
          : shownAvail(LIST_CAP, forecastsValue?._meta?.count ?? forecastRows.length),
        recompetes: recompetesOmitted
          ? { shown: 0, available: 0 }
          : shownAvail(LIST_CAP, expiringValue?._meta?.count ?? recompeteRows.length),
      },
      elapsed_ms: Date.now() - started,
      ...(validation.anchor_note
        ? { note: validation.anchor_note }
        : sectionsOmitted.length
          ? {
              note: `Core market returned within budget; omitted enrichment: ${[...new Set(sectionsOmitted)].join(', ')}.`,
            }
          : {}),
    },
  };
}
