/**
 * Cache-only identity resolution for Ask Mindy research (Eric: zero live SAM calls). Reference: EFS Digital, a
 * woman-owned agency in Norwich, CT, with no SAM registration under that name (live legal, live DBA, mirror and
 * recipients all 0 on 2026-11-25). The resolver must say "none found" honestly, return every plausible candidate
 * with deciding fields when several fit, treat a UEI as authoritative, and never call live SAM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;
let table: Row[] = [];
let failing = false;
const live = vi.fn();
vi.mock('@/lib/sam/entity-api', async (orig) => ({ ...(await orig<object>()), searchEntities: live, getEntityByUEI: live }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const preds: Array<(r: Row) => boolean> = [];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
        ilike: (c: string, pat: string) => {
          const re = new RegExp(`^${pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'is');
          preds.push((r) => re.test(String(r[c] ?? ''))); return b;
        },
        filter: (c: string, op: string, v: string) => {
          if (op === 'imatch') {
            const re = new RegExp(v.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b').replace(/\[\^\[:alnum:\]\]\+/g, '[^A-Za-z0-9]+'), 'i');
            preds.push((r) => re.test(String(r[c] ?? '')));
          }
          return b;
        },
        limit: () => b,
        then: (res: (v: unknown) => unknown) => res(failing
          ? { data: null, error: { message: 'connection refused' } }
          : { data: table.filter((r) => preds.every((p) => p(r))), error: null }),
      };
      return b;
    },
  }),
}));

import { resolveEntityFromCache, websiteDomain } from './entity-cache-resolver';

const row = (o: Partial<Row>): Row => ({
  uei: 'X', cage_code: null, legal_business_name: 'X', dba_name: null, physical_city: null, physical_state: null,
  physical_zip: null, physical_country: 'USA', primary_naics: null, naics_codes: [], certifications: [],
  certification_records: [], registration_status: 'Active', registration_expiry: '2099-01-01', exclusion_flag: false,
  sam_url: null, entity_url: null, points_of_contact: [], synced_at: '2026-11-20T00:00:00Z', ...o,
});

beforeEach(() => {
  failing = false; live.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k';
  table = [
    row({ uei: 'CHIEFS000001', legal_business_name: 'KANSAS STATE ASSOCIATION OF FIRE CHIEFS', physical_state: 'KS' }),
    row({ uei: 'EFSWEST00001', legal_business_name: 'EFS WEST', physical_city: 'SANTA CLARITA', physical_state: 'CA' }),
    row({ uei: 'NORWICH00001', legal_business_name: 'ELIZABETH F SMITH LLC', dba_name: 'EFS DIGITAL', physical_city: 'NORWICH', physical_state: 'CT', entity_url: 'https://www.efsdigital.com/' }),
    row({ uei: 'NORWICH00002', legal_business_name: 'EFS DIGITAL MEDIA INC', physical_city: 'AUSTIN', physical_state: 'TX', entity_url: 'efsdigitalmedia.com' }),
  ];
});

describe('websiteDomain', () => {
  it('normalises a URL or a bare domain to its host', () => {
    expect(websiteDomain('https://www.EFSdigital.com/about?x=1')).toBe('efsdigital.com');
    expect(websiteDomain('efsdigital.com')).toBe('efsdigital.com');
    expect(websiteDomain('not a site')).toBeNull();
    expect(websiteDomain('')).toBeNull();
  });
});

describe('resolveEntityFromCache', () => {
  it('a trading (DBA) name + state resolves to the legal entity, with the deciding fields', async () => {
    const r = await resolveEntityFromCache({ name: 'EFS Digital', state: 'CT' });
    expect(r.status).toBe('found');
    expect(r.candidates[0]).toMatchObject({
      uei: 'NORWICH00001', legal_name: 'ELIZABETH F SMITH LLC', dba_name: 'EFS DIGITAL', match_on: ['dba_name'],
      address: { city: 'NORWICH', state: 'CT' }, website: 'https://www.efsdigital.com/', as_of: '2026-11-20T00:00:00Z',
    });
  });
  it('a name alone that fits several companies → ambiguous, every candidate returned, never CHIEFS', async () => {
    const r = await resolveEntityFromCache({ name: 'EFS Digital' });
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map((c) => c.uei).sort()).toEqual(['NORWICH00001', 'NORWICH00002']);
  });
  it('the website decides between same-name candidates', async () => {
    const r = await resolveEntityFromCache({ name: 'EFS Digital', website: 'https://efsdigital.com/contact' });
    expect(r.candidates[0].uei).toBe('NORWICH00001');
    expect(r.candidates[0].match_on).toEqual(expect.arrayContaining(['website', 'dba_name']));
    expect(r.candidates.find((c) => c.uei === 'NORWICH00002')?.conflicts).toContain('website');
  });
  it('a website alone finds the registration by exact host (efsdigital.com is not efsdigitalmedia.com)', async () => {
    const r = await resolveEntityFromCache({ website: 'efsdigital.com' });
    expect(r.status).toBe('found');
    expect(r.candidates.map((c) => c.uei)).toEqual(['NORWICH00001']);
  });
  it('a UEI is authoritative: other clues only annotate (a state mismatch is reported, not used to reject)', async () => {
    const r = await resolveEntityFromCache({ uei: 'efswest00001', name: 'EFS Digital', state: 'CT' });
    expect(r.status).toBe('found');
    expect(r.candidates[0]).toMatchObject({ uei: 'EFSWEST00001', match_on: ['uei'], conflicts: ['state'] });
  });
  it('the real EFS Digital case (no row) → none_found with an honest note', async () => {
    table = table.filter((t) => !String(t.uei).startsWith('NORWICH'));
    const r = await resolveEntityFromCache({ name: 'EFS Digital', state: 'CT' });
    expect(r.status).toBe('none_found');
    expect(r.note).toMatch(/different legal name/);
  });
  it('cache unreadable → unavailable, never "not registered"', async () => {
    failing = true;
    const r = await resolveEntityFromCache({ name: 'EFS Digital' });
    expect(r.status).toBe('unavailable');
    expect(r.note).toMatch(/not "unregistered"/);
  });
  it('never calls live SAM', async () => {
    await resolveEntityFromCache({ name: 'EFS Digital', website: 'efsdigital.com' });
    await resolveEntityFromCache({ uei: 'EFSWEST00001' });
    expect(live).not.toHaveBeenCalled();
  });
});

describe('entityURL is mapped from live SAM', () => {
  it('transformEntity reads coreData.entityInformation.entityURL', async () => {
    const { transformEntity } = await vi.importActual<typeof import('./entity-api')>('./entity-api');
    const e = transformEntity({ entityRegistration: { ueiSAM: 'U1', legalBusinessName: 'A' }, coreData: { entityInformation: { entityURL: ' www.example.com ' } } });
    expect(e.entityUrl).toBe('www.example.com');
    expect(transformEntity({ entityRegistration: { ueiSAM: 'U2' }, coreData: {} }).entityUrl).toBeUndefined();
  });
});
