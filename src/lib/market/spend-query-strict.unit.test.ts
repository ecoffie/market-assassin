/**
 * Poteto 2026-09-22 — a USAspending failure must be distinguishable from "no rows".
 * The default (return [] on failure) is what the panels rely on; `strict` is what a
 * caller reporting empty-vs-failed needs. Without it a timeout printed as an empty table.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSpendingCategory } from './spend-query';

afterEach(() => vi.unstubAllGlobals());

describe('fetchSpendingCategory strict mode', () => {
  it('HTTP 500: default returns [], strict throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(fetchSpendingCategory('recipient', {}, 5, 't')).resolves.toEqual([]);
    await expect(fetchSpendingCategory('recipient', {}, 5, 't', { strict: true })).rejects.toThrow(/HTTP 500/);
  });
  it('network error: strict throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(fetchSpendingCategory('recipient', {}, 5, 't', { strict: true })).rejects.toThrow(/ECONNRESET/);
  });
  it('a genuine empty result is [] in strict mode too (empty is an answer, not a failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));
    await expect(fetchSpendingCategory('recipient', {}, 5, 't', { strict: true })).resolves.toEqual([]);
  });
  it('carries the recipient UEI so same-name registrations stay distinguishable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [
      { name: 'NORTHROP GRUMMAN SYSTEMS CORPORATION', uei: 'LALWKM623MU7', amount: 1 },
      { name: 'NORTHROP GRUMMAN SYSTEMS CORPORATION', uei: 'PK8PM2GNVMP8', amount: 2 },
    ] }), { status: 200 })));
    const rows = await fetchSpendingCategory('recipient', {}, 5, 't', { strict: true });
    expect(rows.map((r) => r.uei)).toEqual(['LALWKM623MU7', 'PK8PM2GNVMP8']);
  });
});
