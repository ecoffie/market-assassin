/**
 * Certification truth — company-intelligence audit PR #1 (2026-11-09).
 *
 * Real SAM Entity API v3 responses, captured 2026-11-09 (points of contact removed):
 *   TH2ZULPHFJS8  AMS Consulting and Design — four sbaBusinessTypeList entries, EVERY field null.
 *                 Prod lookup_sam_entity answered has8a:false / hasHUBZone:false. SBA Small
 *                 Business Search shows 8(a), HUBZone, WOSB and EDWOSB active.
 *   GHFYLESVE2V5  AMS (second UEI) — four complete entries with dates (control).
 *   N4BAZDMM7DV7  Jordon Construction — HUBZone entry 2024-04-05, exit 2024-03-18: re-entered.
 *
 * RULE: unknown is never false. A blank, absent or contradictory SAM answer is
 * `not_established`, and the boolean flag is ABSENT — not `false`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import th2z from './__fixtures__/sam-cert-TH2ZULPHFJS8.json';
import ghfy from './__fixtures__/sam-cert-GHFYLESVE2V5.json';
import jordon from './__fixtures__/sam-cert-N4BAZDMM7DV7.json';

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}) }) }));

const { transformEntity } = await import('./entity-api');
const { interpretSbaCertifications, certFlag, downgradeOnExtractConflict } = await import('./certification-status');

const AS_OF = '2026-11-09';
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${AS_OF}T12:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

const rec = (records: ReturnType<typeof interpretSbaCertifications>, p: string) =>
  records.find((r) => r.program === p)!;

describe('blank certification objects (AMS TH2ZULPHFJS8)', () => {
  const e = transformEntity(th2z.entity as Record<string, unknown>);

  it('the fixture really is four all-null entries (guards the fixture itself)', () => {
    const list = th2z.entity.coreData.businessTypes.sbaBusinessTypeList;
    expect(list).toHaveLength(4);
    for (const x of list) expect(Object.values(x).every((v) => v === null)).toBe(true);
  });

  it('⚠️ THE REGRESSION: no definitive negative for 8(a), HUBZone or SBA women-owned', () => {
    expect(e.has8a).toBeUndefined();      // was false
    expect(e.hasHUBZone).toBeUndefined(); // was false
    expect('has8a' in e).toBe(false);     // absent, so JSON cannot carry a `false`
    expect('hasHUBZone' in e).toBe(false);
  });

  it('every SBA program is not_established with the reason, never not_listed', () => {
    for (const p of ['8(a)', 'HUBZone', 'WOSB', 'EDWOSB']) {
      const r = rec(e.certificationStatus!, p);
      expect(r.status).toBe('not_established');
      expect(r.reasons).toContain('sam_returned_blank_certification_entries');
    }
  });

  it('the self-identified WOSB still counts — and is the only women-owned evidence', () => {
    expect(e.businessTypes).toContain('WOSB');
    expect(e.hasWOSB).toBe(true);
  });

  it('serialization keeps unknown out of false', () => {
    const json = JSON.parse(JSON.stringify(e));
    expect(json.has8a).toBeUndefined();
    expect(json.hasHUBZone).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/"has(8a|HUBZone)":false/);
  });
});

describe('active certification with authoritative evidence (AMS GHFYLESVE2V5)', () => {
  const e = transformEntity(ghfy.entity as Record<string, unknown>);

  it('8(a), HUBZone, WOSB and EDWOSB are active with SAM entry/exit dates', () => {
    expect(rec(e.certificationStatus!, '8(a)')).toMatchObject({
      status: 'active', entry_date: '2022-06-03', exit_date: '2031-06-02', sam_codes: ['A6'],
    });
    expect(rec(e.certificationStatus!, 'HUBZone')).toMatchObject({ status: 'active', entry_date: '2020-10-07', exit_date: null });
    expect(rec(e.certificationStatus!, 'WOSB')).toMatchObject({ status: 'active', entry_date: '2022-03-04', sam_codes: ['A9'] });
    expect(rec(e.certificationStatus!, 'EDWOSB')).toMatchObject({ status: 'active', entry_date: '2022-03-04', sam_codes: ['A0'] });
    expect(e.has8a).toBe(true);
    expect(e.hasHUBZone).toBe(true);
    expect(e.hasWOSB).toBe(true);
  });

  it('a future 8(a) exit is the scheduled program term, reported as an expiration', () => {
    expect(rec(e.certificationStatus!, '8(a)').reasons).toContain('scheduled_exit_date');
    expect(e.certifications?.certificationExpirations).toEqual([{ type: '8(a)', expirationDate: '2031-06-02' }]);
  });

  it('provenance says "listed in SAM.gov" — it does not claim a direct SBA check', () => {
    for (const r of e.certificationStatus!) {
      expect(r.basis).toBe('sam_sba_certification_list');
      expect(r.source_label).toMatch(/SAM\.gov/);
      expect(r.source_label).not.toMatch(/verified/i);
    }
  });
});

describe('exit followed by re-entry (Jordon N4BAZDMM7DV7)', () => {
  const e = transformEntity(jordon.entity as Record<string, unknown>);

  it('HUBZone is active from the re-entry; the older exit is kept as history only', () => {
    expect(rec(e.certificationStatus!, 'HUBZone')).toMatchObject({
      status: 'active', entry_date: '2024-04-05', exit_date: null, prior_exit_date: '2024-03-18',
    });
    expect(rec(e.certificationStatus!, 'HUBZone').reasons).toContain('re_entered_after_exit');
    expect(e.hasHUBZone).toBe(true);
  });

  it('8(a) is not_listed (SAM returned a complete list without it) and maps to false', () => {
    expect(rec(e.certificationStatus!, '8(a)').status).toBe('not_listed');
    expect(e.has8a).toBe(false);
  });
});

describe('interpretSbaCertifications — synthetic edges', () => {
  const XX = (entry: unknown, exit: unknown) => ({
    sbaBusinessTypeCode: 'XX', sbaBusinessTypeDesc: 'SBA Certified HUBZone Firm',
    certificationEntryDate: entry, certificationExitDate: exit,
  });

  it('confirmed inactive: exit passed, no later entry', () => {
    const r = rec(interpretSbaCertifications([XX('2019-01-02', '2023-01-02')], AS_OF), 'HUBZone');
    expect(r).toMatchObject({ status: 'inactive', entry_date: '2019-01-02', exit_date: '2023-01-02' });
    expect(certFlag([r], 'HUBZone')).toBe(false);
  });

  it('missing dates on a listed certification: active, and the gap is named', () => {
    const r = rec(interpretSbaCertifications([XX(null, null)], AS_OF), 'HUBZone');
    expect(r.status).toBe('active');
    expect(r.reasons).toContain('dates_not_provided');
  });

  it('missing entry date with a passed exit is still inactive, and says the entry is missing', () => {
    const r = rec(interpretSbaCertifications([XX(null, '2023-01-02')], AS_OF), 'HUBZone');
    expect(r.status).toBe('inactive');
    expect(r.reasons).toContain('entry_date_not_provided');
  });

  it('an older exit never overwrites a later active entry', () => {
    const r = rec(interpretSbaCertifications([XX('2018-01-01', '2021-01-01'), XX('2022-05-05', null)], AS_OF), 'HUBZone');
    expect(r).toMatchObject({ status: 'active', entry_date: '2022-05-05' });
  });

  it('conflicting entries — an exit AFTER the active entry began — are not_established', () => {
    const r = rec(interpretSbaCertifications([XX('2020-01-01', null), XX('2021-01-01', '2023-06-01')], AS_OF), 'HUBZone');
    expect(r.status).toBe('not_established');
    expect(r.reasons).toContain('conflicting_sam_entries');
    expect(certFlag([r], 'HUBZone')).toBeUndefined();
  });

  it('unreadable dates and future entry dates are not_established', () => {
    expect(rec(interpretSbaCertifications([XX('03/18/2024', null)], AS_OF), 'HUBZone').reasons).toContain('unreadable_date');
    expect(rec(interpretSbaCertifications([XX('2027-01-01', null)], AS_OF), 'HUBZone').reasons).toContain('entry_date_in_future');
  });

  it('a blank sibling entry turns an otherwise-inactive read into not_established', () => {
    const r = rec(interpretSbaCertifications([XX('2019-01-02', '2023-01-02'), { sbaBusinessTypeCode: null }], AS_OF), 'HUBZone');
    expect(r.status).toBe('not_established');
  });

  it('a blank sibling does NOT erase an active read that stands on its own dates', () => {
    const r = rec(interpretSbaCertifications([XX('2022-01-02', null), { sbaBusinessTypeCode: null }], AS_OF), 'HUBZone');
    expect(r.status).toBe('active');
  });

  it('no list at all is not_established for every program — never not_listed', () => {
    for (const r of interpretSbaCertifications(undefined, AS_OF)) {
      expect(r.status).toBe('not_established');
      expect(r.reasons).toContain('sam_certification_list_absent');
    }
  });

  it('an empty, readable list is SAM\'s negative: not_listed → false', () => {
    const rs = interpretSbaCertifications([], AS_OF);
    expect(rs.every((r) => r.status === 'not_listed')).toBe(true);
    expect(certFlag(rs, '8(a)')).toBe(false);
  });
});

describe('SAM\'s single-blank placeholder vs withheld entries', () => {
  const blank = { sbaBusinessTypeCode: null, sbaBusinessTypeDesc: null, certificationEntryDate: null, certificationExitDate: null };

  it('ONE all-null entry is SAM\'s "none" placeholder: not_listed, reason named, flag false', () => {
    const rs = interpretSbaCertifications([blank], AS_OF);
    for (const r of rs) expect(r).toMatchObject({ status: 'not_listed', reasons: ['sam_placeholder_entry'] });
    expect(certFlag(rs, '8(a)')).toBe(false);
  });

  it('TWO or more all-null entries are withheld certifications: not_established', () => {
    for (const r of interpretSbaCertifications([blank, blank], AS_OF)) expect(r.status).toBe('not_established');
  });

  it('a blank beside a real entry: the real program stands, the others are not_established', () => {
    const rs = interpretSbaCertifications([
      { sbaBusinessTypeCode: 'A6', sbaBusinessTypeDesc: 'SBA Certified 8(a) Program Participant', certificationEntryDate: '2022-01-01', certificationExitDate: '2031-01-01' },
      blank,
    ], AS_OF);
    expect(rec(rs, '8(a)').status).toBe('active');
    expect(rec(rs, 'HUBZone').status).toBe('not_established');
  });
});

describe('stale or conflicting evidence — stored SAM extract vs live placeholder', () => {
  const placeholder = interpretSbaCertifications([{ sbaBusinessTypeCode: null, sbaBusinessTypeDesc: null }], AS_OF);

  it('extract shows 8(a) while live SAM shows only the placeholder → 8(a) not_established, flag absent', () => {
    const { records, downgraded } = downgradeOnExtractConflict(placeholder, { '8(a)': true });
    expect(downgraded).toEqual(['8(a)']);
    expect(rec(records, '8(a)')).toMatchObject({ status: 'not_established' });
    expect(rec(records, '8(a)').reasons).toContain('conflicts_with_stored_sam_extract');
    expect(certFlag(records, '8(a)')).toBeUndefined();
    expect(certFlag(records, 'HUBZone')).toBe(false); // untouched program keeps SAM's negative
  });

  it('the extract can only weaken a negative — never overwrite an active SAM read', () => {
    const active = interpretSbaCertifications([
      { sbaBusinessTypeCode: 'XX', sbaBusinessTypeDesc: 'SBA Certified HUBZone Firm', certificationEntryDate: '2024-04-05', certificationExitDate: '2024-03-18' },
    ], AS_OF);
    const { records } = downgradeOnExtractConflict(active, { HUBZone: false, '8(a)': true });
    expect(rec(records, 'HUBZone').status).toBe('active');
    // 8(a) here is a not_listed from a COMPLETE readable list, not the placeholder → unchanged
    expect(rec(records, '8(a)').status).toBe('not_listed');
  });

  it('extract silent or negative → SAM\'s placeholder negative stands', () => {
    const { downgraded } = downgradeOnExtractConflict(placeholder, { '8(a)': false, HUBZone: undefined });
    expect(downgraded).toEqual([]);
  });
});

describe('transformEntity — absent lists stay unknown', () => {
  it('no businessTypes block at all: no SBA or self-id negatives', () => {
    const e = transformEntity({ entityRegistration: { ueiSAM: 'ZZZZZZZZZZZZ', registrationStatus: 'Active' } });
    expect('has8a' in e).toBe(false);
    expect('hasHUBZone' in e).toBe(false);
    expect('hasWOSB' in e).toBe(false);
    expect('hasSDVOSB' in e).toBe(false);
  });

  it('sbaBusinessTypes keeps its existing meaning (labels SAM listed) for downstream writers', () => {
    const e = transformEntity(jordon.entity as Record<string, unknown>);
    expect(e.certifications?.sbaBusinessTypes).toEqual(['HUBZone']);
  });
});
