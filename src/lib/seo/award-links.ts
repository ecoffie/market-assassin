/**
 * Internal links to award detail pages (2026-11-12, SEO recovery Phase 2).
 *
 * Contract tables used to link every PIID to /contracts/<piid>, a vanity alias that robots.txt
 * blocks (deliberately: 13,976 impressions → 32 clicks over six months). Google cannot follow
 * those links, so ~47 links on each of 9,407 /contractors/<x>/contracts pages led nowhere it
 * could crawl, and Search Console logged 2,016 "Blocked by robots.txt" URLs.
 *
 * The crawlable destination is /awards/<award_id> (where the alias 308s). But that route turns a
 * COLD award into a 200 noindex "temporarily unavailable" placeholder once its daily cold budget
 * (4,000/day) is spent, cached by ISR for 7 days. Pointing ~440K links at it unconditionally
 * would steer Googlebot into manufacturing noindexed placeholders. So a row links only when its
 * award page can serve right now — its detail record is in KV — and renders as plain text
 * otherwise. One KV mget per table render (≤ 50 keys), no BigQuery.
 */
import { kv } from '@vercel/kv';
import { DATA_VERSION } from '@/lib/bigquery/cache';

/** Mirrors the cacheKey in getAwardLookup() (src/lib/bigquery/awards.ts). Keep them identical. */
export function awardDetailKvKey(awardId: string): string {
  return `bq:${DATA_VERSION}:awards:detail:${awardId}`;
}

/** Mirrors isValidAwardId() in awards.ts: anything else 404s there, so never link it. */
export function isLinkableAwardId(id: string | null | undefined): id is string {
  return !!id && id.length >= 3 && id.length <= 120 && /^[A-Za-z0-9_-]+$/.test(id);
}

export function awardHref(awardId: string): string {
  return `/awards/${encodeURIComponent(awardId)}`;
}

/**
 * The subset of `ids` whose award page serves from cache. Fails CLOSED: on a KV error nothing
 * is linked (plain text is a lesser page; a link into a placeholder is a worse index).
 */
export async function servableAwardIds(ids: Array<string | null | undefined>): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(isLinkableAwardId))];
  const out = new Set<string>();
  if (unique.length === 0) return out;
  try {
    const vals = await kv.mget<unknown[]>(...unique.map(awardDetailKvKey));
    unique.forEach((id, i) => {
      const v = vals[i];
      // A cached [] is a confirmed "no such award" — the page 404s it. Only a row serves.
      if (Array.isArray(v) ? v.length > 0 : v != null) out.add(id);
    });
  } catch (err) {
    console.warn('[award-links] KV mget failed; rendering award ids as text:', err instanceof Error ? err.message : err);
  }
  return out;
}
