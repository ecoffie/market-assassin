/**
 * Share one in-flight (and briefly, one settled) result per key within this server process.
 *
 * Used where two renders of the SAME request — generateMetadata() and the page body — must
 * not each spend a unit of a budget or each fire a live query. React cache() did not dedupe
 * those in production (measured 2026-11-12, see contractor-page-data.ts).
 *
 * Bounded: settled entries expire after `ttlMs`, and the map is capped so a crawler walking
 * unique slugs cannot grow it without limit. Rejections are not retained.
 */
export function dedupeInFlight<A extends unknown[], R>(
  keyOf: (...args: A) => string,
  fn: (...args: A) => Promise<R>,
  { ttlMs = 10_000, max = 500 }: { ttlMs?: number; max?: number } = {},
): (...args: A) => Promise<R> {
  const entries = new Map<string, { p: Promise<R>; settledAt: number | null }>();
  return (...args: A) => {
    const key = keyOf(...args);
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && (hit.settledAt === null || now - hit.settledAt < ttlMs)) return hit.p;
    if (entries.size >= max) {
      for (const [k, v] of entries) {
        if (v.settledAt !== null && now - v.settledAt >= ttlMs) entries.delete(k);
      }
      if (entries.size >= max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    }
    const entry: { p: Promise<R>; settledAt: number | null } = { p: fn(...args), settledAt: null };
    entries.set(key, entry);
    entry.p.then(
      () => { entry.settledAt = Date.now(); },
      () => { if (entries.get(key) === entry) entries.delete(key); },
    );
    return entry.p;
  };
}
