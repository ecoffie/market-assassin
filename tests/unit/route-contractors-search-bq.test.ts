import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-integration test for GET /api/contractors/search-bq — the Contractors
 * panel's data source. Bugs here are what the user sees when they open the panel
 * (memory: authed_fetch_401_class traced the click error; this route itself has
 * no auth but DOES shape BQ rows + clamp params + swallow errors into a 500).
 *
 * BigQuery is mocked — these tests assert the ROUTE's own logic (shaping, param
 * handling, error path), fast + deterministic, never touching real BQ.
 */

vi.mock('@/lib/bigquery/recipients');
import { searchRecipients, recipientSlug } from '@/lib/bigquery/recipients';
import { GET } from '@/app/api/contractors/search-bq/route';

const ROW = {
  recipient_uei: 'ABC123',
  recipient_name: 'ACME CORP',
  city: 'MIAMI',
  state: 'FL',
  total_obligated: 1_000_000,
  award_count: 42,
  distinct_agency_count: 3,
  distinct_naics_count: 5,
};

beforeEach(() => {
  vi.clearAllMocks(); // reset call history so mock.calls[0] is THIS test's call
  vi.mocked(recipientSlug).mockImplementation((n: string) => n.toLowerCase().replace(/\s+/g, '-'));
  vi.mocked(searchRecipients).mockResolvedValue({ rows: [ROW], total: 1 } as any);
});

function call(qs: string) {
  return GET(new NextRequest(`http://localhost/api/contractors/search-bq?${qs}`));
}

describe('search-bq — happy path shaping', () => {
  it('maps BQ recipient rows to the panel contractor model', async () => {
    const body = await (await call('search=acme&limit=5')).json();
    expect(body.success).toBe(true);
    expect(body.source).toBe('bigquery_recipients');
    const c = body.contractors[0];
    expect(c.company).toBe('ACME CORP');       // recipient_name → company
    expect(c.uei).toBe('ABC123');
    expect(c.total_contract_value).toBe(1_000_000);
    expect(c.contract_count).toBe(42);
    expect(c.slug).toBe('acme-corp');          // canonical slug for /contractors/[slug]
    expect(c.source).toBe('usaspending');
  });

  it('reports totalCount/filteredCount from BQ (the 317K headline stat)', async () => {
    vi.mocked(searchRecipients).mockResolvedValue({ rows: [ROW], total: 317_106 } as any);
    const body = await (await call('limit=1')).json();
    expect(body.totalCount).toBe(317_106);
    expect(body.filteredCount).toBe(317_106);
    expect(body.count).toBe(1); // rows actually returned
  });
});

describe('search-bq — param handling', () => {
  it('clamps limit to 100 max', async () => {
    await call('limit=9999');
    expect(vi.mocked(searchRecipients).mock.calls[0][0]).toMatchObject({ limit: 100 });
  });

  it('floors offset at 0 (no negative offset reaches BQ)', async () => {
    await call('offset=-50');
    expect(vi.mocked(searchRecipients).mock.calls[0][0]).toMatchObject({ offset: 0 });
  });

  it('maps the panel sortBy key to the BQ sort key', async () => {
    await call('sortBy=contract_count');
    expect(vi.mocked(searchRecipients).mock.calls[0][0]).toMatchObject({ sortBy: 'award_count' });
  });

  it('defaults to total_obligated sort for an unknown sortBy', async () => {
    await call('sortBy=banana');
    expect(vi.mocked(searchRecipients).mock.calls[0][0]).toMatchObject({ sortBy: 'total_obligated' });
  });

  it('always requests live BQ (the fix for the panel-shows-nothing bug)', async () => {
    await call('search=acme');
    expect(vi.mocked(searchRecipients).mock.calls[0][0]).toMatchObject({ liveBq: true });
  });

  it('locationAvailable=false when a NAICS filter is used (rollup has no location)', async () => {
    const body = await (await call('naics=541512')).json();
    expect(body.locationAvailable).toBe(false);
  });

  it('locationAvailable=true for a name search (has city/state)', async () => {
    const body = await (await call('search=acme')).json();
    expect(body.locationAvailable).toBe(true);
  });
});

describe('search-bq — error path', () => {
  it('returns a 500 with {success:false} when BQ throws (never leaks the stack)', async () => {
    // The route console.error's the failure (correct server behavior) — silence it
    // here so the expected error doesn't clutter the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(searchRecipients).mockRejectedValue(new Error('BQ exploded'));
    const res = await call('search=acme');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Contractor search failed');
    expect(JSON.stringify(body)).not.toContain('BQ exploded'); // no internal detail leaked
  });
});
