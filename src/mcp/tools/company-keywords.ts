/**
 * MCP tool: derive_company_keywords — turn a company's OWN words (what they do, past
 * performance) into the search keywords buyers actually use, ranked BY MEANING. The
 * point (Eric): NAICS is the wrong discovery key; a company's real vocabulary — pulled
 * from its scope descriptions + capabilities — finds the market its codes miss.
 *
 * Wraps the pure src/lib/market/semantic-keywords.ts (OpenAI embeddings — same engine
 * as recompete SOW match; NO BigQuery, so no scan-quota exposure). Fails soft: if
 * embeddings are unavailable it returns the lexical candidates unranked, and _meta.ranked
 * says which you got. grounded=false = not enough input text to derive anything — do NOT
 * invent keywords. tier: metered, credits: 1. `_meta` always ships; `_ai_hint` OFF.
 */
import { deriveSemanticKeywords } from '@/lib/market/semantic-keywords';
import { mcpFlags } from '@/lib/mcp/flags';

export interface CompanyKeywordsToolInput {
  /** What the company does — one-liner / elevator pitch / capability summary. */
  description?: string;
  /** Past-performance scope descriptions (the richest signal — what they've actually done). */
  past_performance?: string[];
  /** Capability statements / service descriptions. */
  capabilities?: string[];
  /** NAICS/PSC title text the caller already knows (optional enrichment). */
  code_titles?: string[];
  /** Max keywords (default 12, max 25). */
  limit?: number;
}

export interface CompanyKeywordsToolResult {
  keywords: string[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    ranked: boolean; // true = semantically ranked; false = lexical fallback (embeddings unavailable)
    keyword_count: number;
    input_chars: number;
  };
}

export async function deriveCompanyKeywords(input: CompanyKeywordsToolInput): Promise<CompanyKeywordsToolResult> {
  const description = (input.description || '').trim();
  const pastPerf = (input.past_performance || []).filter((s) => typeof s === 'string' && s.trim());
  const capabilities = (input.capabilities || []).filter((s) => typeof s === 'string' && s.trim());
  const codeTitles = (input.code_titles || []).filter((s) => typeof s === 'string' && s.trim());
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25);

  const inputChars =
    description.length +
    pastPerf.join(' ').length +
    capabilities.join(' ').length +
    codeTitles.join(' ').length;

  // Not enough signal to derive anything meaningful.
  if (inputChars < 12) {
    return {
      keywords: [],
      _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: inputChars },
    };
  }

  // The description is the cleanest "meaning" anchor; scope/capabilities/titles feed candidates.
  let keywords: string[] = [];
  let degraded = false;
  let ranked = true;
  try {
    keywords = await deriveSemanticKeywords(
      {
        oneLiner: description || null,
        capabilities,
        scopeDescriptions: pastPerf,
        naicsDescriptions: codeTitles,
        meaningText: description || undefined,
      },
      limit,
      0.6, // trim the off-topic tail
    );
  } catch (e) {
    degraded = true;
    console.error('[derive_company_keywords] failed:', e instanceof Error ? e.message : String(e));
  }
  // deriveSemanticKeywords fails SOFT to lexical order when OpenAI is down; we can't tell
  // ranked vs lexical from the return alone, so flag ranked=false only on a hard throw.
  if (degraded) ranked = false;

  const grounded = keywords.length > 0;
  const result: CompanyKeywordsToolResult = {
    keywords,
    _meta: {
      grounded,
      degraded,
      ranked,
      keyword_count: keywords.length,
      input_chars: inputChars,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !grounded
        ? degraded
          ? 'Keyword derivation errored (embedding engine unavailable) — try again shortly; do not invent keywords.'
          : 'Not enough company text to derive keywords — pass a description and/or past-performance scope descriptions.'
        : `${keywords.length} keyword(s) derived from the company's own words${ranked ? ', semantically ranked' : ' (lexical fallback — embeddings were unavailable)'}: ${keywords.slice(0, 6).join(', ')}${keywords.length > 6 ? ', …' : ''}.`,
      how_to_use:
        'Use these as opportunity-search terms (they describe the work the way buyers write it) — feed them to search_agency_opps_by_office / a SAM keyword search. They complement NAICS: NAICS is the seller-size axis, these are the discovery axis.',
      key_caveats: [
        'Derived ONLY from the text you passed — richer input (real past-performance scope) yields sharper keywords; a thin description yields generic ones.',
        'These are inferred search terms, not an official classification; review before using them to gate alerts.',
      ],
    };
  }
  return result;
}
