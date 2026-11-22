/**
 * Related OPEN opportunities on /opportunity/[slug] (2026-11-21).
 *
 * Production: the NAICS-scope read hit the statement timeout (1,725 events / 24h) because the
 * thin gate ran in SQL as a 200-wildcard LIKE over every candidate's large description, and on
 * that error the function returned null — so the department scope was never tried and the page
 * dropped the whole related-links block.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  pages: [] as Array<{ data: unknown[] | null; error: { message: string } | null }>,
  calls: [] as string[][],
}));

// A PostgREST-shaped fake: records every filter per request, returns queued responses.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const filters: string[] = [];
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'neq', 'gte', 'like', 'or', 'order']) {
        q[f] = (...a: unknown[]) => { filters.push(`${f}:${a.map(String).join('|')}`); return q; };
      }
      q.limit = (n: number) => {
        m.calls.push([...filters, `limit:${n}`]);
        return Promise.resolve(m.pages.shift() ?? { data: [], error: null });
      };
      return q;
    },
  }),
}));

import { getRelatedOpenOpportunities, RELATED_WINDOW_DAYS } from './opportunities';

const NOW = new Date('2026-11-21T12:00:00Z');
const OPP = { noticeId: 'SELF', naicsCode: '332722', department: 'DEPT OF DEFENSE' };
const row = (i: number, extra: Record<string, unknown> = {}) => ({
  notice_id: `R${i}abcdefgh`, title: `Bolt, shoulder ${i}`, description: 'x'.repeat(250),
  department: 'DEPT OF DEFENSE', notice_type: 'Solicitation', response_deadline: '2026-12-20T00:00:00Z',
  naics_code: '332722', ...extra,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.pages = [];
  m.calls = [];
});

describe('getRelatedOpenOpportunities', () => {
  it('a NAICS-scope timeout falls through to the department scope instead of dropping the block', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.pages = [
      { data: null, error: { message: 'canceling statement due to statement timeout' } },
      { data: [row(1), row(2)], error: null },
    ];
    const r = await getRelatedOpenOpportunities(OPP, 6, NOW);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]).toContain('eq:department|DEPT OF DEFENSE');
    expect(r?.scope).toBe('agency');
    expect(r?.items.map((x) => x.title)).toEqual(['Bolt, shoulder 1', 'Bolt, shoulder 2']);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('related-open (naics) read failed'), expect.any(String));
    err.mockRestore();
  });

  it('both scopes failing still renders no block (null), never a "none found" list', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.pages = [{ data: null, error: { message: 'timeout' } }, { data: null, error: { message: 'timeout' } }];
    expect(await getRelatedOpenOpportunities(OPP, 6, NOW)).toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('the query no longer scans descriptions with a LIKE, and is bounded by a posted_date window', async () => {
    m.pages = [{ data: [row(1)], error: null }];
    await getRelatedOpenOpportunities(OPP, 6, NOW);
    const f = m.calls[0];
    expect(f.some((x) => x.startsWith('like:description'))).toBe(false);
    expect(f).toContain('like:title|________*'); // the cheap title gate stays in SQL
    const floor = new Date(NOW.getTime() - RELATED_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(f).toContain(`gte:posted_date|${floor}`);
    expect(f).toEqual(expect.arrayContaining([
      'eq:active|true', 'eq:naics_code|332722', 'neq:notice_id|SELF',
      'or:response_deadline.gte.2026-11-21,response_deadline.is.null',
      'or:notice_type.is.null,notice_type.not.ilike.*award*',
    ]));
    expect(f[0]).toContain('description'); // selected for the in-JS thin gate
    expect(f[f.length - 1]).toBe('limit:24'); // over-fetch so the JS gates still fill 6
  });

  it('thin descriptions are filtered in JS, so a related link never points at a 404 page', async () => {
    m.pages = [{
      data: [row(1, { description: 'short' }), row(2, { description: null }), row(3), row(4, { description: ` ${'y'.repeat(199)} ` })],
      error: null,
    }];
    const r = await getRelatedOpenOpportunities(OPP, 6, NOW);
    expect(r?.scope).toBe('naics');
    expect(r?.items.map((x) => x.title)).toEqual(['Bolt, shoulder 3']);
  });

  it('a NAICS scope with only thin rows falls through to the department scope', async () => {
    m.pages = [
      { data: [row(1, { description: 'short' })], error: null },
      { data: [row(2)], error: null },
    ];
    const r = await getRelatedOpenOpportunities(OPP, 6, NOW);
    expect(r?.scope).toBe('agency');
    expect(r?.items).toHaveLength(1);
  });

  it('call site: the opportunity page renders the block from this result and only when non-null', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/opportunity/[slug]/page.tsx'), 'utf8');
    expect(page).toContain('const related = await getRelatedOpenOpportunities(opp);');
    expect(page).toContain('{related && (');
    expect(page).toContain("related.scope === 'naics'");
    expect(page).toContain('related.items.map(');
  });
});
