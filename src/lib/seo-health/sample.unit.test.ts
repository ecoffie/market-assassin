import { describe, expect, it } from 'vitest';
import { advanceCursor, buildPopulation, planBatch, populationHash, startIndex } from './sample';
import type { Cursor } from './types';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://getmindy.ai/contractors/c${String(i).padStart(4, '0')}`);
const cur = (last_url: string | null, cycle = 0): Cursor => ({ stream: 'crawl', last_url, cycle });

describe('population', () => {
  it('is deterministic regardless of input order and duplicates', () => {
    const a = buildPopulation(['b', 'a', 'c', 'a']);
    const b = buildPopulation(['c', 'b', 'a']);
    expect(a).toEqual(['a', 'b', 'c']);
    expect(a).toEqual(b);
    expect(populationHash(a)).toBe(populationHash(b));
  });
});

describe('planBatch', () => {
  it('starts after the cursor URL, not at an index', () => {
    const pop = urls(10);
    expect(planBatch(pop, cur(pop[3]), 3).urls).toEqual([pop[4], pop[5], pop[6]]);
  });

  it('wraps once at the end and marks where the new cycle began', () => {
    const pop = urls(5);
    const b = planBatch(pop, cur(pop[3]), 4);
    expect(b.urls).toEqual([pop[4], pop[0], pop[1], pop[2]]);
    expect(b.wrapAt).toBe(1);
  });

  it('never repeats a URL within one batch, even when the batch is larger than the population', () => {
    const pop = urls(3);
    const b = planBatch(pop, cur(null), 10);
    expect(new Set(b.urls).size).toBe(3);
  });

  it('continues correctly when the cursor URL was removed from the sitemap', () => {
    const pop = urls(10);
    const shrunk = pop.filter((u) => u !== pop[4]);
    // cursor points at a URL that no longer exists: continue with the next one in order
    expect(planBatch(shrunk, cur(pop[4]), 2).urls).toEqual([pop[5], pop[6]]);
  });

  it('does not restart at 0 when new URLs are added before the cursor', () => {
    const pop = urls(10);
    const grown = buildPopulation([...pop, 'https://getmindy.ai/aaa-new']);
    expect(planBatch(grown, cur(pop[6]), 2).urls).toEqual([pop[7], pop[8]]);
  });

  it('starts from the beginning with a null cursor, and after the last URL', () => {
    const pop = urls(4);
    expect(startIndex(pop, null)).toBe(0);
    expect(startIndex(pop, pop[3])).toBe(0);
  });
});

describe('advanceCursor', () => {
  it('advances only across the contiguous completed prefix', () => {
    const pop = urls(10);
    const b = planBatch(pop, cur(null), 5);
    const done = new Set([b.urls[0], b.urls[1], b.urls[3], b.urls[4]]); // #2 never observed
    const { cursor, advancedBy } = advanceCursor(cur(null), b, done);
    expect(advancedBy).toBe(2);
    expect(cursor.last_url).toBe(b.urls[1]);
    // the gap is first in line next run
    expect(planBatch(pop, cursor, 1).urls).toEqual([b.urls[2]]);
  });

  it('a run that recorded nothing leaves the cursor untouched', () => {
    const pop = urls(10);
    const start = cur(pop[2], 3);
    const b = planBatch(pop, start, 5);
    expect(advanceCursor(start, b, new Set()).cursor).toEqual(start);
  });

  it('counts a cycle only when the committed prefix crosses the wrap point', () => {
    const pop = urls(5);
    const start = cur(pop[3], 7);
    const b = planBatch(pop, start, 3); // [4, 0, 1], wrapAt = 1
    expect(advanceCursor(start, b, new Set([b.urls[0]])).cursor.cycle).toBe(7);
    expect(advanceCursor(start, b, new Set(b.urls)).cursor.cycle).toBe(8);
  });

  it('simulation: with random failures and timeouts, every URL is observed exactly once per cycle, none skipped', () => {
    const pop = urls(97);
    let cursor = cur(null);
    const seen = new Map<string, number>();
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let runs = 0;
    while (cursor.cycle < 1 && runs < 1000) {
      runs++;
      const b = planBatch(pop, cursor, 20);
      const done = new Set<string>();
      const fullyFailed = rand() < 0.15; // whole run fails (GSC down, crash) -> records nothing
      if (!fullyFailed) {
        const cutoff = Math.floor(rand() * b.urls.length) + 1; // time budget ends mid-batch
        for (let i = 0; i < cutoff; i++) if (rand() > 0.1) done.add(b.urls[i]); // scattered per-URL gaps
      }
      const next = advanceCursor(cursor, b, done);
      // only URLs inside the committed prefix count as covered; URLs past the wrap belong to the next cycle
      for (let i = 0; i < next.advancedBy; i++) {
        const cycleOfUrl = cursor.cycle + (b.wrapAt !== -1 && i >= b.wrapAt ? 1 : 0);
        if (cycleOfUrl === 0) seen.set(b.urls[i], (seen.get(b.urls[i]) ?? 0) + 1);
      }
      cursor = next.cursor;
    }
    expect(cursor.cycle).toBe(1);
    expect(seen.size).toBe(pop.length);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
  });
});
