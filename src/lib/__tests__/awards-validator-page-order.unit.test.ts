/**
 * validateGeneration must count every staging page exactly once across paginated reads.
 *
 * Build 12 (2026-11-14) reported 1,435,307 award rows in its telemetry while the promoted table
 * held 1,435,246: the validator paged (PostgREST range, 1,000 rows a page) over an order of
 * `recipient_uei` alone, which is not unique (up to 3 pages per contractor). Postgres may break
 * ties differently on every request, so a page at a boundary could be read twice and another
 * skipped. The fake below does exactly that: it honours the requested ORDER BY and shuffles ties
 * on every call, like a real planner is allowed to.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Row = {
  recipient_uei: string; page_number: number; row_count: number;
  contract_count: number; displayed_action_count: number; total_action_count: number;
  payload_checksum: string; source_as_of: string;
};

const db = vi.hoisted(() => ({ rows: [] as Row[], seed: 1 }));
const pageOrderDisabled = vi.hoisted(() => ({ value: false }));

// Seeded PRNG so a tie-shuffle is different on every request but the test is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const orders: string[] = [];
      const b = {
        select: () => b, eq: () => b,
        order: (col: string) => { if (!(pageOrderDisabled.value && col === 'page_number')) orders.push(col); return b; },
        range: async (from: number, to: number) => {
          const rand = rng(db.seed++);
          // Random tie-break FIRST, then a stable sort on the requested keys only: rows equal
          // on every requested key come back in a different order on each request.
          const rows = db.rows.map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
          rows.sort((x, y) => {
            for (const c of orders) {
              const a = x[c as keyof Row], z = y[c as keyof Row];
              if (a < z) return -1;
              if (a > z) return 1;
            }
            return 0;
          });
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('@/lib/bigquery/client', () => ({ bqQuery: vi.fn(), bqJobOptions: () => ({ labels: {} }) }));
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }));

import { validateGeneration } from '../awards-refresh';
import { readAllPages } from '../paged-read';
import { createClient } from '@supabase/supabase-js';

/** 6,000 contractors with 1-3 pages each: ~12K page rows, many 1,000-row range boundaries. */
function generation(): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < 6000; i++) {
    const pages = (i % 3) + 1;
    const actions = pages * 50 - 7;
    for (let p = 1; p <= pages; p++) {
      out.push({
        recipient_uei: `UEI${String(i).padStart(5, '0')}`, page_number: p,
        row_count: p < pages ? 50 : 43, contract_count: 10, displayed_action_count: actions,
        total_action_count: actions + 5, payload_checksum: `c${i}-${p}`, source_as_of: '2026-11-04',
      });
    }
  }
  return out;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  db.rows = generation(); db.seed = 1;
});

describe('validateGeneration page order', () => {
  it('counts every page exactly once: pages, recipients and award rows equal the table', async () => {
    const truthRows = db.rows.reduce((a, r) => a + r.row_count, 0);
    const v = await validateGeneration('2026-11-04-build-test');
    expect(v.ok).toBe(true);
    expect(v.pages).toBe(db.rows.length);
    expect(v.recipients).toBe(6000);
    expect(v.rows).toBe(truthRows);
  });

  it('the validator itself refuses a read that double-reads or skips pages', async () => {
    // Simulate the old, non-total order by collapsing page_number ordering in the fake.
    const orig = db.seed;
    pageOrderDisabled.value = true;
    try {
      const v = await validateGeneration('2026-11-04-build-test');
      expect(v.ok).toBe(false);
      expect(v.failures.join('; ')).toMatch(/page\(s\) read more than once/);
      expect(v.failures.join('; ')).toMatch(/recipient\(s\) with missing pages/);
    } finally {
      pageOrderDisabled.value = false;
      db.seed = orig;
    }
  });

  it('control: ordering by recipient_uei alone double-reads and skips pages on this same data', async () => {
    const supa = createClient('https://x.supabase.co', 'k');
    const res = await readAllPages<Row>(
      () => supa.from('awards_serving_pages').select('*').eq('x', 1).order('recipient_uei') as never,
    );
    const keys = res.rows.map((r) => `${r.recipient_uei}/${r.page_number}`);
    const unique = new Set(keys);
    // Same number of rows read, but not the same rows: some twice, some never.
    expect(keys.length).toBe(db.rows.length);
    expect(unique.size).toBeLessThan(db.rows.length);
  });

  it('the validator orders by recipient_uei THEN page_number', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/awards-refresh.ts', 'utf8');
    expect(src).toMatch(/\.order\('recipient_uei', \{ ascending: true \}\)\s*\.order\('page_number', \{ ascending: true \}\)/);
  });
});

describe('BigQuery cost labels', () => {
  it('the build and the freshness probe are attributed to awards-serving, not "legacy"', async () => {
    const { readFileSync } = await import('node:fs');
    const worker = readFileSync('src/app/api/cron/awards-build-worker/route.ts', 'utf8');
    const lib = readFileSync('src/lib/awards-refresh.ts', 'utf8');
    expect(worker).toMatch(/bqJobOptions\(\{ feature: 'awards-serving', tool: 'awards-build-worker', queryFamily: 'serving-table-build' \}\)\.labels/);
    expect(lib).toMatch(/bqJobOptions\(\{ feature: 'awards-serving', tool: 'awards-refresh', queryFamily: 'freshness-probe' \}\)\.labels/);
  });
});
