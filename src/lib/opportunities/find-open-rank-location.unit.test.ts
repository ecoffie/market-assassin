/**
 * Open-now ranking by WHERE the match is (Agent 4, from Eric's EFS Digital Claude + Mindy run, 2026-11-25).
 * Production "advertising, marketing": ranks 3–10 were vehicle marshalling, email retention, Saudi fuel and door
 * hardware, notices that mention "marketing" only in the body, ahead of real advertising work, because body-only
 * DIRECT rows tied with title hits and sow-only rows scored 0 and fell to deadline order.
 * Ranking only: the same rows are returned, none admitted or dropped.
 */
import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';

type Row = Record<string, unknown>;
const notice = (id: string, title: string, description: string, deadline: string, extra: Row = {}): Row => ({
  notice_id: id, title, description, department: 'GENERAL SERVICES ADMINISTRATION', naics_code: '811111', psc_code: 'R610',
  notice_type: 'Sources Sought', response_deadline: deadline, ui_link: `https://sam.gov/opp/${id}`, pop_state: 'VA', updated_at: '2026-11-20T00:00:00Z', ...extra,
});
// Fetch order = deadline ascending, exactly as the production window arrives.
const ROWS: Row[] = [
  notice('sow-only', 'GSA Fleet Lease Vehicle Marshalling Services', 'Marshalling of leased vehicles at the lot.', '2026-11-25'),
  notice('desc-only', 'Enterprise Inbound Email Retention and Forensic Analysis Solution', 'Retains inbound email including marketing messages for forensics.', '2026-11-26'),
  notice('title-hit', 'Recruitment Advertising and Employer Branding Services', 'Recruitment campaigns.', '2026-12-03', { naics_code: '541810', psc_code: 'R701' }),
  notice('title-hit-2', 'Public Outreach Marketing Campaign', 'Outreach.', '2027-01-15', { naics_code: '541613' }),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function client(rows: Row[]): any {
  const make = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, {
      get: (_t, k) => (k === 'then'
        ? (res: (v: unknown) => unknown) => res(table === 'sam_opportunities' ? { data: rows, count: rows.length, error: null } : { data: [], count: 0, error: null })
        : () => chain),
      apply: () => chain,
    });
    return chain;
  };
  return { from: (t: string) => make(t), rpc: () => make('rpc') };
}

describe('Open now ranks title/code hits above body-only mentions', () => {
  it('"advertising, marketing": title hits first, then the description mention, then the sow-only row', async () => {
    const r = await findOpportunities({ query: 'advertising, marketing', limit_per_horizon: 10, horizons: { open_now: true, coming_back: false, coming_soon: false } }, { client: client(ROWS) });
    const items = r.horizons.open_now.items;
    expect(items.map((i) => i.notice_id)).toEqual(['title-hit', 'title-hit-2', 'desc-only', 'sow-only']);
    expect(items.map((i) => i.match_location)).toEqual(['title', 'title', 'description', undefined]);
    // The SOW-only row is not DIRECT at all (its visible text never mentions the words): already a lower tier.
    expect(items[3].evidence_class).not.toBe('DIRECT_MATCH');
  });
  it('body-only rows say so in plain words; title rows keep the normal explanation', async () => {
    const r = await findOpportunities({ query: 'advertising, marketing', limit_per_horizon: 10, horizons: { open_now: true, coming_back: false, coming_soon: false } }, { client: client(ROWS) });
    const by = new Map(r.horizons.open_now.items.map((i) => [i.notice_id, i.why_this_matched]));
    expect(by.get('desc-only')).toMatch(/only in the notice description.*not confirmed core demand/);
    expect(by.get('title-hit')).not.toMatch(/passing mention/);
    expect(r.presentation.host_rules.some((h) => h.startsWith('BODY-ONLY'))).toBe(true);
  });
  it('ranking only: the same rows, the same evidence labels', async () => {
    const r = await findOpportunities({ query: 'advertising, marketing', limit_per_horizon: 10, horizons: { open_now: true, coming_back: false, coming_soon: false } }, { client: client(ROWS) });
    expect(r.horizons.open_now.items).toHaveLength(4);
    expect(r.horizons.open_now.evidence_counts?.DIRECT_MATCH).toBe(3);
  });
  it('a DIRECT row admitted by a column the labeller sees but the title/description do not → statement_of_work tier', async () => {
    const { openMatchLocation } = await import('./find-opportunities');
    const { buildDiscoveryPlan, MCP_POLICY } = await import('@/lib/discovery');
    const plan = buildDiscoveryPlan({ query: 'advertising, marketing' }, MCP_POLICY);
    const label = { cls: 'DIRECT_MATCH', basis: ['buy_side_text'], tier: 0 } as never;
    expect(openMatchLocation({ title: 'Vehicle marshalling', description: 'Lot services' }, plan, label)).toBe('statement_of_work');
    expect(openMatchLocation({ title: 'x', description: 'y' }, plan, { cls: 'DIRECT_MATCH', basis: ['buy_side_code'], tier: 0 } as never)).toBe('codes');
    expect(openMatchLocation({ title: 'Marketing support', description: '' }, plan, { cls: 'RELATED_MARKET_CANDIDATE', basis: [], tier: 1 } as never)).toBeNull();
  });
});
