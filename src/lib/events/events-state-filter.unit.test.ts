/**
 * search_federal_events location filter + regional catalog (Eric's launch flow, 2026-11-27: "find me a list of events"
 * must work for every customer). SAM events match on the notice's place of performance, else the buying office's
 * state — never the free-text location. Unknown-location rows are counted, never shown as matches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Ev = { notice_id: string; title: string; event_type: string; event_date: string; event_location: string | null; agency: string };
const h = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  locs: new Map<string, { pop_state: string | null; office_address: { state?: string } | null }>(),
  failLocs: false,
  orFilters: [] as string[],
}));
vi.mock('@/lib/events/event-currency-live', () => ({ loadHiddenRows: async () => [], loadRetiredSourceNoticeIds: async () => [], notInList: () => null }));
vi.mock('@/lib/events/ai-event-discovery', () => ({ searchEventsViaAI: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      let kind: 'attendable' | 'notice' = 'attendable';
      let ids: string[] = [];
      const b: Record<string, unknown> = {
        select: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b, not: () => b,
        in: (col: string, v: string[]) => { if (col === 'notice_id') ids = v; else kind = 'attendable'; return b; },
        or: (f: string) => { h.orFilters.push(f); if (f.includes('event_type.not.in')) kind = 'notice'; return b; },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'sam_opportunities') {
            if (h.failLocs) return resolve({ data: null, error: { message: 'boom' } });
            return resolve({ data: ids.filter((i) => h.locs.has(i)).map((i) => ({ notice_id: i, ...h.locs.get(i) })), error: null });
          }
          const rows = h.events.filter((r) => (r.event_type === 'rfi') === (kind === 'notice'));
          resolve({ data: rows, count: rows.length, error: null });
        },
      };
      return b;
    },
  }),
}));

import { eventStateFor, queryFederalEvents } from './query';
import { regionalEventsForStates, regionalCoverage } from './regional-catalog';
import { searchFederalEvents, resolveEventLocation } from '@/mcp/tools/federal-events';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ev = (id: string, loc: string | null = 'Hartford, CT'): Ev => ({ notice_id: id, title: `Industry day ${id}`, event_type: 'industry_day', event_date: inDays(20), event_location: loc, agency: 'ARMY' });

beforeEach(() => { h.events = []; h.locs.clear(); h.failLocs = false; h.orFilters = []; });

describe('eventStateFor (never the free-text location)', () => {
  it('place of performance first, then the buying office, else unknown', () => {
    expect(eventStateFor({ pop_state: 'ct', office_address: { state: 'MA' } })).toEqual({ state: 'CT', basis: 'place_of_performance' });
    expect(eventStateFor({ pop_state: null, office_address: { state: 'MA' } })).toEqual({ state: 'MA', basis: 'buying_office' });
    expect(eventStateFor({ pop_state: 'Connecticut', office_address: null })).toEqual({ state: null, basis: 'unknown' });
    expect(eventStateFor(undefined)).toEqual({ state: null, basis: 'unknown' });
  });
});

describe('queryFederalEvents with a state filter', () => {
  it('keeps in-state events, drops other states, COUNTS unknown — and works with no agency', async () => {
    h.events = [ev('pop-ct'), ev('office-ct', 'Boston, MA'), ev('ma', 'Hartford, CT'), ev('unknown'), ev('no-row')];
    h.locs.set('pop-ct', { pop_state: 'CT', office_address: { state: 'NY' } });
    h.locs.set('office-ct', { pop_state: null, office_address: { state: 'CT' } });
    h.locs.set('ma', { pop_state: 'MA', office_address: { state: 'CT' } }); // free text says Hartford — ignored
    h.locs.set('unknown', { pop_state: null, office_address: null });
    const res = await queryFederalEvents({ agency: '', states: ['CT'], currentYear: 2026 });
    expect(res.events.map((e) => e.title)).toEqual(['Industry day pop-ct', 'Industry day office-ct']);
    expect(res.events.map((e) => e.state_basis)).toEqual(['place_of_performance', 'buying_office']);
    expect(res.locationFilter).toEqual({
      states: ['CT'], matched: 2, matched_by_place_of_performance: 1, matched_by_buying_office: 1, other_states: 1, location_unknown: 2,
    });
    expect(h.orFilters.some((f) => f.startsWith('agency.ilike'))).toBe(false); // no agency → no agency filter
  });
  it('a failed location lookup: nothing shown as a match, unknown = null (never 0)', async () => {
    h.events = [ev('a')];
    h.failLocs = true;
    const res = await queryFederalEvents({ agency: 'Army', states: ['CT'], currentYear: 2026 });
    expect(res.events).toEqual([]);
    expect(res.locationFilter!.location_unknown).toBeNull();
  });
  it('without a state filter nothing changes (agency path, no location fields)', async () => {
    h.events = [ev('x')];
    const res = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(res.events).toHaveLength(1);
    expect(res.locationFilter).toBeNull();
    expect('state' in res.events[0]).toBe(false);
    expect(res.regional).toEqual([]);
  });
});

describe('regional catalog (official organizer pages only)', () => {
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'src/data/regional-events-catalog.json'), 'utf8'));
  it('every row has name, organizer, https URL, state, kind and an organizer source URL; no AI rows', () => {
    for (const r of cat.rows) {
      expect(r.name && r.organizer && r.state && r.kind).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.verification.source_url).toMatch(/^https:\/\//);
      expect(['matchmaker', 'apex', 'industry_day', 'conference']).toContain(r.kind);
      expect(JSON.stringify(r)).not.toMatch(/ai_web_search|ai-discovered/i);
    }
    expect(cat.covered_states).toEqual([...new Set(cat.rows.map((r: { state: string }) => r.state))].sort());
  });
  it('CT: the matchmaker has no stated next date → "check the organizer page"; APEX shows its stated date', () => {
    const rows = regionalEventsForStates(['CT'], '2026-11-27', '2027-03-27', 'Hartford');
    const mm = rows.find((r) => r.id === 'ct-business-matchmaker')!;
    expect(mm.event_date).toBeNull();
    expect(mm.date_note).toMatch(/Check the organizer page/);
    const apex = rows.find((r) => r.id === 'ct-apex-events')!;
    expect(apex.event_date).toBe('2026-12-02');
    expect(rows[0].event_date).not.toBeNull(); // dated first
    expect(JSON.stringify(rows)).not.toContain('verified_at'); // internal, never returned
  });
  it('a past stated date is never shown as next', () => {
    const apex = regionalEventsForStates(['CT'], '2026-12-05', '2027-04-05').find((r) => r.id === 'ct-apex-events')!;
    expect(apex.event_date).toBeNull();
  });
  it('coverage names covered and uncovered states with the directory fallback', () => {
    expect(regionalCoverage(['ct', 'TX'])).toEqual({ covered: ['CT'], not_covered: ['TX'], fallback: cat.fallback });
  });
});

describe('search_federal_events tool (MCP + Ask Mindy share it)', () => {
  it('resolves state names, lists and "City, ST"; unreadable values are reported, never guessed', () => {
    expect(resolveEventLocation('Connecticut, MA', undefined)).toEqual({ states: ['CT', 'MA'], nearCity: null, ignored: [] });
    expect(resolveEventLocation(undefined, 'Hartford, CT')).toEqual({ states: ['CT'], nearCity: 'Hartford', ignored: [] });
    expect(resolveEventLocation('Narnia', undefined).ignored).toEqual(['Narnia']);
  });
  it('a state-only call (no agency) returns events, regional rows, coverage and the location report', async () => {
    h.events = [ev('pop-ct'), ev('unknown')];
    h.locs.set('pop-ct', { pop_state: 'CT', office_address: null });
    const r = await searchFederalEvents({ near: 'Hartford, CT' });
    expect(r.queried).toMatchObject({ states: ['CT'], near_city: 'Hartford' });
    expect(r.events.map((e) => e.title)).toEqual(['Industry day pop-ct']);
    expect(r.regional_events!.map((e) => e.id).sort()).toEqual(['ct-apex-events', 'ct-business-matchmaker']);
    expect(r.regional_coverage).toMatchObject({ covered: ['CT'], not_covered: [] });
    expect(r._meta.location_filter).toMatchObject({ matched: 1, location_unknown: 1 });
    expect(r._meta.grounded).toBe(true);
  });
  it('parity: the registry schema and the MCP server both expose state + near and agency is optional', () => {
    const reg = readFileSync(join(process.cwd(), 'src/lib/mcp/tool-registry.ts'), 'utf8');
    const def = reg.slice(reg.indexOf('const FEDERAL_EVENTS_TOOL_DEF'), reg.indexOf('const SCAN_COMPLIANCE_TOOL_DEF'));
    expect(def).toMatch(/\bstate: \{/);
    expect(def).toMatch(/\bnear: \{/);
    expect(def).toMatch(/required: \[\]/);
    const srv = readFileSync(join(process.cwd(), 'src/mcp/server.ts'), 'utf8');
    const reg2 = srv.slice(srv.indexOf("'search_federal_events',"), srv.indexOf("'scan_proposal_compliance',"));
    expect(reg2).toMatch(/agency: z\.string\(\)\.optional\(\)/);
    expect(reg2).toMatch(/\bstate: z\./);
    expect(reg2).toMatch(/\bnear: z\./);
    expect(reg2).toMatch(/searchFederalEvents\(\{ agency, state, near,/);
  });
});
