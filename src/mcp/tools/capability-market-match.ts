/**
 * MCP tool: capability_market_match — "where do I actually fit?"
 *
 * Combination tool #1. Turns a company's OWN words into a complete addressable-market
 * read in ONE call, by chaining existing atomic tools:
 *   derive_company_keywords → keyword-coverage → (market vocabulary · top competitors ·
 *   upcoming forecasts · expiring/recompete opportunities).
 *
 * No new data engine — it orchestrates pure fns, each GUARDED (honest-miss: a failed
 * section degrades to empty, never fabricates). `_meta` always ships. Credits are
 * charged by the transport (runMeteredTool). This is the natural onboarding reveal:
 * a founder pastes what they do and gets back their real codes, their competitors,
 * the buyer vocabulary, and the opportunities open to them right now.
 */
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
import { keywordCoverage, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { getVocabulary } from '@/lib/market/vocabulary';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';

export interface CapabilityMarketMatchInput {
  /** What the company does, in its own words. */
  description?: string;
  /** Past-performance blurbs (contracts won, work delivered). */
  past_performance?: string[];
  /** Capability statements / service lines. */
  capabilities?: string[];
  /** Optional label for the deliverable header. */
  client_name?: string;
  /** The verified MCP caller (ctx.userEmail) — never from args. */
  userEmail?: string;
}

export interface CapabilityMarketMatchResult {
  subject: string;
  keywords: string[];
  market: {
    lead_keyword: string;
    total_market: number;
    naics_count: number;
    top_naics: KeywordCoverage['allNaics'];
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
    lead_keyword: string | null;
    lead_naics: string | null;
    // { shown, available } per capped section — truncation is explicit, never a
    // silent .slice() on result data. shown === available means nothing was cut.
    sections: Record<
      'keywords' | 'top_naics' | 'top_psc' | 'buyer_vocabulary' | 'competitors' | 'forecasts' | 'recompetes',
      { shown: number; available: number }
    >;
    elapsed_ms: number;
    note?: string;
  };
}

/** A failed section degrades to null, never throws — the caller paid; never lose the result. */
async function guarded<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    console.error('[capability_market_match] section failed:', err);
    return { value: null, degraded: true };
  }
}

function miss(note: string, started: number): CapabilityMarketMatchResult {
  return {
    subject: 'your company',
    keywords: [],
    market: null,
    buyer_vocabulary: [],
    competitors: [],
    upcoming_forecasts: [],
    recompete_opportunities: [],
    _meta: {
      grounded: false, degraded: false, lead_keyword: null, lead_naics: null,
      sections: {
        keywords: { shown: 0, available: 0 }, top_naics: { shown: 0, available: 0 },
        top_psc: { shown: 0, available: 0 }, buyer_vocabulary: { shown: 0, available: 0 },
        competitors: { shown: 0, available: 0 }, forecasts: { shown: 0, available: 0 },
        recompetes: { shown: 0, available: 0 },
      },
      elapsed_ms: Date.now() - started, note,
    },
  };
}

