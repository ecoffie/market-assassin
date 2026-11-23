/**
 * "Already awarded to you" — exact rule (forecast-awarded-to-company.ts), FLAG never hide.
 * Real case, production 2026-11-23: FHWA forecast "VA ST FB KNGMN-WLKR GTS" (DOT, GW-L:FHWA-2026-167)
 * was shown to RBA Engineering (UEI C9K6EE9JVDK7) as upcoming, but RBA holds award 693C7326C000017
 * ($7,180,000, action 2026-08-14, FHWA Eastern Federal Lands, description "PROJECT VA ST FB KNGMN-WLKR GTS ...").
 */
import { describe, it, expect } from 'vitest';
import entityFx from './__fixtures__/imi-find/imi-entity.json';
import { transformEntity } from '@/lib/sam/entity-api';
import type { SamEntityResult } from '@/mcp/tools/sam-entity';
import {
  alreadyAwardedFlag,
  awardNamesForecastProject,
  isSpecificForecastTitle,
  sameDepartment,
  type CompanyAwardAction,
  type CompanyAwardsLookup,
} from './forecast-awarded-to-company';
import { findOpportunities } from './find-opportunities';

const RBA_UEI = 'C9K6EE9JVDK7';
const RBA_AWARD: CompanyAwardAction = {
  award_id: 'CONT_AWD_693C7326C000017_6925_-NONE-_-NONE-',
  piid: '693C7326C000017',
  description: 'PROJECT VA ST FB KNGMN-WLKR GTS',
  awarding_agency: 'Department of Transportation',
  awarding_office: 'FHWA EASTERN FEDERAL LANDS',
  action_date: '2026-08-14',
  amount: 7_180_000,
};
const FHWA_FORECAST = { title: 'VA ST FB KNGMN-WLKR GTS', source_agency: 'DOT', department: 'Department of Transportation' };

describe('exact match rule', () => {
  it('flags the real RBA / FHWA pair with PIID and action date', () => {
    const f = alreadyAwardedFlag(FHWA_FORECAST, [RBA_AWARD]);
    expect(f?.label).toBe('already awarded to you (693C7326C000017, 2026-08-14)');
    expect(f?.piid).toBe('693C7326C000017');
    expect(f?.awarding_office).toBe('FHWA EASTERN FEDERAL LANDS');
  });
  it('the identifier may be followed by more text after a non-alphanumeric boundary', () => {
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS', 'PROJECT  va st fb kngmn-wlkr gts, Rockbridge County')).toBe(true);
  });
  it('the WHOLE title must be the identifier — a longer code is a different project', () => {
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS', 'PROJECT VA ST FB KNGMN-WLKR GTS2')).toBe(false);
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS2', 'PROJECT VA ST FB KNGMN-WLKR GTS')).toBe(false);
  });
  it('never on a title appearing mid-description, or without the PROJECT label (no similarity matching)', () => {
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS', 'REPAIRS TO VA ST FB KNGMN-WLKR GTS')).toBe(false);
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS', 'VA ST FB KNGMN-WLKR GTS')).toBe(false);
    expect(awardNamesForecastProject('VA ST FB KNGMN WLKR GTS', 'PROJECT VA ST FB KNGMN-WLKR GTS')).toBe(false);
    expect(awardNamesForecastProject('', 'PROJECT ')).toBe(false);
  });
  it('requires the same department', () => {
    expect(sameDepartment(FHWA_FORECAST, 'Department of Transportation')).toBe(true);
    expect(sameDepartment({ source_agency: 'USDA' }, 'Department of Transportation')).toBe(false);
    expect(alreadyAwardedFlag({ ...FHWA_FORECAST, source_agency: 'USDA', department: 'Department of Agriculture' }, [RBA_AWARD])).toBeNull();
    expect(sameDepartment({ source_agency: null, department: 'Department of Transportation' }, 'DEPARTMENT OF TRANSPORTATION')).toBe(true);
    expect(sameDepartment(FHWA_FORECAST, null)).toBe(false);
  });
  it('several actions on the matching award → the earliest action date', () => {
    const mod = { ...RBA_AWARD, action_date: '2026-10-01' };
    expect(alreadyAwardedFlag(FHWA_FORECAST, [mod, RBA_AWARD])?.action_date).toBe('2026-08-14');
  });
});

