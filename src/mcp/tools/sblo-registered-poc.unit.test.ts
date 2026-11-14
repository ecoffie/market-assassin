/**
 * R8 (Ask Mindy regression, 2026-11-13): "Small business contact at Concord Professional Services".
 *
 * The curated SBLO roster covers large primes only, so a small firm always missed it and the answer
 * named nobody, while Mindy already held the firm's registered SAM points of contact in the stored
 * raw SAM response (sam_api_cache, api_type='entity'). These tests pin:
 *   - get_sblo_contact returns the registered POCs from the CACHE with live SAM forced to THROW,
 *     labelled "not a designated small business liaison", never inventing email/phone;
 *   - lookup_sam_entity's local fallback keeps pointsOfContact (mirror column, then cache);
 *   - an ambiguous name returns no one's people; an empty cache returns no contact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fake Supabase: just enough of the PostgREST builder for the two tables involved. ──────────
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { sam_entities: [], sam_api_cache: [] };
const writes: string[] = [];

function readPath(row: Row, col: string): unknown {
  if (col === 'query_params->>ueiSAM') return (row.query_params as Row | undefined)?.ueiSAM;
  return row[col];
}
function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let lim = Infinity;
  let order: { col: string; asc: boolean } | null = null;
  const b = {
    select: () => b,
    eq: (col: string, v: unknown) => { preds.push((r) => readPath(r, col) === v); return b; },
    ilike: (col: string, pat: string) => {
      const needle = pat.replace(/%/g, '').toLowerCase();
      preds.push((r) => String(r[col] ?? '').toLowerCase().includes(needle));
      return b;
    },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { lim = n; return b; },
    update: () => { writes.push(`update:${table}`); return b; },
    delete: () => { writes.push(`delete:${table}`); return b; },
    upsert: () => { writes.push(`upsert:${table}`); return b; },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      let rows = (tables[table] || []).filter((r) => preds.every((p) => p(r)));
      if (order) {
        const { col, asc } = order;
        rows = [...rows].sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return resolve({ data: rows.slice(0, lim), error: null });
    },
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

// ── Live SAM is DOWN: every live call throws. transformEntity stays real (the cache uses it). ──
const liveSearch = vi.fn(async () => { throw new Error('SAM entity lookup unavailable: all API keys are rate-limited (429).'); });
vi.mock('@/lib/sam/entity-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/sam/entity-api')>()),
  searchEntities: (...a: unknown[]) => liveSearch(...(a as [])),
  getEntityByUEI: (...a: unknown[]) => liveSearch(...(a as [])),
}));

// BigQuery award-context tier: down too (or empty), per test.
const bqSearch = vi.fn();
vi.mock('@/lib/bigquery/recipients', async (orig) => ({
  ...(await orig<typeof import('@/lib/bigquery/recipients')>()),
  searchRecipients: (...a: unknown[]) => bqSearch(...a),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';

const { getSbloContact } = await import('./sblo-contact');
const { lookupSamEntity } = await import('./sam-entity');

const CONCORD_UEI = 'NZ7CS4E6R7K6';
const poc = (firstName: string, lastName: string, title: string) => ({
  firstName, lastName, title, middleInitial: null, city: 'Knoxville', stateOrProvinceCode: 'TN',
  addressLine1: '309 Ebenezer Road', zipCode: '37923', countryCode: 'USA',
});
// Shape of the real cached response (sam_api_cache, fetched 2026-08-15); public API has no email/phone.
const CONCORD_RAW = {
  entityRegistration: { ueiSAM: CONCORD_UEI, legalBusinessName: 'CONCORD PROFESSIONAL SERVICES, INC.', registrationStatus: 'Active' },
  coreData: {},
  pointsOfContact: {
    governmentBusinessPOC: poc('Geoff', 'Haas', 'President'),
    electronicBusinessPOC: poc('Geoff', 'Haas', 'President'),
    pastPerformancePOC: poc('Geoff', 'Haas', 'President'),
    governmentBusinessAlternatePOC: poc('Daniel', 'Reed', 'Proposal Manager'),
    electronicBusinessAlternatePOC: poc('Chris', 'Rud', 'Office Manager'),
    pastPerformanceAlternatePOC: poc('Chris', 'Rud', 'Office Manager'),
  },
};
const concordMirror = (pocs: unknown[] = []): Row => ({
  uei: CONCORD_UEI, legal_business_name: 'CONCORD PROFESSIONAL SERVICES, INC.', dba_name: null,
  physical_state: 'TN', registration_status: 'Active', naics_codes: [], certifications: [],
  certification_records: [], points_of_contact: pocs, synced_at: '2026-08-25T00:08:23Z',
});
const concordCache = (): Row => ({
  api_type: 'entity', query_params: { ueiSAM: CONCORD_UEI },
  fetched_at: '2026-08-15T17:41:45Z', expires_at: '2026-08-16T17:41:45Z', // EXPIRED: still a real past answer
  response_data: { totalRecords: 1, entityData: [CONCORD_RAW] },
});

beforeEach(() => {
  tables.sam_entities = [concordMirror()];
  tables.sam_api_cache = [concordCache()];
  writes.length = 0;
  liveSearch.mockClear();
  bqSearch.mockReset();
  bqSearch.mockRejectedValue(new Error('BigQuery quota kill-switch'));
});

describe('get_sblo_contact: registered SAM POC fallback (cache-only)', () => {
  it('THE REGRESSION: Concord returns Geoff Haas / Daniel Reed / Chris Rud from the cache while live SAM throws', async () => {
    const r = await getSbloContact({ company: 'Concord Professional Services' });
    const reg = r.registered_points_of_contact!;
    expect(reg).toBeDefined();
    expect(reg.contacts.map((p) => p.name)).toEqual(['Geoff Haas', 'Daniel Reed', 'Chris Rud']);
    expect(reg.contacts[0]).toMatchObject({ title: 'President' });
    expect(reg.contacts[0].roles).toContain('government business POC');
    expect(reg.label).toBe('registered SAM point of contact, not a designated small business liaison');
    expect(reg.source).toBe('sam_api_cache');
    expect(reg.as_of).toBe('2026-08-15T17:41:45Z');
    expect(reg.uei).toBe(CONCORD_UEI);
    // Never invent contact details SAM did not return.
    for (const p of reg.contacts) { expect(p.email).toBeUndefined(); expect(p.phone).toBeUndefined(); }
    expect(r._meta).toMatchObject({
      grounded: true, has_named_sblo: false, has_registered_poc: true,
      contact_basis: 'registered_sam_poc', registered_poc_status: 'found', degraded: false, bq_degraded: true,
    });
    expect(r._meta.incomplete_reason).toMatch(/BigQuery/);
    // No live SAM call and no cache writes (no hit_count bump, no expired-row delete).
    expect(liveSearch).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('prefers the mirror POC column when it is populated', async () => {
    tables.sam_entities = [concordMirror([{ name: 'Geoff Haas', title: 'President', type: 'governmentBusinessPOC', email: '', phone: '' }])];
    tables.sam_api_cache = [];
    const r = await getSbloContact({ company: 'Concord Professional Services' });
    expect(r.registered_points_of_contact?.source).toBe('sam_entities_mirror');
    expect(r.registered_points_of_contact?.contacts.map((p) => p.name)).toEqual(['Geoff Haas']);
  });

  it('nothing held: no contact, no invented person, grounded=false', async () => {
    tables.sam_api_cache = [];
    bqSearch.mockResolvedValue({ rows: [] });
    const r = await getSbloContact({ company: 'Concord Professional Services' });
    expect(r.registered_points_of_contact).toBeUndefined();
    expect(r.contact).toBeNull();
    expect(r._meta).toMatchObject({ grounded: false, has_registered_poc: false, registered_poc_status: 'no_pocs_held', contact_basis: 'none' });
  });

  it('ambiguous name returns no one\'s people', async () => {
    tables.sam_entities = [
      { ...concordMirror(), uei: 'AAAAAAAAAAA1', legal_business_name: 'CONCORD PROFESSIONAL SERVICES GROUP LLC' },
      { ...concordMirror(), uei: 'AAAAAAAAAAA2', legal_business_name: 'CONCORD PROFESSIONAL SERVICES OF TEXAS LLC' },
    ];
    bqSearch.mockResolvedValue({ rows: [] });
    const r = await getSbloContact({ company: 'Concord Professional Services' });
    expect(r.registered_points_of_contact).toBeUndefined();
    expect(r._meta.registered_poc_status).toBe('ambiguous');
    expect(r._meta.grounded).toBe(false);
  });
});

describe('lookup_sam_entity: local fallback keeps points of contact', () => {
  it('live SAM throws, mirror row has no POCs, cache supplies them (labelled, dated)', async () => {
    const r = await lookupSamEntity({ name: 'Concord Professional Services' });
    expect(r._meta.source).toBe('local_registry');
    expect(r._meta.degraded).toBe(true);
    expect(r.entity?.ueiSAM).toBe(CONCORD_UEI);
    expect(r.entity?.pointsOfContact?.map((p) => p.name)).toEqual(expect.arrayContaining(['Geoff Haas', 'Daniel Reed', 'Chris Rud']));
    expect(r._meta.points_of_contact_source).toBe('sam_api_cache');
    expect(r._meta.points_of_contact_as_of).toBe('2026-08-15T17:41:45Z');
    expect(r._meta.points_of_contact_label).toMatch(/not a designated small business liaison/);
  });

  it('mirror POC column is mapped (was dropped by the local mapper)', async () => {
    tables.sam_entities = [concordMirror([{ name: 'Geoff Haas', title: 'President', type: 'governmentBusinessPOC', email: '', phone: '' }])];
    tables.sam_api_cache = [];
    const r = await lookupSamEntity({ uei: CONCORD_UEI });
    expect(r.entity?.pointsOfContact?.[0]).toMatchObject({ name: 'Geoff Haas', title: 'President', type: 'governmentBusinessPOC' });
    expect(r._meta.points_of_contact_source).toBe('local_registry');
  });

  it('no POCs anywhere: source none, nothing fabricated', async () => {
    tables.sam_api_cache = [];
    const r = await lookupSamEntity({ uei: CONCORD_UEI });
    expect(r.entity?.pointsOfContact).toBeUndefined();
    expect(r._meta.points_of_contact_source).toBe('none');
    expect(r._meta.points_of_contact_label).toBeUndefined();
  });
});
