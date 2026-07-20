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
    sections: { keywords: number; competitors: number; forecasts: number; recompetes: number };
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
      sections: { keywords: 0, competitors: 0, forecasts: 0, recompetes: 0 },
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
  const leadNaics = coverage?.allNaics?.[0]?.code ?? coverage?.coverageCodes?.[0];

  // 3) Fan out — parallel, each guarded — on the lead keyword + its lead NAICS.
  const [vocab, competitors, forecasts, expiring] = await Promise.all([
    leadNaics
      ? guarded(getVocabulary(leadNaics, { codeType: 'naics', limit: 25 }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
    guarded(searchContractors({ keyword: lead, limit: 10 })),
    guarded(agencyForecasts({ keyword: lead, limit: 10 })),
    leadNaics
      ? guarded(expiringContracts({ naics: leadNaics, limit: 10 }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
  ]);

  const degraded = [cov, vocab, competitors, forecasts, expiring].some((s) => s.degraded);

  return {
    subject: input.client_name || 'your company',
    keywords,
    market: coverage
      ? {
          lead_keyword: lead,
          total_market: coverage.totalMarket,
          naics_count: coverage.naicsCount,
          top_naics: coverage.allNaics.slice(0, 8),
          top_psc: coverage.topPscList.slice(0, 6),
          single_code_share_pct: coverage.topCodePct,
        }
      : null,
    buyer_vocabulary: (vocab.value ?? []).map((t) => (t as { term?: string }).term ?? String(t)).slice(0, 25),
    competitors: (competitors.value?.contractors ?? []).slice(0, 10),
    upcoming_forecasts: (forecasts.value?.forecasts ?? []).slice(0, 10),
    recompete_opportunities: (expiring.value?.contracts ?? []).slice(0, 10),
    _meta: {
      grounded: !!coverage,
      degraded,
      lead_keyword: lead,
      lead_naics: leadNaics ?? null,
      sections: {
        keywords: keywords.length,
        competitors: competitors.value?._meta?.count ?? 0,
        forecasts: forecasts.value?._meta?.count ?? 0,
        recompetes: expiring.value?._meta?.count ?? 0,
      },
      elapsed_ms: Date.now() - started,
    },
  };
}
