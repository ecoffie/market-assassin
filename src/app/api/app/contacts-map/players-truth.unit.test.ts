/**
 * Players repair (2026-10-04): geography goes INTO the query (filter → rank), and a failure is
 * `unavailable` with a null count — never 0 Players, never sales copy. Audit:
 * tasks/players-naics-coverage-audit-2026-10-04.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const searchRecipients = vi.fn();
vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));
vi.mock('@/lib/players/telemetry', () => ({ recordPlayersResult: vi.fn(async () => {}) }));
vi.mock('@/lib/bigquery/recipients', () => ({
  searchRecipients: (...a: unknown[]) => searchRecipients(...a),
  getSetAsidesForRecipients: vi.fn(async () => new Map()),
  SET_ASIDE_BUCKET_LABEL: {},
}));

const row = (uei: string, city: string, state: string) => ({
  recipient_uei: uei, recipient_name: uei, city, state, total_obligated: 1e6, award_count: 3,
  distinct_agency_count: 1, distinct_naics_count: 0,
});

async function call(qs: string) {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/api/app/contacts-map?${qs}`));
  return { http: res.status, body: await res.json() };
}

beforeEach(() => { searchRecipients.mockReset(); });

describe('contacts-map Players — geography before rank', () => {
  it('a zoomed-in Texas viewport sends TX + the visible cities INTO searchRecipients', async () => {
    searchRecipients.mockResolvedValue({ rows: [row('A', 'AUSTIN', 'TX')], total: 1, status: 'success_nonzero', coverage: { source: 'players_canonical' } });
    const { body } = await call('bbox=-98.0,30.1,-97.5,30.5&type=companies&naics=541512');
    const tx = searchRecipients.mock.calls.map((c) => c[0]).find((a) => a.state === 'TX');
    expect(tx).toBeTruthy();
    expect(tx.naics).toBe('541512');
    expect(tx.geo.cities).toContain('AUSTIN');
    expect(tx.geo.cities).not.toContain('HOUSTON');
    expect(body.status).toBe('success_nonzero');
    expect(body.geo.level).toBe('city');
  });
});

describe('contacts-map Players — truth states', () => {
  it('a swallowed BigQuery failure is unavailable with a NULL count, not 0', async () => {
    searchRecipients.mockResolvedValue({ rows: [], total: 0, status: 'unavailable', coverage: { source: 'players_canonical' } });
    const { body } = await call('bbox=-106.7,25.8,-93.5,36.5&type=companies&naics=541512&state=TX');
    expect(body.status).toBe('unavailable');
    expect(body.totalForFilters).toBeNull();
  });
  it('a thrown error is a 500 marked unavailable', async () => {
    searchRecipients.mockRejectedValue(new Error('Custom quota exceeded'));
    const { http, body } = await call('bbox=-106.7,25.8,-93.5,36.5&type=companies&naics=541512&state=TX');
    expect(http).toBe(500);
    expect(body.status).toBe('unavailable');
  });
  it('the legacy top-50 source is a floor with its reason', async () => {
    searchRecipients.mockResolvedValue({ rows: [], total: 0, status: 'coverage_incomplete', coverage: { source: 'top50_rollup', incompleteReason: 'Only the 50 largest firms nationally per NAICS' } });
    const { body } = await call('bbox=-106.7,25.8,-93.5,36.5&type=companies&naics=541512&state=TX');
    expect(body.status).toBe('coverage_incomplete');
    expect(body.totalIsFloor).toBe(true);
    expect(body.coverage.incompleteReason).toContain('50 largest');
  });
  it('a complete-population zero is success_zero', async () => {
    searchRecipients.mockResolvedValue({ rows: [], total: 0, status: 'success_zero', coverage: { source: 'players_canonical' } });
    const { body } = await call('bbox=-106.7,25.8,-93.5,36.5&type=companies&naics=999999&state=TX');
    expect(body.status).toBe('success_zero');
    expect(body.totalForFilters).toBe(0);
  });
});

describe('Maps client — errors never render as 0 or sales copy', () => {
  const map = readFileSync(join(__dirname, '../../../opportunity-map/route.ts'), 'utf8');
  it('only a 401/403 counts as denied (the gate copy); everything else is unavailable', () => {
    expect(map).toContain("var denied=(r.status===401||r.status===403);");
    expect(map).toContain("if(!d||!d.success) return {t:t,pins:[],total:null,status:'unavailable'};");
    expect(map).toContain('if(merged.length===0 && _anyDenied && _allDenied)');
  });
  it('an unavailable/denied-only answer shows the retry state, and chips show ? not 0', () => {
    expect(map).toContain("p.status==='unavailable'||p.status==='denied'");
    expect(map).toContain('_showFetchError()');
    expect(map).toMatch(/_st\.status==='unavailable'\)\|\|T\[t\]==null \? '\?'/);
  });
  it('the header copy is the unit-tested playersHeaderText, injected verbatim', () => {
    expect(map).toContain('window.__playersHeaderText=${PLAYERS_HEADER_TEXT_JS}');
  });
});
