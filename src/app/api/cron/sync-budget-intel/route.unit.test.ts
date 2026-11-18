/**
 * Deployed ahead of the migration, this route must not fetch, write, or 500.
 * The dispatcher does not call it until the migration inserts the cron row.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const report = vi.fn(async () => undefined);
const fetchSlice = vi.fn();

vi.mock('@/lib/cron-self-report', () => ({
  reportCronOutcome: (...args: unknown[]) => report(...args),
}));

vi.mock('@/lib/budget-intel/fetch', () => ({
  fetchBudgetSlice: (...args: unknown[]) => fetchSlice(...args),
  BudgetSourceDown: class BudgetSourceDown extends Error {},
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({
          data: null,
          error: { message: 'Could not find the source_key column of agency_budget_authority in the schema cache' },
        }),
      }),
    }),
  }),
}));

import { GET } from './route';

describe('sync-budget-intel before the migration', () => {
  beforeEach(() => {
    report.mockClear();
    fetchSlice.mockClear();
  });

  it('degrades without fetching or writing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/sync-budget-intel'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ degraded: true, wrote: false, reason: 'migration_not_applied' });
    expect(fetchSlice).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('is not on the Vercel cron list; the job row lives only in the unapplied migration', () => {
    expect(readFileSync('vercel.json', 'utf8')).not.toContain('sync-budget-intel');
    const sql = readFileSync('supabase/migrations/20261118_budget_intel_usaspending_acquire.sql', 'utf8');
    expect(sql).toContain("'sync-budget-intel'");
    expect(sql).toContain('NOT APPLIED');
  });
});
