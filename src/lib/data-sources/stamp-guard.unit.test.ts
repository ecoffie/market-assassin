import { describe, it, expect } from 'vitest';
import { decideStamp, PRODUCER_STAMPED_KEYS } from './stamp-guard';

const today = '2026-11-17';
const curated = { key: 'tier2_sblo', is_active: true, category: 'curated', notes: 'The 2,700+ contractor DB' };
const goodEvidence = 'Re-verified 41 SBLO contacts against company pages; diff in data/imports/sblo-refresh-2026-12.csv';

describe('a freshness stamp cannot be advanced without evidence', () => {
  it('refuses a bare stamp (the pre-2026-11-17 behaviour)', () => {
    const d = decideStamp({ key: 'tier2_sblo', row: curated, evidence: null, records: null, today });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(400);
  });

  it('refuses evidence that is too short or cites nothing checkable', () => {
    expect(decideStamp({ key: 'tier2_sblo', row: curated, evidence: 'done', records: 200, today }).ok).toBe(false);
    expect(decideStamp({ key: 'tier2_sblo', row: curated, evidence: 'refreshed everything carefully today, all good', records: 200, today }).ok).toBe(false);
  });

  it('refuses a missing, zero, negative or non-numeric record count', () => {
    for (const records of [null, '', '0', '-5', 'many', '12.5']) {
      expect(decideStamp({ key: 'tier2_sblo', row: curated, evidence: goodEvidence, records, today }).ok).toBe(false);
    }
  });

  it('refuses sources whose freshness is measured elsewhere, even with evidence', () => {
    const cases = [
      { key: 'dodaac_directory', category: 'reference' },
      { key: 'federal_events_catalog', category: 'curated' },
      ...[...PRODUCER_STAMPED_KEYS].map((key) => ({ key, category: 'built' })),
      { key: 'grants_gov', category: 'live_api' },
    ];
    for (const c of cases) {
      const d = decideStamp({ key: c.key, row: { key: c.key, is_active: true, category: c.category }, evidence: goodEvidence, records: 10, today });
      expect(d.ok, c.key).toBe(false);
      if (!d.ok) expect(d.status, c.key).toBe(409);
    }
  });

  it('refuses unknown and inactive keys', () => {
    expect(decideStamp({ key: 'nope', row: null, evidence: goodEvidence, records: 1, today })).toMatchObject({ ok: false, status: 404 });
    expect(decideStamp({ key: 'tier2_sblo', row: { ...curated, is_active: false }, evidence: goodEvidence, records: 1, today })).toMatchObject({ ok: false, status: 409 });
  });

  it('accepts a stamp with a record count and cited evidence, and records the evidence in notes', () => {
    const d = decideStamp({ key: 'tier2_sblo', row: curated, evidence: goodEvidence, records: '200', today });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.update.last_built).toBe(today);
      expect(d.update.record_count).toBe(200);
      expect(d.update.notes.startsWith('The 2,700+ contractor DB\n')).toBe(true);
      expect(d.update.notes).toContain('[stamped 2026-11-17] records=200 evidence=Re-verified 41 SBLO');
    }
  });
});
