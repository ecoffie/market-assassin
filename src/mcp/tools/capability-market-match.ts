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
 */
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
import { keywordCoverage, type KeywordCoverage } from '@/lib/market/keyword-coverage';
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

async function guarded<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    console.error('[capability_market_match] section failed:', err);
    return { value: null, degraded: true };
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

export async function capabilityMarketMatch(
  input: CapabilityMarketMatchInput,
): Promise<CapabilityMarketMatchResult> {
  const started = Date.now();
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

  const cov = await guarded(keywordCoverage(lead));
  const coverage = cov.value;

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

  const competitorQuery = fetchCompetitors
    ? guarded(searchContractors({ naics: leadNaics!, limit: 10 }))
    : Promise.resolve({ value: null, degraded: false as boolean });

  const [vocab, competitors, forecasts, expiring] = await Promise.all([
    !marketVerified
      ? Promise.resolve({ value: null, degraded: false as boolean })
      : isPscPinned && pinnedPsc
        ? guarded(getVocabulary(pinnedPsc, { codeType: 'psc', limit: 25 }))
        : leadNaics
          ? guarded(getVocabulary(leadNaics, { codeType: 'naics', limit: 25 }))
          : Promise.resolve({ value: null, degraded: false as boolean }),
    competitorQuery,
    guarded(agencyForecasts({ keyword: lead, limit: 10 })),
    marketVerified && leadNaics
      ? guarded(expiringContracts({ naics: leadNaics, limit: 10 }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
  ]);

  let competitorsResolved = competitors;
  let usedPscPeers = false;
  const pscPeers =
    fetchCompetitors &&
    isPscPinned &&
    coverage?.pinnedPscCodes?.length
      ? await guarded(topRecipientsByPsc(coverage.pinnedPscCodes, 10))
      : { value: null as RecipientRow[] | null, degraded: false as boolean };
  if ((pscPeers.value?.length ?? 0) > 0) {
    usedPscPeers = true;
    competitorsResolved = {
      value: {
        queried: { naics: leadNaics ?? undefined, sort_by: 'total_obligated' as const },
        contractors: pscPeers.value as RecipientRow[],
        _meta: { grounded: true, degraded: false, count: (pscPeers.value as RecipientRow[]).length },
      },
      degraded: false,
    };
  }

  const rawCompetitorRows = competitorsResolved.value?.contractors ?? [];
  const competitorRows = filterCompetitorsFabricatedRelevance(rawCompetitorRows, lead);
  const competitorDerivation = describeCompetitorDerivation({
    usedPscPeers,
    leadNaics: leadNaics ?? null,
    anchorConfidence: validation.anchor_confidence,
    rowCount: competitorRows.length,
  });

  const degraded = [cov, vocab, competitorsResolved, forecasts, expiring].some((s) => s.degraded);

  const NAICS_CAP = 8, PSC_CAP = 6, VOCAB_CAP = 25, LIST_CAP = 10;
  const allNaics = coverage?.allNaics ?? [];
  const allPsc = coverage?.topPscList ?? [];
  let vocabTerms = (vocab.value ?? []).map((t) => (t as { term?: string }).term ?? String(t));
  if (isPscPinned && vocabTerms.length === 0) {
    const artTerms = termOfArtSynonyms(lead) ?? [];
    const pscTitles = (coverage?.topPscList ?? [])
      .map((p) => (p.name || '').trim())
      .filter(Boolean);
    vocabTerms = Array.from(new Set([...artTerms, ...pscTitles]));
  }
  const forecastRows = forecasts.value?.forecasts ?? [];
  const recompeteRows = expiring.value?.contracts ?? [];
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
    buyer_vocabulary: vocabTerms.slice(0, VOCAB_CAP),
    competitors: competitorRows.slice(0, LIST_CAP),
    upcoming_forecasts: forecastRows.slice(0, LIST_CAP),
    recompete_opportunities: recompeteRows.slice(0, LIST_CAP),
    _meta: {
      grounded: validation.grounded,
      degraded,
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
        buyer_vocabulary: shownAvail(VOCAB_CAP, vocabTerms.length),
        competitors: shownAvail(LIST_CAP, competitorsResolved.value?._meta?.count ?? competitorRows.length),
        forecasts: shownAvail(LIST_CAP, forecasts.value?._meta?.count ?? forecastRows.length),
        recompetes: shownAvail(LIST_CAP, expiring.value?._meta?.count ?? recompeteRows.length),
      },
      elapsed_ms: Date.now() - started,
      ...(validation.anchor_note ? { note: validation.anchor_note } : {}),
    },
  };
}
