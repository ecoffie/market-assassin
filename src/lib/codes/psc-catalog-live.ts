/**
 * ONE PSC catalog, shared by the recommender and the validator.
 *
 * WHY THIS EXISTS
 * Mindy told a customer two contradictory things about the same code:
 *
 *   recommender → "add D314, it's 9% of your market"   (live USASpending)
 *   validator   → "D314 — not a known PSC"             (a static JSON file)
 *
 * The static file was missing 1,528 real codes. Regenerating it fixed that
 * instance; a contract test stops the two from disagreeing silently. But they
 * were still TWO READS OF TWO THINGS, reconciled by a test rather than by
 * construction. This module removes the second thing.
 *
 * DESIGN — why not just call USASpending from the validator?
 * Because a settings panel cannot make a network call per keystroke, and an
 * outage must never turn a customer's saved codes into "unknown". So:
 *
 *   1. KV (shared, ~24h) — the live catalog, fetched once and shared by every
 *      instance. This is the source of truth at runtime.
 *   2. The shipped JSON — a floor, never a ceiling. Used when KV is cold or
 *      unreachable. It is generated from the SAME upstream
 *      (scripts/rebuild-psc-catalog.mjs), so the two cannot disagree by design.
 *   3. The UNION of both is what answers. A code known to either source is
 *      valid. A refresh can therefore only ever ADD knowledge — it can never
 *      revoke a code a customer already saved, which is the inverse failure
 *      (a previously-accepted PSC suddenly reading "unknown").
 *
 * Callers stay synchronous where they must (`getPsc`); this layer is async and
 * used by the surfaces that can await — API routes, the recommender, and the
 * settings validator's server action.
 */
import { kv } from '@vercel/kv';
import pscData from '@/data/psc-codes.json';

const KEY = 'psc:catalog:v1';
/** Long — the PSC manual changes a few times a year, not hourly. */
const TTL_SECONDS = 24 * 60 * 60;
const TREE = 'https://api.usaspending.gov/api/v2/references/filter_tree/psc';

export interface PscCatalog {
  /** code → title. */
  codes: Record<string, string>;
  /** 'live' | 'kv' | 'shipped' — which layer answered. Surfaced for debugging. */
  source: 'live' | 'kv' | 'shipped';
  fetchedAt: string;
}

/** The shipped file, always available, never the whole truth. */
function shipped(): Record<string, string> {
  const codes = (pscData as { codes: Record<string, { title?: string }> }).codes;
  const out: Record<string, string> = {};
  for (const [code, v] of Object.entries(codes)) out[code] = v.title || code;
  return out;
}

/** In-process memo so one warm lambda doesn't hit KV per lookup. */
let memo: { at: number; catalog: PscCatalog } | null = null;
const MEMO_MS = 5 * 60 * 1000;

async function fetchLive(): Promise<Record<string, string> | null> {
  const out: Record<string, string> = {};
  const walk = (nodes: Array<{ id?: string; description?: string; children?: unknown }>): void => {
    for (const n of nodes || []) {
      const id = String(n.id ?? '');
      if (id.length === 4) out[id] = String(n.description ?? '').trim();
      walk((n.children as typeof nodes) ?? []);
    }
  };
  try {
    const root = await fetch(`${TREE}/`, { signal: AbortSignal.timeout(20000) });
    if (!root.ok) return null;
    const roots = (await root.json()) as { results?: Array<{ id?: string }> };
    for (const r of roots.results ?? []) {
      const branch = await fetch(`${TREE}/${encodeURIComponent(String(r.id))}/?depth=3`, { signal: AbortSignal.timeout(30000) });
      if (!branch.ok) continue;
      const body = (await branch.json()) as { results?: Array<{ id?: string; description?: string; children?: unknown }> };
      walk(body.results ?? []);
    }
  } catch {
    return null; // Outage → fall back. Never throw at a validator.
  }
  // Sanity floor: a truncated response must not replace a good catalog.
  return Object.keys(out).length >= 1500 ? out : null;
}

/**
 * The catalog every surface should read. Union of shipped + cached-live, so it
 * only ever grows within a request.
 */
export async function getPscCatalog(): Promise<PscCatalog> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.catalog;

  const base = shipped();
  let catalog: PscCatalog = { codes: base, source: 'shipped', fetchedAt: new Date().toISOString() };

  try {
    const cached = await kv.get<{ codes: Record<string, string>; fetchedAt: string }>(KEY);
    if (cached?.codes && Object.keys(cached.codes).length) {
      catalog = { codes: { ...base, ...cached.codes }, source: 'kv', fetchedAt: cached.fetchedAt };
    } else {
      const live = await fetchLive();
      if (live) {
        await kv.set(KEY, { codes: live, fetchedAt: new Date().toISOString() }, { ex: TTL_SECONDS });
        catalog = { codes: { ...base, ...live }, source: 'live', fetchedAt: new Date().toISOString() };
      }
    }
  } catch {
    // KV down → the shipped floor still answers. Degrade, never fail.
  }

  memo = { at: Date.now(), catalog };
  return catalog;
}

/** Force a refresh (the cron). Returns how many codes the live tree yielded. */
export async function refreshPscCatalog(): Promise<{ ok: boolean; codes: number; error?: string }> {
  const live = await fetchLive();
  if (!live) return { ok: false, codes: 0, error: 'live catalog unavailable or truncated' };
  await kv.set(KEY, { codes: live, fetchedAt: new Date().toISOString() }, { ex: TTL_SECONDS });
  memo = null;
  return { ok: true, codes: Object.keys(live).length };
}
