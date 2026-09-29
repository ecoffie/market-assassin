/**
 * Deterministic, resumable rotation over the sitemap population. Pure; no I/O.
 *
 * Population: every sitemap URL, de-duplicated and sorted by plain string order.
 * Same sitemap in, same order out, independent of fetch order or sitemap file order.
 *
 * Cursor: the LAST URL that was observed AND recorded (stored as the URL, not an
 * index). The next batch starts at the first population URL strictly after it. This
 * keeps the rotation stable when URLs are added or removed: nothing is skipped and
 * the rotation never silently restarts at 0.
 *
 * Commit rule: after a run, the cursor moves only across the contiguous prefix of the
 * batch that completed. If URL #7 of 200 was never observed (timeout budget hit, crash,
 * quota), the cursor stops at #6 and #7 is first in line next run, even if #8..#200
 * finished. A run that records nothing leaves the cursor exactly where it was.
 */
import { createHash } from 'node:crypto';
import type { Cursor } from './types';

export function buildPopulation(urls: Iterable<string>): string[] {
  return [...new Set(urls)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function populationHash(population: string[]): string {
  return createHash('sha256').update(population.join('\n')).digest('hex');
}

/** Index of the first population URL strictly after `lastUrl` (binary search). 0 when lastUrl is null. */
export function startIndex(population: string[], lastUrl: string | null): number {
  if (lastUrl === null) return 0;
  let lo = 0;
  let hi = population.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (population[mid] <= lastUrl) lo = mid + 1;
    else hi = mid;
  }
  return lo === population.length ? 0 : lo; // past the end wraps to the start of the next cycle
}

export interface Batch {
  urls: string[];
  /** Index within `urls` where the rotation wrapped to the start (a new cycle began), or -1. */
  wrapAt: number;
}

/** The next `size` URLs after the cursor, wrapping at most once. Never repeats a URL within a batch. */
export function planBatch(population: string[], cursor: Pick<Cursor, 'last_url'>, size: number): Batch {
  const n = Math.min(size, population.length);
  if (n <= 0) return { urls: [], wrapAt: -1 };
  const start = startIndex(population, cursor.last_url);
  const urls: string[] = [];
  let wrapAt = -1;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % population.length;
    if (idx === 0 && (i > 0 || (cursor.last_url !== null && start === 0))) wrapAt = wrapAt === -1 ? i : wrapAt;
    urls.push(population[idx]);
  }
  return { urls, wrapAt };
}

/**
 * The cursor after a run. `completed` holds the batch URLs that were observed AND
 * recorded. Only the contiguous completed prefix of the batch advances the cursor.
 */
export function advanceCursor(cursor: Cursor, batch: Batch, completed: ReadonlySet<string>): { cursor: Cursor; advancedBy: number } {
  let k = 0;
  while (k < batch.urls.length && completed.has(batch.urls[k])) k++;
  if (k === 0) return { cursor, advancedBy: 0 };
  const crossedWrap = batch.wrapAt !== -1 && batch.wrapAt < k;
  return {
    cursor: { ...cursor, last_url: batch.urls[k - 1], cycle: cursor.cycle + (crossedWrap ? 1 : 0) },
    advancedBy: k,
  };
}
