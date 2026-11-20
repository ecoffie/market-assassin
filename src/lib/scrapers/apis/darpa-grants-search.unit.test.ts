/**
 * DARPA Grants.gov search — fixture captured 2026-11-19 from
 * POST https://api.grants.gov/v1/api/search2 (agency filter DOD-DARPA-*).
 * hitCount was 4. The token field from that response is not in this fixture.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darpaHitsFromSearch } from './darpa-grants-search';
import { researchInstancePatch } from '../research-instance-stamp';

const live = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/darpa-grants-2026-11-19.json'), 'utf8'),
);

describe('darpaHitsFromSearch — live Grants.gov payload', () => {
  it('keeps the four DARPA-attributed announcements and their dates', () => {
    const parsed = darpaHitsFromSearch(live);
    expect(parsed.error).toBeUndefined();
    expect(parsed.hitCount).toBe(4);
    expect(parsed.hits.map((h) => h.number)).toEqual([
      'HR001125S0011',
      'HR001126S0015',
      'HR001126S0011',
      'DARPARA2701',
    ]);
    const yfa = parsed.hits.find((h) => h.number === 'DARPARA2701')!;
    expect(yfa.title).toMatch(/Young Faculty Award/);
    expect(yfa.agencyCode).toBe('DOD-DARPA-DSO');
    expect(yfa.agency).toBe('DARPA - Defense Sciences Office');
    expect(yfa.openDate).toBe('10/20/2026');
    expect(yfa.closeDate).toBe('01/13/2027');
    expect(parsed.hits.every((h) => h.agencyCode.startsWith('DOD-DARPA-'))).toBe(true);
  });

  it('drops a non-DARPA hit instead of attributing it to DARPA', () => {
    const payload = structuredClone(live) as { data: { oppHits: Array<Record<string, string>>; hitCount: number } };
    payload.data.oppHits.push({
      id: '1',
      number: 'AFRL-1',
      title: 'Air Force research',
      agencyCode: 'DOD-AFRL',
      agency: 'Air Force Research Lab',
      openDate: '01/01/2026',
      closeDate: '02/01/2026',
      oppStatus: 'posted',
      docType: 'synopsis',
    });
    const parsed = darpaHitsFromSearch(payload);
    expect(parsed.hits.map((h) => h.agencyCode)).not.toContain('DOD-AFRL');
    expect(parsed.hits).toHaveLength(4);
  });

  it('zero attributed rows is a failure, not a quiet success', () => {
    const parsed = darpaHitsFromSearch({ errorcode: 0, data: { hitCount: 0, oppHits: [] } });
    expect(parsed.hits).toEqual([]);
    expect(parsed.error).toMatch(/0 opportunities/);
  });

  it('HTTP-shaped failure is not a hit count of zero', () => {
    const parsed = darpaHitsFromSearch({ errorcode: 1, msg: 'nope' });
    expect(parsed.hitCount).toBeNull();
    expect(parsed.error).toMatch(/errorcode 1/);
  });
});

describe('researchInstancePatch', () => {
  const now = '2026-11-19T12:00:00.000Z';

  it('a failed fetch is unreachable and does not invent an ingest clock', () => {
    const patch = researchInstancePatch({
      success: false, totalFound: 0, newCount: 0, updatedCount: 0, unchangedCount: 0, now,
    });
    expect(patch.source_state).toBe('unreachable');
    expect(patch.last_verified_ingest).toBeUndefined();
    expect(patch.last_data_advance).toBeUndefined();
  });

  it('landed new rows advance the data clock', () => {
    const patch = researchInstancePatch({
      success: true, totalFound: 4, newCount: 2, updatedCount: 0, unchangedCount: 2, now,
    });
    expect(patch.source_state).toBe('current');
    expect(patch.last_verified_ingest).toBe(now);
    expect(patch.last_data_advance).toBe(now);
  });

  it('a check that only matches existing rows is upstream_quiet, not a new advance', () => {
    const patch = researchInstancePatch({
      success: true, totalFound: 4, newCount: 0, updatedCount: 0, unchangedCount: 4, now,
    });
    expect(patch.source_state).toBe('upstream_quiet');
    expect(patch.last_data_advance).toBeUndefined();
    expect(patch.last_verified_ingest).toBe(now);
  });
});