export async function capabilityMarketMatch(
  input: CapabilityMarketMatchInput,
): Promise<CapabilityMarketMatchResult> {
  const started = Date.now();

  // 1) Derive the buyer-facing keywords from the company's OWN words.
  const kw = await guarded(
    deriveCompanyKeywords({
      description: input.description,
      past_performance: input.past_performance,
      capabilities: input.capabilities,
      limit: 15,
    }),
  );
  const keywords = kw.value?.keywords ?? [];
  if (!keywords.length) {
    return miss('Not enough about the company to derive keywords — add a description, capabilities, or past performance.', started);
  }
  const lead = keywords[0];

  // 2) Market coverage for the lead keyword — the real NAICS spread + market size.
  const cov = await guarded(keywordCoverage(lead));
  const coverage = cov.value;

  // FM-U10 (Eric/QA 2026-07-29): anchor the lead NAICS to the CAPABILITY signal, not raw keyword
  // dollar-weight. For a term-of-art capability (EOD tools, pinned to PSC 1385/1386), the biggest
  // NAICS by $ is 561210 Facilities Support — base-ops contracts that merely MENTION EOD — which then
  // dragged vocabulary to LOGCAP/KBR and recompetes to facilities. When the coverage is PSC-PINNED,
  // (a) source vocabulary from the PSC itself, and (b) pick the lead NAICS as the top NAICS that ISN'T
  // a generic services catch-all (561210/561990/541990/561499), so it lands on the real product code.
  const GENERIC_SERVICES = new Set(['561210', '561990', '541990', '561499', '541611', '541618']);
  const isPscPinned = Boolean(coverage?.pinnedPscCodes?.length);
  const pinnedPsc = coverage?.pinnedPscCodes?.[0];
  const nonGenericLead = coverage?.allNaics?.find((n) => !GENERIC_SERVICES.has(n.code))?.code;
  const leadNaics = isPscPinned
    ? (nonGenericLead ?? coverage?.allNaics?.[0]?.code)
    : (coverage?.allNaics?.[0]?.code ?? coverage?.coverageCodes?.[0]);

  // 3) Fan out — parallel, each guarded. Vocabulary follows the PSC when pinned (the real capability
  // signal); competitors/forecasts stay keyword-driven; recompetes use the anchored lead NAICS.
  const [vocab, competitors, forecasts, expiring] = await Promise.all([
    isPscPinned && pinnedPsc
      ? guarded(getVocabulary(pinnedPsc, { codeType: 'psc', limit: 25 }))
      : leadNaics
        ? guarded(getVocabulary(leadNaics, { codeType: 'naics', limit: 25 }))
        : Promise.resolve({ value: null, degraded: false as boolean }),
    guarded(searchContractors({ keyword: lead, limit: 10 })),
    guarded(agencyForecasts({ keyword: lead, limit: 10 })),
    leadNaics
      ? guarded(expiringContracts({ naics: leadNaics, limit: 10 }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
  ]);

  // FM-U10: the keyword competitor search can come back empty for a narrow capability term (no firm
  // literally named "EOD"). Fall back to the anchored lead NAICS so a hardware maker still gets real
  // competitors from its product code instead of a blank section.
  let competitorsResolved = competitors;
  if ((competitors.value?.contractors?.length ?? 0) === 0 && leadNaics) {
    const byNaics = await guarded(searchContractors({ naics: leadNaics, limit: 10 }));
    if ((byNaics.value?.contractors?.length ?? 0) > 0) competitorsResolved = byNaics;
  }

  const degraded = [cov, vocab, competitorsResolved, forecasts, expiring].some((s) => s.degraded);

  // This is a SUMMARY tool: each section is intentionally capped to a
  // digestible size. The caps are made HONEST via _meta.sections below, which
  // reports { shown, available } per section so a consumer can tell "top 8 of
  // 40 NAICS" from "only 8 exist" — never a silent .slice() on result data.
  const NAICS_CAP = 8, PSC_CAP = 6, VOCAB_CAP = 25, LIST_CAP = 10;
  const allNaics = coverage?.allNaics ?? [];
  const allPsc = coverage?.topPscList ?? [];
  const vocabTerms = (vocab.value ?? []).map((t) => (t as { term?: string }).term ?? String(t));
  const competitorRows = competitorsResolved.value?.contractors ?? [];
  const forecastRows = forecasts.value?.forecasts ?? [];
  const recompeteRows = expiring.value?.contracts ?? [];
  const shownAvail = (shown: number, available: number) => ({ shown: Math.min(shown, available), available });

  return {
    subject: input.client_name || 'your company',
    keywords,
    market: coverage
      ? {
          lead_keyword: lead,
          total_market: coverage.totalMarket,
          naics_count: coverage.naicsCount,
          top_naics: allNaics.slice(0, NAICS_CAP),
          top_psc: allPsc.slice(0, PSC_CAP),
          single_code_share_pct: coverage.topCodePct,
        }
      : null,
    buyer_vocabulary: vocabTerms.slice(0, VOCAB_CAP),
    competitors: competitorRows.slice(0, LIST_CAP),
    upcoming_forecasts: forecastRows.slice(0, LIST_CAP),
    recompete_opportunities: recompeteRows.slice(0, LIST_CAP),
    _meta: {
      grounded: !!coverage,
      degraded,
      lead_keyword: lead,
      lead_naics: leadNaics ?? null,
      // { shown, available } per capped section — the truncation is explicit,
      // not silent. keywords is uncapped in the payload so shown === available.
      sections: {
        keywords: shownAvail(keywords.length, keywords.length),
        top_naics: shownAvail(NAICS_CAP, allNaics.length),
        top_psc: shownAvail(PSC_CAP, allPsc.length),
        buyer_vocabulary: shownAvail(VOCAB_CAP, vocabTerms.length),
        competitors: shownAvail(LIST_CAP, competitors.value?._meta?.count ?? competitorRows.length),
        forecasts: shownAvail(LIST_CAP, forecasts.value?._meta?.count ?? forecastRows.length),
        recompetes: shownAvail(LIST_CAP, expiring.value?._meta?.count ?? recompeteRows.length),
      },
      elapsed_ms: Date.now() - started,
    },
  };
}