describe('find_opportunities coming_soon — company-anchored flag', () => {
  type Row = Record<string, unknown>;
  function client(tables: Record<string, Row[]>) {
    const make = (table: string) => {
      let head = false;
      const rows = tables[table] || [];
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
        b[m] = (...args: unknown[]) => {
          if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown) => resolve(head ? { data: null, count: 0, error: null } : { data: rows, count: rows.length, error: null });
      return b;
    };
    return { from: (t: string) => make(t) } as never;
  }
  const fc = (id: string, title: string): Row => ({
    id, external_id: `GW-L:${id}`, title, description: `${title} highway bridge construction`, department: 'Department of Transportation', source_agency: 'DOT',
    naics_code: '237310', naics_description: 'HIGHWAY, STREET, AND BRIDGE CONSTRUCTION', set_aside_type: null, estimated_value_min: null,
    estimated_value_max: null, estimated_value_range: null, anticipated_quarter: null, fiscal_year: 2099, anticipated_award_date: null,
    solicitation_date: null, pop_state: 'VA', pop_city: null, map_lat: 1, status: 'active', last_synced_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-20T00:00:00Z', source_url: null, contracting_office: null, incumbent_name: null,
  });
  const KNGMN = fc('FHWA-2026-167', 'VA ST FB KNGMN-WLKR GTS');
  const OTHER = fc('FHWA-2026-200', 'VA BLUE RIDGE PKWY MP 120');
  const tables = { sam_opportunities: [], recompete_opportunities: [], agency_forecasts: [KNGMN, OTHER] };
  // A stand-in registration (fixture entity) resolved under RBA's UEI: the anchor only has to resolve.
  const entityLookup = async () => ({ entity: transformEntity(entityFx.data as Row), matches: [], queried: { uei: RBA_UEI }, _meta: { grounded: true, degraded: false, match_count: 1, mode: 'uei', source: 'sam_live', lookup_status: 'found' } }) as unknown as SamEntityResult;
  const q = { query: 'highway bridge construction', uei: RBA_UEI, limit_per_horizon: 25 };

  it('flags (never hides) the forecast RBA already holds; the other row is untouched', async () => {
    const seen: string[] = [];
    const companyAwardsLookup: CompanyAwardsLookup = async (uei) => { seen.push(uei); return { status: 'checked', awards: [RBA_AWARD], note: 'checked 1' }; };
    const res = await findOpportunities(q, { client: client(tables), entityLookup, competitionLookup: null, companyAwardsLookup });
    const soon = res.horizons.coming_soon;
    expect(seen).toEqual([RBA_UEI]);
    expect(soon.items).toHaveLength(2);
    const byTitle = new Map(soon.items.map((i) => [i.title, i]));
    expect((byTitle.get('VA ST FB KNGMN-WLKR GTS')?.already_awarded_to_company as { label: string }).label)
      .toBe('already awarded to you (693C7326C000017, 2026-08-14)');
    expect(byTitle.get('VA BLUE RIDGE PKWY MP 120')).not.toHaveProperty('already_awarded_to_company');
    expect(soon.company_award_check).toMatchObject({ status: 'checked', flagged: 1 });
    expect(res.presentation.host_rules.some((r) => r.startsWith('ALREADY AWARDED'))).toBe(true);
  });
  it('awards unavailable → nothing flagged and the check says unavailable (not "not awarded")', async () => {
    const res = await findOpportunities(q, { client: client(tables), entityLookup, competitionLookup: null, companyAwardsLookup: async () => ({ status: 'unavailable', awards: [], note: 'not cached' }) });
    expect(res.horizons.coming_soon.items.some((i) => 'already_awarded_to_company' in i)).toBe(false);
    expect(res.horizons.coming_soon.company_award_check).toMatchObject({ status: 'unavailable', flagged: 0 });
  });
  it('no UEI → no awards lookup, no check field', async () => {
    let called = false;
    const res = await findOpportunities({ query: q.query, limit_per_horizon: 25 }, { client: client(tables), competitionLookup: null, companyAwardsLookup: async () => { called = true; return { status: 'checked', awards: [RBA_AWARD], note: '' }; } });
    expect(called).toBe(false);
    expect(res.horizons.coming_soon.company_award_check).toBeUndefined();
  });
});

describe('only a SPECIFIC forecast title can be "already awarded to you" (Agent 4 review 2026-11-23)', () => {
  const FHWA = 'Department of Transportation';
  it('generic titles never flag, even with a matching PROJECT award from the same department', () => {
    expect(isSpecificForecastTitle('Road Maintenance')).toBe(false);
    expect(isSpecificForecastTitle('Construction Services')).toBe(false);
    expect(isSpecificForecastTitle('Road Maintenance Repair Services')).toBe(false); // 4 tokens, all generic
    expect(awardNamesForecastProject('Road Maintenance', 'PROJECT ROAD MAINTENANCE ON PARKWAY')).toBe(false);
    expect(awardNamesForecastProject('Construction Services', 'PROJECT CONSTRUCTION SERVICES')).toBe(false);
    expect(alreadyAwardedFlag(
      { title: 'Road Maintenance', source_agency: 'DOT' },
      [{ piid: 'X1', award_id: 'A1', awarding_agency: FHWA, description: 'PROJECT ROAD MAINTENANCE ON PARKWAY', action_date: '2026-01-01', amount: 1 }] as never,
    )).toBeNull();
  });
  it('the real Kingman-Walker title is specific and still flags', () => {
    expect(isSpecificForecastTitle('VA ST FB KNGMN-WLKR GTS')).toBe(true);
    expect(awardNamesForecastProject('VA ST FB KNGMN-WLKR GTS', 'PROJECT VA ST FB KNGMN-WLKR GTS THE PROJECT CONSISTS OF GEOMETRIC ROAD IMPROVEMENTS')).toBe(true);
  });
});
