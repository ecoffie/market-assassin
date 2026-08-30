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
import { termOfArtSynonyms } from '@/lib/market/sector-expansions';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { topRecipientsByPsc } from '@/lib/usaspending/psc-recipients';
import type { RecipientSearchRow as RecipientRow } from '@/lib/bigquery/recipients';

/** Bare modifiers that must never anchor a company's market (P0-1). */
const GENERIC_ANCHOR = new Set([
  'small', 'large', 'new', 'other', 'general', 'total', 'full', 'complete', 'custom',
  'special', 'standard', 'advanced', 'modern', 'basic', 'quality', 'commercial',
  'industrial', 'military', 'federal', 'national', 'local', 'domestic', 'various',
  'high', 'low', 'medium', 'heavy', 'light', 'main', 'primary', 'multi', 'single',
]);

function isGenericAnchorToken(keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  return !k.includes(' ') && GENERIC_ANCHOR.has(k);
}

/**
 * Pick the keyword that anchors market coverage. Prefer a multi-word capability
 * phrase over keywords[0] when [0] is a bare generic ("small machine shop" → not "small").
 */
export function pickLeadKeyword(keywords: string[]): string {
  if (!keywords.length) return '';
  const multiWord = keywords.find((k) => k.includes(' ') && !isGenericAnchorToken(k));
  if (multiWord) return multiWord;
  const nonGeneric = keywords.find((k) => !isGenericAnchorToken(k));
  if (nonGeneric) return nonGeneric;
  return keywords[0];
}

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
    /** P0-1: false when the market anchor failed a grounding check — treat lead_naics as a CANDIDATE, never as the company's market. */
    anchor_verified?: boolean;
    /** Human-readable reason the anchor is unverified, when it is. */
    anchor_note?: string;
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
      // MINDY-004 (Eric/QA 2026-07-30): suppress the subject's own brand tokens so the lead
      // keyword is the capability, not the company name (which returned competitors literally
      // named "Mindy"). Strip a trailing "(domain)" and any (getX.ai)/LLC/Inc noise from the name.
      brand_exclude: input.client_name
        ? [input.client_name.replace(/\(.*?\)/g, '').replace(/\b(llc|inc|corp|co|ltd|the)\b/gi, '').trim(), input.client_name]
        : undefined,
    }),
  );
  const keywords = kw.value?.keywords ?? [];
  if (!keywords.length) {
    return miss('Not enough about the company to derive keywords — add a description, capabilities, or past performance.', started);
  }
  const lead = pickLeadKeyword(keywords);

  // P0-1 SAFETY GATE (2026-08-23). A single keyword cannot carry a company's market.
  //
  // The whole market read below anchors on keywords[0]. When that token is a bare generic
  // modifier, the anchor is decided by a word that describes nothing about the business:
  // a machine shop's "small parts" emitted the unigram "small", which outranked "precision
  // machining" on cosine similarity, and keywordCoverage('small') returned the small-arms
  // AMMUNITION market (332993, 55% of $16.3B). Measured on real contractor prose, the
  // single-keyword anchor put 7 of 8 companies in an unacceptable NAICS.
  //
  // Six experimental architectures were measured against a blind-labelled benchmark and
  // none reached shippable accuracy — see src/mcp/decision-chain/DECISION-RECORD-P0-1.md.
  // The product answer is to stop inferring identity that the prose does not contain, and
  // to source it from declared/verified evidence instead (selected NAICS, SAM registration,
  // award history). That redesign is separate work.
  //
  // Until then this gate does the one thing that is unambiguously right: it refuses to
  // manufacture certainty. The tool still returns the full market read — the caller paid —
  // but flags the anchor as UNVERIFIED and hands back candidates instead of a verdict.
  const leadIsGenericUnigram = isGenericAnchorToken(lead);

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

  // P0-1 SAFETY GATE, part 2 — is this anchor GROUNDED enough to state as fact?
  // Two independent failure signals, both measured live:
  //   (a) the lead keyword is a bare generic modifier ("small" -> Ammunition);
  //   (b) one NAICS dominates the keyword's spend so heavily that the keyword is almost
  //       certainly matching award TEXT in an unrelated market rather than the company's
  //       industry (332993 held 55-99% for every machining phrase tested).
  // Neither proves the anchor wrong. Both mean we must not present it as the company's
  // market without corroboration.
  const topCodeShare = coverage?.topCodePct ?? 0;
  const anchorUnverified = leadIsGenericUnigram || topCodeShare >= 50;
  const anchorNote = leadIsGenericUnigram
    ? `Anchored on the generic term "${lead}", which does not identify an industry. Treat the codes below as CANDIDATES, not your market — confirm against your SAM registration or award history.`
    : topCodeShare >= 50
      ? `A single NAICS holds ${Math.round(topCodeShare)}% of spend for "${lead}", which usually means the keyword is matching award text in an unrelated market. Treat the codes below as CANDIDATES, not your market — confirm against your SAM registration or award history.`
      : undefined;

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

  // FM-U10 (Eric/QA 2026-07-29): for a PSC-PINNED term of art, the RIGHT competitors are the actual
  // recipients of that PSC — the tight "what was bought" signal — NOT firms sharing the pin's broad
  // product NAICS. EOD pins to PSC 1385/1386, whose biggest NAICS (334511 detection/instruments) is far
  // wider than the capability, so a NAICS competitor search returned radar/instrument primes
  // (Raytheon/Lockheed/Northrop), never EOD-tool peers (VideoRay/Tomahawk/Foster-Miller). The keyword
  // search doesn't come back EMPTY here — it comes back WRONG — so the old empty→NAICS fallback never
  // fired. When pinned, source competitors from the PSC recipients directly (real USASpending $).
  let competitorsResolved = competitors;
  const pscPeers =
    isPscPinned && coverage?.pinnedPscCodes?.length
      ? await guarded(topRecipientsByPsc(coverage.pinnedPscCodes, 10))
      : { value: null as RecipientRow[] | null, degraded: false as boolean };
  if ((pscPeers.value?.length ?? 0) > 0) {
    // Shape as a SearchContractorsResult so downstream reads (.value.contractors / _meta.count) hold.
    competitorsResolved = {
      value: {
        queried: { keyword: lead, sort_by: 'total_obligated' as const },
        contractors: pscPeers.value as RecipientRow[],
        _meta: { grounded: true, degraded: false, count: (pscPeers.value as RecipientRow[]).length },
      },
      degraded: false,
    };
  } else if ((competitors.value?.contractors?.length ?? 0) === 0 && leadNaics) {
    // Not a pinned term (or the PSC fetch degraded): the keyword search can be genuinely empty for a
    // narrow term. Fall back to the anchored lead NAICS so a hardware maker still gets real competitors.
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
  let vocabTerms = (vocab.value ?? []).map((t) => (t as { term?: string }).term ?? String(t));
  // FM-U10 (Eric/QA 2026-07-29): the naics_vocabulary/psc_vocabulary table has NO rows for the pinned
  // EOD PSCs (1385/1386), so PSC-sourced vocabulary came back EMPTY — a blank buyer_vocabulary for the
  // one market where the capability language matters most. When pinned and the table is empty, fall back
  // to the term-of-art's curated buyer terms + the pinned PSC titles. Both are authoritative (the curated
  // EOD synonym set + the official PSC names), never LLM-invented.
  if (isPscPinned && vocabTerms.length === 0) {
    const artTerms = termOfArtSynonyms(lead) ?? [];
    const pscTitles = (coverage?.topPscList ?? [])
      .map((p) => (p.name || '').trim())
      .filter(Boolean);
    vocabTerms = Array.from(new Set([...artTerms, ...pscTitles]));
  }
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
      // grounded = coverage exists AND the anchor passed P0-1 checks — never true on a
      // generic/unverified anchor while still returning market candidates.
      grounded: Boolean(coverage) && !anchorUnverified,
      degraded,
      // P0-1: false when the anchor failed a grounding check. A consumer MUST NOT present
      // lead_naics as the company's market when this is false — offer the candidates and
      // ask the user to confirm against declared/verified identity.
      anchor_verified: !anchorUnverified,
      anchor_note: anchorNote,
      lead_keyword: lead,
      lead_naics: leadNaics ?? null,
      // { shown, available } per capped section — the truncation is explicit,
      // not silent. keywords is uncapped in the payload so shown === available.
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
      ...(anchorNote ? { note: anchorNote } : {}),
    },
  };
}
