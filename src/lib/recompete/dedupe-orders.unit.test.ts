import { describe, it, expect } from 'vitest';
import { dedupeRecompeteRows, recompeteNaturalKey } from './dedupe-orders';

/**
 * Fixtures are the real prod rows measured 2026-10-02 (trimmed to the fields that matter).
 * The stale id answers 404 at USASpending; the fresh one 200.
 */
const DOI_FRESH = {
  contract_id: 'CONT_AWD_140D0426F0336_1406_140D0426A8062_1406',
  piid: '140D0426F0336', incumbent_uei: 'FLA5VXCREQC4', awarding_agency: 'Department of the Interior',
  period_of_performance_current_end: '2027-03-29', total_obligation: 296135.44, naics_code: '541511',
  last_synced_at: '2026-10-02T08:27:04.553+00:00', set_aside_enriched: null as string | null,
};
const DOI_STALE = {
  ...DOI_FRESH,
  contract_id: 'CONT_AWD_140D0426F0336_1406_20343125A00001_2036',
  last_synced_at: '2026-09-17T15:26:14.316+00:00', set_aside_enriched: 'SB-Total',
};
const TYLER_FRESH = {
  contract_id: 'CONT_AWD_05GA0A26F0058_0559_47QTCA23D00C2_4732',
  piid: '05GA0A26F0058', incumbent_uei: 'M23WHK6U2RJ3', awarding_agency: 'Government Accountability Office',
  period_of_performance_current_end: '2027-08-11', total_obligation: 178054, naics_code: '541511',
  last_synced_at: '2026-10-02T08:27:04.553+00:00',
};
// The re-parent moved the NAICS too — NAICS must not be part of the key.
const TYLER_STALE = { ...TYLER_FRESH, contract_id: 'CONT_AWD_05GA0A26F0058_0559_GS35F0240P_4730', naics_code: '511210', last_synced_at: '2026-09-23T09:27:37.322+00:00' };

describe('dedupeRecompeteRows', () => {
  it('collapses a re-parented order to the freshest-synced row, whichever comes first', () => {
    for (const input of [[DOI_STALE, DOI_FRESH], [DOI_FRESH, DOI_STALE]]) {
      const r = dedupeRecompeteRows(input);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].contract_id).toBe(DOI_FRESH.contract_id);
      expect(r.collapsed).toBe(1);
    }
  });

  it('collapses the Tyler Federal pair even though the two rows carry different NAICS', () => {
    const r = dedupeRecompeteRows([TYLER_STALE, TYLER_FRESH]);
    expect(r.rows.map((x) => x.contract_id)).toEqual([TYLER_FRESH.contract_id]);
    expect(r.rows[0].naics_code).toBe('541511');
  });

  it('carries the PIID-keyed set_aside_enriched from the stale sibling instead of losing it', () => {
    const r = dedupeRecompeteRows([DOI_FRESH, DOI_STALE]);
    expect(r.rows[0].contract_id).toBe(DOI_FRESH.contract_id);
    expect(r.rows[0].set_aside_enriched).toBe('SB-Total');
    expect(DOI_FRESH.set_aside_enriched).toBeNull(); // input not mutated
  });

  it('a legacy bare-PIID id loses to the CONT_AWD_ id (older sync, and the tie-break)', () => {
    const legacy = { ...TYLER_FRESH, contract_id: '05GA0A26F0058', last_synced_at: '2026-04-05T15:00:38Z' };
    expect(dedupeRecompeteRows([legacy, TYLER_FRESH]).rows[0].contract_id).toBe(TYLER_FRESH.contract_id);
    const tie = { ...legacy, last_synced_at: TYLER_FRESH.last_synced_at };
    expect(dedupeRecompeteRows([tie, TYLER_FRESH]).rows[0].contract_id).toBe(TYLER_FRESH.contract_id);
  });

  it('is deterministic on a full tie (lowest contract_id)', () => {
    const a = { ...DOI_FRESH, contract_id: 'CONT_AWD_B' };
    const b = { ...DOI_FRESH, contract_id: 'CONT_AWD_A' };
    expect(dedupeRecompeteRows([a, b]).rows[0].contract_id).toBe('CONT_AWD_A');
    expect(dedupeRecompeteRows([b, a]).rows[0].contract_id).toBe('CONT_AWD_A');
  });

  it('keeps distinct orders that share a PIID but differ in UEI, end date or value', () => {
    const otherUei = { ...DOI_STALE, incumbent_uei: 'ZZZZZZZZZZZZ' };
    const otherEnd = { ...DOI_STALE, period_of_performance_current_end: '2027-09-29' };
    const otherValue = { ...DOI_STALE, total_obligation: 1000 };
    const r = dedupeRecompeteRows([DOI_FRESH, otherUei, otherEnd, otherValue]);
    expect(r.rows).toHaveLength(4);
    expect(r.collapsed).toBe(0);
  });

  it('never merges rows whose key is unknown (missing PIID / UEI / end)', () => {
    const noUei = { ...DOI_FRESH, incumbent_uei: null };
    const noUei2 = { ...DOI_STALE, incumbent_uei: null };
    expect(recompeteNaturalKey(noUei)).toBeNull();
    expect(dedupeRecompeteRows([noUei, noUei2]).rows).toHaveLength(2);
  });

  it('preserves input order and counts: output + collapsed === input', () => {
    const input = [TYLER_STALE, DOI_FRESH, TYLER_FRESH, DOI_STALE];
    const r = dedupeRecompeteRows(input);
    expect(r.rows.map((x) => x.piid)).toEqual(['05GA0A26F0058', '140D0426F0336']);
    expect(r.rows.length + r.collapsed).toBe(input.length);
  });

  it('treats a numeric-string value equal to the number (PostgREST numeric can arrive as text)', () => {
    const asText = { ...DOI_STALE, total_obligation: '296135.44' };
    expect(recompeteNaturalKey(asText)).toBe(recompeteNaturalKey(DOI_FRESH));
  });
});
