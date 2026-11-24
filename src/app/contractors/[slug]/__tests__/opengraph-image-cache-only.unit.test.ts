/**
 * The contractor share card must never run live BigQuery (2026-11-24): on a KV miss it used to call
 * getRollupOrSingleBySlug(slug, true) — a full slug-computing scan with no budget and no byte ceiling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const calls = vi.hoisted(() => ({ rollup: [] as unknown[][], single: [] as unknown[][] }));
vi.mock('@/lib/bigquery/recipients', () => ({
  getRollupBySlug: vi.fn(async (...a: unknown[]) => { calls.rollup.push(a); return null; }),
  getRollupOrSingleBySlug: vi.fn(async (...a: unknown[]) => { calls.single.push(a); return null; }),
}));
vi.mock('next/og', () => ({ ImageResponse: class { constructor(public el: unknown, public opts: unknown) {} } }));

describe('contractor opengraph-image is cache-only', () => {
  beforeEach(() => { calls.rollup.length = 0; calls.single.length = 0; });

  it('on a cache miss it reads cache-only (no liveBq=true) and still renders the generic card', async () => {
    const mod = await import('../opengraph-image');
    const res = await mod.default({ params: Promise.resolve({ slug: 'uncached-contractor' }) });
    expect(res).toBeTruthy();
    expect(calls.rollup).toEqual([['uncached-contractor']]);
    expect(calls.single).toEqual([['uncached-contractor']]);
    for (const c of [...calls.rollup, ...calls.single]) expect(c).not.toContain(true);
  });

  it('source never passes liveBq=true', () => {
    const src = readFileSync(join(__dirname, '..', 'opengraph-image.tsx'), 'utf8');
    expect(src).not.toMatch(/BySlug\([^)]*,\s*true\)/);
  });
});
