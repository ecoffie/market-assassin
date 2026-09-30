/**
 * How many rows each contractor's /naics or /agencies sub-page can RENDER right now.
 *
 * Used by the sitemap so a tab is advertised only when its row cache is populated — the same
 * source the page renders from. Replaces the old test on the profile's stored aggregate count,
 * which advertised 12,985 pages whose tables were empty (see subpage-contract.ts).
 *
 * COST: KV only, never BigQuery. The row sets are not downloaded: a read-only Lua script
 * (EVAL_RO) returns each JSON array's length server-side, 200 keys per call, so probing ~8K
 * contractors × 2 tabs is ~80 calls and a few KB. Fails CLOSED: a batch that errors yields
 * no counts, so those tabs are omitted rather than asserted (an omitted URL returns on the next
 * daily build; a lying one costs crawl trust).
 */
import { kv } from '@vercel/kv';
import { DATA_VERSION } from '@/lib/bigquery/cache';
import { allAgenciesCacheKey, allNaicsCacheKey } from '@/lib/bigquery/recipients';

export type SubpageTab = 'naics' | 'agencies';

/** Per key: -1 absent, -2 unreadable, otherwise the array length. Read-only (EVAL_RO). */
export const ROW_COUNT_LUA =
  'local out = {} ' +
  'for i, k in ipairs(KEYS) do ' +
  'local v = redis.call("GET", k) ' +
  'if not v then out[i] = -1 ' +
  'else local ok, d = pcall(cjson.decode, v) ' +
  'if ok and type(d) == "table" then out[i] = #d else out[i] = -2 end end ' +
  'end return out';

const KEYS_PER_CALL = 200;

/** Mirrors queryCached()'s buildKey + the readers' cacheKey. Keep them identical. */
export function subpageRowKvKey(tab: SubpageTab, rollupUei: string): string {
  const cacheKey = tab === 'naics' ? allNaicsCacheKey(rollupUei) : allAgenciesCacheKey(rollupUei);
  return `bq:${DATA_VERSION}:${cacheKey}`;
}

/**
 * Map rollup UEI → renderable row count (only UEIs whose batch succeeded are present).
 */
export async function getSubpageRowCounts(tab: SubpageTab, rollupUeis: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ueis = [...new Set(rollupUeis.filter(Boolean))];
  for (let i = 0; i < ueis.length; i += KEYS_PER_CALL) {
    const part = ueis.slice(i, i + KEYS_PER_CALL);
    try {
      const counts = (await kv.evalRo(ROW_COUNT_LUA, part.map((u) => subpageRowKvKey(tab, u)), [])) as unknown;
      if (!Array.isArray(counts) || counts.length !== part.length) throw new Error('unexpected EVAL_RO shape');
      part.forEach((u, j) => {
        const n = Number(counts[j]);
        if (Number.isFinite(n)) out.set(u, n);
      });
    } catch (err) {
      console.error(
        `[subpage-row-counts] ${tab} batch at offset ${i} failed — omitting these tabs:`,
        err instanceof Error ? err.message : err,
      );
      // fail closed: no count ⇒ not eligible
    }
  }
  return out;
}
