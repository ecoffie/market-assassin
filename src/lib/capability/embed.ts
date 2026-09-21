/**
 * Contractor capability embeddings (PRD Phase 3) — the meaning blob + batch embed helper.
 * docs/PRD-contractor-capability-profiles.md
 *
 * WHY: today partner matching is CODE OVERLAP ("who else works in NAICS 541512"). Embeddings
 * make it semantic — "who does work like this", and eventually "who covers the gaps I can't".
 *
 * Mirrors the proven per-user pattern in src/lib/alerts/capability-vector.ts (OpenAI
 * text-embedding-3-small → 1536-dim number[] in jsonb, plus a source hash so unchanged rows are
 * never re-embedded). The difference: that one keys on OUR USERS; this keys on third-party
 * contractors (rollup_uei), which is the gap Phase 3 fills.
 *
 * BLOB CONTENT — GROUNDED ONLY (rule #1). The blob is built from coded fields:
 * psc_description / naics_description / agency names / set-aside behaviour. The free-text
 * awards.description column is EXCLUDED, exactly as in Phases 1-2: median 35 chars, dominated by
 * boilerplate, and it contradicts the coded fields (nitrile gloves under PSC "FLOOR POLISHERS AND
 * VACUUM CLEANING EQUIPMENT"). Embedding that text would bake the contradiction into the vector
 * space, where it is far harder to notice than a wrong label on a card.
 */
import { createHash } from 'crypto';

const EMBED_MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 8000;

export interface EmbeddableProfile {
  rollup_uei: string;
  rollup_name: string;
  capability_label: string | null;
  top_pscs: Array<{ code?: string; description?: string; share?: number }> | null;
  top_naics: Array<{ code?: string; description?: string }> | null;
  top_agencies: Array<{ agency?: string; share?: number }> | null;
  set_asides_won: string[] | null;
  specialty_tier: string | null;
}

/**
 * Assemble the text whose MEANING we embed.
 *
 * Ordered most- to least-specific so the strongest signal leads: what they do → the industries
 * → who buys. Shares are rendered as words ("primarily", "also") rather than digits, because
 * embedding models treat "0.92" as a token, not a magnitude — the percentage belongs on the card,
 * not in the vector.
 */
export function buildCapabilityBlob(p: EmbeddableProfile): string {
  const parts: string[] = [];

  if (p.capability_label) parts.push(p.capability_label);

  const pscs = (p.top_pscs || []).filter((x) => x.description).slice(0, 5);
  if (pscs.length) {
    const [lead, ...rest] = pscs;
    parts.push(`Primarily ${lead.description}.`);
    if (rest.length) parts.push(`Also performs ${rest.map((x) => x.description).join('; ')}.`);
  }

  const naics = (p.top_naics || []).filter((x) => x.description).slice(0, 4);
  if (naics.length) parts.push(`Industries: ${naics.map((x) => x.description).join('; ')}.`);

  const agencies = (p.top_agencies || []).filter((x) => x.agency).slice(0, 4);
  if (agencies.length) parts.push(`Sells to ${agencies.map((x) => x.agency).join('; ')}.`);

  // Set-aside is BEHAVIOUR, phrased as such — never as a held certification.
  const sa = (p.set_asides_won || []).filter((s) => s && !/NO SET ASIDE/i.test(s));
  if (sa.length) parts.push(`Has won set-aside work: ${sa.slice(0, 4).join('; ')}.`);

  if (p.specialty_tier) {
    parts.push(
      p.specialty_tier === 'specialist' ? 'A specialist concentrated in one product or service area.'
        : p.specialty_tier === 'focused' ? 'Focused on a primary product or service area.'
          : 'A diversified contractor spanning many product and service areas.',
    );
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
}

/** Stable hash of the meaning text — an unchanged blob is never re-embedded (cost guard). */
export function blobHash(blob: string): string {
  return createHash('sha1').update(blob).digest('hex');
}

/**
 * Embed MANY texts in one API call.
 *
 * The shared embedText() in src/lib/market/embeddings.ts sends one input per request, which is
 * right for a single user profile but would mean 71,101 HTTP round-trips here. The OpenAI
 * embeddings endpoint accepts an array, so batching cuts that ~100x with identical output.
 * Retries 429/5xx with backoff; throws on a terminal error so the caller can stop rather than
 * silently write nothing.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const inputs = texts.map((t) => (t || '').trim().slice(0, MAX_INPUT_CHARS)).filter(Boolean);
  if (!inputs.length) return [];

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    });

    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * (attempt + 1) ** 2)));
      continue;
    }
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI embeddings ${res.status}: ${err.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    const data = json.data || [];
    // The API may return out of order — sort by index so vectors line up with inputs.
    return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
  throw new Error('OpenAI embeddings: retries exhausted');
}

/** Cosine similarity for two same-length vectors. Returns 0 on a shape mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** text-embedding-3-small list price, for the cost gate the PRD requires before a full run. */
export const EMBED_COST_PER_1M_TOKENS = 0.02;
/** ~4 chars per token is the standard English approximation. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
