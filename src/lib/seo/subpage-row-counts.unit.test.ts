/**
 * Sitemap row-count probe (subpage-row-counts.ts): KV read-only, exact counts, fails closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const evalRo = vi.fn();
vi.mock('@vercel/kv', () => ({ kv: { evalRo: (...a: unknown[]) => evalRo(...a) } }));

import { DATA_VERSION } from '@/lib/bigquery/cache';
import { getSubpageRowCounts, subpageRowKvKey, ROW_COUNT_LUA } from './subpage-row-counts';

// Braces matter: a function returned from beforeEach is run as a cleanup hook.
beforeEach(() => { evalRo.mockReset(); });

describe('getSubpageRowCounts', () => {
  it('probes the exact keys the page readers use (DATA_VERSION prefix + reader cacheKey)', () => {
    expect(subpageRowKvKey('naics', 'UEI1')).toBe(`bq:${DATA_VERSION}:rollup:UEI1:all-naics:v2-m`);
    expect(subpageRowKvKey('agencies', 'UEI1')).toBe(`bq:${DATA_VERSION}:rollup:UEI1:all-agencies:v4-m`);
  });

  it('maps absent (-1), empty (0) and populated (n) keys to counts', async () => {
    evalRo.mockResolvedValueOnce([-1, 0, 7]);
    const m = await getSubpageRowCounts('naics', ['A', 'B', 'C']);
    expect([...m.entries()]).toEqual([['A', -1], ['B', 0], ['C', 7]]);
    const [script, keys] = evalRo.mock.calls[0];
    expect(script).toBe(ROW_COUNT_LUA);
    expect(keys).toEqual(['A', 'B', 'C'].map((u) => subpageRowKvKey('naics', u)));
  });

  it('batches 200 keys per call', async () => {
    evalRo.mockImplementation(async (_s: string, keys: string[]) => keys.map(() => 5));
    const ueis = Array.from({ length: 450 }, (_, i) => `U${i}`);
    const m = await getSubpageRowCounts('agencies', ueis);
    expect(evalRo).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(450);
  });

  it('fails CLOSED: a failing batch yields no counts (tabs omitted, never asserted)', async () => {
    evalRo.mockRejectedValueOnce(new Error('kv down')).mockResolvedValueOnce([9]);
    const ueis = [...Array.from({ length: 200 }, (_, i) => `U${i}`), 'LAST'];
    const m = await getSubpageRowCounts('naics', ueis);
    expect(m.has('U0')).toBe(false);
    expect(m.get('LAST')).toBe(9);
  });

  it('fails closed on an unexpected response shape', async () => {
    evalRo.mockResolvedValueOnce([1]); // 2 keys, 1 count
    expect((await getSubpageRowCounts('naics', ['A', 'B'])).size).toBe(0);
  });
});

describe('the probe cannot write or reach BigQuery', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/seo/subpage-row-counts.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('uses EVAL_RO (read-only), never EVAL/SET', () => {
    expect(src).toContain('kv.evalRo(');
    expect(src).not.toMatch(/kv\.(eval|set|del|sadd|expire)\(/);
  });
  it('the Lua script only reads (GET)', () => {
    expect(ROW_COUNT_LUA).toContain('redis.call("GET"');
    expect(ROW_COUNT_LUA).not.toMatch(/redis\.call\("(SET|DEL|EXPIRE|HSET|SADD)/i);
  });
  it('imports no BigQuery client', () => {
    expect(src).not.toMatch(/bigquery\/client|bqQuery/);
  });
});
