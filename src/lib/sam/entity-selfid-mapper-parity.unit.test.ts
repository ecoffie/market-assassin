/**
 * Live `transformEntity` must read SAM self-identification codes and the
 * goodsAndServices.primaryNaics string. TRAINING CENTER PROS INC
 * (NB2RPSSAB614) already carries QF/A5 and primary 332999 in the live
 * payload — the old mapper dropped all three.
 *
 * Inject-red / fix-green: `legacyTransformEntity` pins the hole.
 * Production `transformEntity` must pass the same assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => mockFrom(t) }),
}));

const { transformEntity } = await import('./entity-api');
const { localEntityByUEI } = await import('./entity-local-fallback');

/** Minimized live cached payload (2026-09-08) — TRAINING CENTER PROS INC. */
const TCP_LIVE: Record<string, unknown> = {
  entityRegistration: {
    ueiSAM: 'NB2RPSSAB614',
    cageCode: '6VW15',
    legalBusinessName: 'TRAINING CENTER PROS INC',
    dbaName: 'EOD GEAR',
    registrationStatus: 'Active',
    registrationExpirationDate: '2027-08-24',
  },
  coreData: {
    businessTypes: {
      businessTypeList: [
        { businessTypeCode: 'F', businessTypeDesc: 'Manufacturer of Goods' },
        { businessTypeCode: '2X', businessTypeDesc: 'For-Profit Organization' },
        { businessTypeCode: 'A5', businessTypeDesc: 'Veteran-Owned Business' },
        { businessTypeCode: 'QF', businessTypeDesc: 'Service-Disabled Veteran-Owned Business' },
      ],
      sbaBusinessTypeList: [
        { sbaBusinessTypeCode: null, sbaBusinessTypeDesc: null },
      ],
    },
  },
  assertions: {
    goodsAndServices: {
      primaryNaics: '332999',
      naicsList: [
        { naicsCode: '221112', naicsDescription: 'Fossil Fuel Electric Power Generation' },
        { naicsCode: '332999', naicsDescription: 'All Other Miscellaneous Fabricated Metal Product Manufacturing' },
        { naicsCode: '541512', naicsDescription: 'Computer Systems Design Services' },
      ],
    },
  },
};

/** Booz Allen — For-Profit + Manufacturer only. Control: 2X/F must not become 8(a) or SDVOSB. */
const BOOZ_LIVE: Record<string, unknown> = {
  entityRegistration: {
    ueiSAM: 'JCBMLGPE6Z71',
    legalBusinessName: 'BOOZ ALLEN HAMILTON INC',
    registrationStatus: 'Active',
    registrationExpirationDate: '2027-04-09',
  },
  coreData: {
    businessTypes: {
      businessTypeList: [
        { businessTypeCode: '2X', businessTypeDesc: 'For-Profit Organization' },
        { businessTypeCode: 'F', businessTypeDesc: 'Manufacturer of Goods' },
      ],
      sbaBusinessTypeList: [],
    },
  },
  assertions: {
    goodsAndServices: {
      primaryNaics: '541512',
      naicsList: [
        { naicsCode: '541512', naicsDescription: 'Computer Systems Design Services' },
      ],
    },
  },
};

