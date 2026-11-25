/**
 * Open-now timeout retry (Agent 4, from Eric's EFS Digital Claude + Mindy run, 2026-11-25): a long query failed
 * outright with search_too_long. The cost is regex clauses × text columns, and sow_text is the large column. On a
 * statement timeout FIND now re-runs the SAME plan over fewer text columns and names what it skipped; it never
 * returns the failure while a narrower search can answer, and never a silent zero.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPlan, contextFor, MCP_POLICY, OPEN_TEXT_COLS } from '@/lib/discovery';
import { findOpportunities, OPEN_TIMEOUT_RETRY_COLUMNS } from './find-opportunities';

const LONG = 'We are a woman-owned advertising and digital marketing agency providing SEO, social media, branding, video production, website design and public outreach campaigns';
const TIMEOUT = { data: null, count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
const ROW = {
  notice_id: 'n1', title: 'Public outreach and advertising campaign support', department: 'HOMELAND SECURITY, DEPARTMENT OF',
  naics_code: '541810', psc_code: 'R708', description: 'advertising', notice_type: 'Solicitation',
  response_deadline: '2099-01-01', ui_link: 'https://sam.gov/opp/n1', pop_state: 'CT', updated_at: '2026-11-20T00:00:00Z',
};

/** A fake whose Open-now fetch times out whenever its predicate still reads `timeoutCol`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function client(timeoutCols: string[]): any {
  const make = (table: string) => {
    const ors: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, {
      get: (_t, k) => {
        if (k === 'then') {
          return (res: (v: unknown) => unknown) => {
            if (table !== 'sam_opportunities') return res({ data: [], count: 0, error: null });
            const text = ors.join(' ');
            if (timeoutCols.some((c) => text.includes(`${c}.imatch`) || text.includes(`${c}.match`))) return res(TIMEOUT);
            return res({ data: [ROW], count: 1, error: null });
          };
        }
        if (k === 'or') return (e: string) => { ors.push(String(e)); return chain; };
        return () => chain;
      },
      apply: () => chain,
    });
    return chain;
  };
  return { from: (t: string) => make(t), rpc: () => make('rpc') };
}
const OPEN_ONLY = { open_now: true, coming_back: false, coming_soon: false };

describe('Open now: a statement timeout re-runs over fewer text columns', () => {
  it('the ladder drops the statement of work first, then the description', () => {
    expect(OPEN_TEXT_COLS).toContain('sow_text');
    expect(OPEN_TIMEOUT_RETRY_COLUMNS[0]).not.toContain('sow_text');
    expect(OPEN_TIMEOUT_RETRY_COLUMNS[1]).not.toContain('description');
    expect(OPEN_TIMEOUT_RETRY_COLUMNS.every((c) => c.includes('title'))).toBe(true);
  });

  it('timeout over sow_text → answered over title/description, and the skipped column is named', async () => {
    const r = await findOpportunities({ query: LONG, limit_per_horizon: 5, horizons: OPEN_ONLY }, { client: client(['sow_text']) });
    const h = r.horizons.open_now;
    expect(h.error).toBeNull();
    expect(h.items.map((i) => i.notice_id)).toContain('n1');
    expect(h.narrowed_search).toEqual({ searched_columns: [...OPEN_TIMEOUT_RETRY_COLUMNS[0]], skipped_columns: ['sow_text'], reason: 'statement_timeout' });
    expect(h.semantics_note).toMatch(/too long to finish.*sow_text was not searched/);
  });

  it('timeout over the description too → the title step answers and names both skipped columns', async () => {
    const r = await findOpportunities({ query: LONG, limit_per_horizon: 5, horizons: OPEN_ONLY }, { client: client(['sow_text', 'description']) });
    const h = r.horizons.open_now;
    expect(h.error).toBeNull();
    expect(h.narrowed_search?.searched_columns).toEqual([...OPEN_TIMEOUT_RETRY_COLUMNS[1]]);
    expect(h.narrowed_search?.skipped_columns).toEqual(['description', 'sow_text']);
  });

  it('a search that answers first time is untouched (no narrowed_search, normal plan)', async () => {
    const r = await findOpportunities({ query: LONG, limit_per_horizon: 5, horizons: OPEN_ONLY }, { client: client([]) });
    expect(r.horizons.open_now.narrowed_search).toBeUndefined();
  });

  it('the narrowed plan changes ONLY the Open text columns; recompete and forecast are identical', () => {
    const input = { query: LONG };
    const full = buildDiscoveryPlan(input, MCP_POLICY, contextFor(new Date('2026-11-25T00:00:00Z')));
    const narrow = buildDiscoveryPlan(input, MCP_POLICY, { ...contextFor(new Date('2026-11-25T00:00:00Z')), openTextCols: OPEN_TIMEOUT_RETRY_COLUMNS[0] });
    expect(narrow.horizons.recompete).toEqual(full.horizons.recompete);
    expect(narrow.horizons.forecast).toEqual(full.horizons.forecast);
    expect(JSON.stringify(full.horizons.open.ops)).toContain('sow_text');
    expect(JSON.stringify(narrow.horizons.open.ops)).not.toContain('sow_text');
  });
});
