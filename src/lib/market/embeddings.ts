/**
 * Semantic embedding engine — OpenAI text-embedding-3-small + in-app cosine.
 * Used by recompete SOW match and (later) "find work like mine".
 */

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIM = 1536;
const MAX_INPUT_CHARS = 8000;

/** Award title vs full SOW body rarely exceeds ~0.55–0.69; tune from telemetry. */
export const RECOMPETE_SOW_THRESHOLD = parseFloat(process.env.RECOMPETE_SOW_THRESHOLD || '0.52');
export const RECOMPETE_SOW_MIN_GAP = parseFloat(process.env.RECOMPETE_SOW_MIN_GAP || '0.01');
/** Below this we hide the link entirely — too likely wrong. */
export const RECOMPETE_SOW_POSSIBLE_THRESHOLD = parseFloat(
  process.env.RECOMPETE_SOW_POSSIBLE_THRESHOLD || '0.42',
);

/**
 * "Hidden match" (Phase 3 semantic alerts) — a rich capability blob vs a full SOW
 * body. Both texts are long + on-topic, so scores run higher AND noisier than the
 * recompete title→SOW case; a wrong "matches your capabilities" claim in a daily
 * email erodes trust in the honest label, so this floor is CONSERVATIVE (> the
 * recompete-confident 0.52). Tune DOWN from telemetry only if precision holds.
 */
export const HIDDEN_MATCH_THRESHOLD = parseFloat(process.env.HIDDEN_MATCH_THRESHOLD || '0.55');
/** Max hidden matches surfaced per alert (don't dilute the headline opps). */
export const HIDDEN_MATCH_MAX = parseInt(process.env.HIDDEN_MATCH_MAX || '3', 10);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST to OpenAI embeddings API. Retries on 429. */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const input = (text || '').trim().slice(0, MAX_INPUT_CHARS);
  if (!input) throw new Error('empty text');

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });

    if (res.status === 429) {
      const wait = Math.min(8000, 1000 * (attempt + 1) ** 2);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenAI embeddings ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const vec = data?.data?.[0]?.embedding as number[] | undefined;
    if (!vec || vec.length !== EMBED_DIM) {
      throw new Error(`unexpected embedding dim: ${vec?.length ?? 0}`);
    }
    return vec;
  }

  throw new Error('OpenAI embeddings rate-limited after retries');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function parseEmbedding(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== EMBED_DIM) return null;
  if (!raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return raw as number[];
}

export function topMatches<T extends Record<string, unknown>>(
  queryVec: number[],
  candidates: (T & { vec: number[] })[],
  k: number,
): (T & { vec: number[]; score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: cosineSimilarity(queryVec, c.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const AGENCY_STOP = new Set(['department', 'dept', 'of', 'the', 'and', 'for', 'a', 'an']);

/** Meaningful token for department ilike pre-filter (not bare "Department"). */
export function agencyFilterToken(agency: string): string | null {
  const words = agency
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
  for (const w of words) {
    if (!AGENCY_STOP.has(w.toLowerCase())) return w;
  }
  return words[0] || null;
}

/**
 * Map USASpending expiring-contract agency names → SAM `department` ilike patterns.
 * Army/Navy/AF all live under DEPT OF DEFENSE in SAM — not "Army" literally.
 *
 * Patterns must NOT contain commas — PostgREST `.or()` uses comma as a delimiter.
 */
export function agencyDepartmentPatterns(agency: string): string[] {
  const a = (agency || '').toLowerCase();
  if (/army|navy|air force|marine|defense|\bdod\b|military|usaf|usmc|usn/.test(a)) {
    return ['DEPT OF DEFENSE'];
  }
  if (/veterans|\bva\b/.test(a)) return ['VETERANS AFFAIRS'];
  if (/homeland|dhs|cbp|ice|fema|tsa/.test(a)) return ['HOMELAND SECURITY'];
  if (/health.*human|hhs|\bnih\b|\bcdc\b/.test(a)) return ['HEALTH AND HUMAN SERVICES'];
  if (/energy|\bdoe\b/.test(a)) return ['ENERGY'];
  if (/justice|\bdoj\b|fbi/.test(a)) return ['JUSTICE'];
  if (/interior|\bdoi\b/.test(a)) return ['INTERIOR'];
  if (/transportation|\bdot\b/.test(a)) return ['TRANSPORTATION'];
  if (/commerce/.test(a)) return ['COMMERCE'];
  if (/nasa|aeronautics/.test(a)) return ['NATIONAL AERONAUTICS'];
  if (/gsa|general services/.test(a)) return ['GENERAL SERVICES'];
  const token = agencyFilterToken(agency);
  return token ? [token] : [];
}

export function naicsPrefix(naics: string): string | null {
  const digits = (naics || '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(0, 3) : null;
}

export function naics2Prefix(naics: string): string | null {
  const digits = (naics || '').replace(/\D/g, '');
  return digits.length >= 2 ? digits.slice(0, 2) : null;
}

/** Richer embedding input than award title alone. */
export function buildRecompeteQueryText(description: string, naics?: string, agency?: string): string {
  const parts = [(description || '').trim()];
  if (naics) parts.push(`NAICS ${naics}`);
  if (agency) parts.push(agency.trim());
  return parts.filter(Boolean).join(' | ');
}

export interface RecompeteMatchVerdict {
  confident: boolean;
  topScore: number;
  runnerUpScore: number;
  gap: number;
  threshold: number;
  minGap: number;
}

export function evaluateRecompeteMatch(
  topScore: number,
  runnerUpScore: number,
  threshold = RECOMPETE_SOW_THRESHOLD,
  minGap = RECOMPETE_SOW_MIN_GAP,
): RecompeteMatchVerdict {
  const gap = topScore - runnerUpScore;
  const weakRunnerUp = runnerUpScore < 0.4;
  return {
    confident: topScore >= threshold && (gap >= minGap || weakRunnerUp),
    topScore,
    runnerUpScore,
    gap,
    threshold,
    minGap,
  };
}

export function isPossibleRecompeteMatch(score: number): boolean {
  return score >= RECOMPETE_SOW_POSSIBLE_THRESHOLD;
}
