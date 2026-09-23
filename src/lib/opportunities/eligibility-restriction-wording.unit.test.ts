/**
 * Eligibility reason wording — a raw YES/NO flag in the set-aside field must never reach a
 * customer as a quoted "restriction". HERMETIC.
 *
 * Seen in production find_opportunities output after #1646:
 *   'The record lists a restriction ("true") that this screen cannot evaluate against the …'
 *
 * Source: agency_forecasts.set_aside_type — measured 2026-09-23 (35,928 rows): "true" 654 ·
 * "True" 82 · "false" 7 · "False" 1, all DHS. The DHS APFS feed's `small_business_set_aside`
 * boolean wins over `small_business_program` at ingest, so "true" = "the agency marked this a
 * small-business set-aside" with the program not on our record. The verdict stays UNKNOWN; only
 * the sentence changes.
 */
import { describe, it, expect } from 'vitest';
import entityFx from './__fixtures__/imi-find/imi-entity.json';
import { transformEntity } from '@/lib/sam/entity-api';
import { anchorFromSamEntity, type CompanyAnchor } from './company-anchor';
import { evaluateEligibility } from './company-eligibility';
import { findOpportunities } from './find-opportunities';
import type { SamEntityResult } from '@/mcp/tools/sam-entity';

type Row = Record<string, unknown>;
const IMI_UEI = 'M66AH329AJM6';
const entity = transformEntity(entityFx.data as Row);
const IMI: CompanyAnchor = anchorFromSamEntity(entity, { source: 'sam_entity_api' });

/** Real prod row (agency_forecasts id 0b5d41d9-…, read 2026-09-23), columns as FIND selects them. */
const DHS_FLAGGED_FORECAST: Row = {
  id: '0b5d41d9-384c-4a59-b51a-36d5abf8f9f8',
  title: '16378146 Major M&R of HVAC in Smith Hall at Air Station Traverse City; Traverse City, MI',
  description: '16378146 Major M&R of HVAC in Smith Hall at Air Station Traverse City; Traverse City, MI',
  department: null,
  source_agency: 'DHS',
  naics_code: '236220',
  naics_description: null,
  set_aside_type: 'true',
  estimated_value_min: 5000000,
  estimated_value_max: 10000000,
  estimated_value_range: '$5M to $10M',
  anticipated_quarter: 'Q4',
  fiscal_year: 'FY2026',
  anticipated_award_date: null,
  solicitation_date: '2026-07-15',
  pop_state: 'MI',
  pop_city: 'Traverse City',
  map_lat: 44.749,
  status: 'Published',
  last_synced_at: '2026-08-13T13:01:03.164+00:00',
  contracting_office: 'USCG/CG-SHORE',
  incumbent_name: null,
};

const RAW_FLAG = /\(\s*"?(true|false|yes|no)"?\s*\)|"(true|false)"/i;
const TRUE_SENTENCE =
  'The agency marks this as a small-business set-aside but does not say which program '
  + '(general small business, 8(a), HUBZone, SDVOSB or WOSB), so eligibility cannot be judged yet.';

/** Same argument mapping find-opportunities.ts eligibilityFor() uses for a forecast row. */
const forecastVerdict = (row: Row) =>
  evaluateEligibility({ set_aside_description: row.set_aside_type as string, naics_code: row.naics_code as string }, IMI, 'forecast');

describe('forecast set-aside flag wording', () => {
  it.each(['true', 'True', 'TRUE', 'yes'])('"%s" → plain small-business sentence, no raw flag, status UNKNOWN', (flag) => {
    const v = forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: flag });
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).not.toMatch(RAW_FLAG);
    expect(v.reason).not.toMatch(/lists a restriction/);
    expect(v.reason.startsWith(TRUE_SENTENCE)).toBe(true);
    // Forecast context suffix is preserved; the verbatim source value stays in the machine basis.
    expect(v.reason).toContain("the agency's anticipated set-aside, not a final solicitation");
    expect(v.basis.set_aside).toBe(flag);
  });

  it.each(['false', 'False', 'no'])('"%s" → not-set-aside sentence, no raw flag, status UNKNOWN', (flag) => {
    const v = forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: flag });
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).not.toMatch(RAW_FLAG);
    expect(v.reason).toMatch(/^The agency marks this as not set aside for small business/);
  });

  it('TBD / To Be Determined → "not decided yet", never quoted as a restriction', () => {
    for (const t of ['TBD', 'To Be Determined']) {
      const v = forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: t });
      expect(v.status).toBe('UNKNOWN');
      expect(v.reason).not.toContain(`"${t}"`);
      expect(v.reason).toMatch(/^The agency has not decided the set-aside yet/);
    }
  });

  it('an unrecognized short code is omitted, not printed', () => {
    const v = evaluateEligibility({ set_aside_code: 'ZQX9', naics_code: '332312' }, IMI, 'notice');
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).not.toContain('ZQX9');
  });

  it('a worded restriction is still quoted (agency language, not a flag) and status unchanged', () => {
    const v = forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: 'Sole Source' });
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).toContain('("Sole Source")');
  });

  it('real set-aside labels keep their existing verdicts (logic untouched)', () => {
    expect(forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: 'None' }).status).toBe('ELIGIBLE');
    expect(forecastVerdict({ ...DHS_FLAGGED_FORECAST, set_aside_type: null }).status).toBe('UNKNOWN');
  });
});

// ── End-to-end: the customer-visible find_opportunities output ────────────────────────────────
function fakeClient(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      builder[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return chain();
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: 0, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as never;
}

const foundLookup = async () => ({ entity, matches: [], queried: { uei: IMI_UEI }, _meta: { grounded: true, degraded: false, match_count: 1, mode: 'uei', source: 'sam_live', lookup_status: 'found' } }) as unknown as SamEntityResult;

describe('find_opportunities (company-anchored) renders the flagged DHS forecast in plain English', () => {
  it('Coming soon item carries the new sentence, no ("true"), status UNKNOWN', async () => {
    const res = await findOpportunities(
      { query: 'HVAC repair', uei: IMI_UEI, limit_per_horizon: 25 },
      { client: fakeClient({ sam_opportunities: [], recompete_opportunities: [], agency_forecasts: [DHS_FLAGGED_FORECAST] }), entityLookup: foundLookup },
    );
    const items = Object.values(res.horizons).flatMap((h) => h.items);
    const item = items.find((i) => (i as Row).id === DHS_FLAGGED_FORECAST.id || /Smith Hall/.test(String((i as Row).title)));
    expect(item, 'the flagged forecast must be recalled so its wording is exercised').toBeDefined();
    expect(item?.eligibility?.status).toBe('UNKNOWN');
    expect(item?.eligibility?.reason.startsWith(TRUE_SENTENCE)).toBe(true);
    expect(JSON.stringify(items.map((i) => i.eligibility?.reason))).not.toMatch(/\(\\?"true\\?"\)/i);
  });
});