/** North Star — SBA-certified 8(a)/HUBZone/WOSB; self-id 8W/A2; no QF. */
const NORTH_STAR_LIVE: Record<string, unknown> = {
  entityRegistration: {
    ueiSAM: 'FCJCDUZV7RM3',
    legalBusinessName: 'NORTH STAR GOVERNMENT SERVICES',
    registrationStatus: 'Active',
    registrationExpirationDate: '2027-03-10',
  },
  coreData: {
    businessTypes: {
      businessTypeList: [
        { businessTypeCode: '27', businessTypeDesc: 'Self Certified Small Disadvantaged Business' },
        { businessTypeCode: '2X', businessTypeDesc: 'For-Profit Organization' },
        { businessTypeCode: '8W', businessTypeDesc: 'Woman-Owned Small Business' },
        { businessTypeCode: 'A2', businessTypeDesc: 'Woman-Owned Business' },
        { businessTypeCode: 'F', businessTypeDesc: 'Manufacturer of Goods' },
        { businessTypeCode: 'HQ', businessTypeDesc: 'DOT Certified DBE' },
        { businessTypeCode: 'QZ', businessTypeDesc: 'Subcontinent Asian (Asian-Indian) American Owned' },
        { businessTypeCode: 'XS', businessTypeDesc: 'Subcontractor' },
      ],
      sbaBusinessTypeList: [
        { sbaBusinessTypeCode: 'A0', sbaBusinessTypeDesc: 'SBA Certified Economically Disadvantaged Women-Owned Small Business' },
        { sbaBusinessTypeCode: 'A6', sbaBusinessTypeDesc: 'SBA Certified 8(a) Program Participant' },
        { sbaBusinessTypeCode: 'A9', sbaBusinessTypeDesc: 'SBA Certified Women-Owned Small Business' },
        { sbaBusinessTypeCode: 'XX', sbaBusinessTypeDesc: 'SBA Certified HUBZone Firm' },
      ],
    },
  },
  assertions: {
    goodsAndServices: {
      primaryNaics: '236220',
      naicsList: [
        { naicsCode: '236220', naicsDescription: 'Commercial and Institutional Building Construction' },
      ],
    },
  },
};

/** Real local `sam_entities` row for NB2RPSSAB614 (extract vintage — expiry differs on purpose). */
const TCP_LOCAL_ROW = {
  uei: 'NB2RPSSAB614',
  cage_code: '6VW15',
  legal_business_name: 'TRAINING CENTER PROS INC',
  dba_name: 'EOD GEAR',
  physical_city: 'FRANKLIN', physical_state: 'TN', physical_zip: '37064', physical_country: 'USA',
  primary_naics: '332999',
  naics_codes: ['221112','236118','236210','236220','237310','237990','238110','238190','238210','238910','238990','332994','332999','541219','541511','541512','541513'],
  certifications: ['VOSB','SDVOSB'],
  certification_records: [],
  registration_status: 'Active',
  registration_expiry: '2027-06-29',
  exclusion_flag: false,
  sam_url: 'https://sam.gov/entity/NB2RPSSAB614',
  synced_at: '2026-08-25T00:07:46.472+00:00',
};

/**
 * OLD mapper hole, injected so the regression stays visible:
 * sbaBusinessTypeList only for hasSDVOSB, per-item isPrimary only, no businessTypes.
 */
function legacyTransformEntity(raw: Record<string, unknown>) {
  const er = (raw.entityRegistration as Record<string, unknown>) || {};
  const core = (raw.coreData as Record<string, unknown>) || {};
  const assertions = (raw.assertions as Record<string, unknown>) || {};
  const goodsServices = (assertions.goodsAndServices as Record<string, unknown>) || {};
  const businessTypes = (core.businessTypes as Record<string, unknown>) || {};
  const sbaTypesArr =
    (businessTypes.sbaBusinessTypeList as Array<Record<string, unknown>>) || [];
  const sbaTypes = sbaTypesArr
    .map((t) => String((t.sbaBusinessTypeCode as string) || (t.sbaBusinessTypeDesc as string) || ''))
    .filter(Boolean);
  const naicsRaw = (goodsServices.naicsList as Array<Record<string, unknown>>) || [];
  const naicsList = naicsRaw.map((n) => ({
    naicsCode: String(n.naicsCode || ''),
    isPrimary: Boolean(n.isPrimary === 'Y' || n.isPrimary === true || n.primaryNaics === 'Y'),
  }));
  return {
    hasSDVOSB: sbaTypes.some((t) => /SDVOSB|Service.Disabled/i.test(t)),
    has8a: sbaTypes.some((t) => /8\(a\)/i.test(t)),
    businessTypes: undefined as string[] | undefined,
    primaryNaics: undefined as string | undefined,
    naicsList,
    registrationExpirationDate: er.registrationExpirationDate as string | undefined,
  };
}

function stubRow(row: unknown) {
  const chain = {
    select: () => chain, eq: () => chain, ilike: () => chain,
    limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
  mockFrom.mockReturnValue(chain);
}

beforeEach(() => {
  mockFrom.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k';
});

describe('A — TRAINING CENTER PROS INC / NB2RPSSAB614', () => {
  it('⚠️ THE REGRESSION: legacy mapper misses QF, VOSB, and primary 332999', () => {
    const legacy = legacyTransformEntity(TCP_LIVE);
    expect(legacy.hasSDVOSB).not.toBe(true);
    expect(legacy.businessTypes).toBeUndefined();
    expect(legacy.primaryNaics).toBeUndefined();
    expect(legacy.naicsList.some((n) => n.naicsCode === '332999' && n.isPrimary)).toBe(false);
    expect(legacy.has8a).toBe(false);
  });

  it('transformEntity preserves self-id VOSB/SDVOSB, primary 332999, live expiry', () => {
    const e = transformEntity(TCP_LIVE);
    expect(e.hasSDVOSB).toBe(true);
    expect(e.businessTypes).toEqual(expect.arrayContaining(['VOSB', 'SDVOSB']));
    expect(e.businessTypes).not.toEqual(expect.arrayContaining(['8(a)']));
    expect(e.has8a).toBe(false);
    expect(e.primaryNaics).toBe('332999');
    expect(e.naicsList?.find((n) => n.naicsCode === '332999')?.isPrimary).toBe(true);
    expect(e.registrationExpirationDate).toBe('2027-08-24');
  });

  it('accepts plain-string businessTypeList entries the same way', () => {
    const e = transformEntity({
      ...TCP_LIVE,
      coreData: {
        businessTypes: {
          businessTypeList: ['F', '2X', 'A5', 'QF'],
          sbaBusinessTypeList: [],
        },
      },
    });
    expect(e.hasSDVOSB).toBe(true);
    expect(e.businessTypes).toEqual(expect.arrayContaining(['VOSB', 'SDVOSB']));
    expect(e.has8a).toBe(false);
  });
});

describe('B — UEI/live vs name/local semantic parity (not source-string coincidence)', () => {
  it('both entry paths agree on SDVOSB, VOSB, and primary 332999', async () => {
    const live = transformEntity(TCP_LIVE);
    stubRow(TCP_LOCAL_ROW);
    const local = (await localEntityByUEI('NB2RPSSAB614'))!.entity;

    expect(live.hasSDVOSB).toBe(true);
    expect(local.hasSDVOSB).toBe(true);
    expect(live.businessTypes).toEqual(expect.arrayContaining(['VOSB', 'SDVOSB']));
    expect(local.businessTypes).toEqual(expect.arrayContaining(['VOSB', 'SDVOSB']));
    expect(live.primaryNaics).toBe('332999');
    expect(local.primaryNaics).toBe('332999');
    expect(live.naicsList?.find((n) => n.naicsCode === '332999')?.isPrimary).toBe(true);
    expect(local.naicsList?.find((n) => n.naicsCode === '332999')?.isPrimary).toBe(true);

    // Vintage disagreement is real — do not collapse.
    expect(live.registrationExpirationDate).toBe('2027-08-24');
    expect(local.registrationExpirationDate).toBe('2027-06-29');
    expect(live.registrationExpirationDate).not.toBe(local.registrationExpirationDate);
  });
});

describe('C — controls', () => {
  it('Booz Allen JCBMLGPE6Z71: 2X/F do not become SDVOSB or 8(a)', () => {
    const e = transformEntity(BOOZ_LIVE);
    expect(e.hasSDVOSB).toBe(false);
    expect(e.has8a).toBe(false);
    expect(e.businessTypes ?? []).not.toEqual(expect.arrayContaining(['SDVOSB', '8(a)', 'VOSB', 'WOSB']));
    expect(e.primaryNaics).toBe('541512');
    expect(e.registrationExpirationDate).toBe('2027-04-09');
  });

  it('North Star FCJCDUZV7RM3: SBA 8(a)/HUBZone/WOSB stay true; no QF → not SDVOSB', () => {
    const e = transformEntity(NORTH_STAR_LIVE);
    expect(e.has8a).toBe(true);
    expect(e.hasHUBZone).toBe(true);
    expect(e.hasWOSB).toBe(true);
    expect(e.hasSDVOSB).toBe(false);
    expect(e.businessTypes).toEqual(expect.arrayContaining(['WOSB']));
    expect(e.businessTypes).not.toEqual(expect.arrayContaining(['SDVOSB']));
    expect(e.primaryNaics).toBe('236220');
    expect(e.registrationExpirationDate).toBe('2027-03-10');
  });
});
