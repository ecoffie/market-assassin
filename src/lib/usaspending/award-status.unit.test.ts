/**
 * R5 (Ask Mindy Phase 1): award status against TODAY + an honest successor probe.
 * HTTP is mocked; dates are injected (never the real clock).
 */
import { describe, it, expect, vi } from 'vitest';
import { computeAwardStatus, probeSuccessor, descriptionTerms, piidOfficePrefix } from './award-status';
import type { AwardDetail } from './award-detail';

const NOW = new Date('2026-11-13T15:00:00Z');

function award(over: Partial<AwardDetail> = {}): AwardDetail {
  return {
    awardId: 'N0018921F3006',
    generatedId: 'CONT_AWD_N0018921F3006_9700_N0017819D7162_9700',
    description: 'CNIC HQ/NAVY PERSONNEL COMMAND (NPC) IDENTIFICATION CARD ADMINISTRATION (ICA) SUPPORT SERVICES',
    recipientName: 'MAGELLAN FEDERAL, INC.',
    recipientCity: '', recipientState: '', recipientCongressionalDistrict: '', recipientUei: '',
    obligated: 1, currentValue: 1, ceiling: 1,
    parentIdvId: null, parentIdvPiid: null,
    popStart: '2021-01-14', popEnd: '2026-07-31', popPotentialEnd: '2026-07-31',
    naicsCode: '541330', naicsDescription: '', pscCode: 'R699', pscDescription: '',
    awardingAgency: 'Department of Defense', awardingSubAgency: 'Department of the Navy', awardingOffice: '',
    fundingAccount: null, usaSpendingUrl: '',
    ...over,
  };
}

describe('computeAwardStatus', () => {
  it('expired when today is after the current end date, with negative days_until_end', () => {
    const s = computeAwardStatus(award(), NOW);
    expect(s.status).toBe('expired');
    expect(s.days_until_end).toBe(-105);
    expect(s.status_basis.end_date_used).toBe('2026-07-31');
    expect(s.status_basis.end_date_field).toBe('period_of_performance.end_date');
    expect(s.status_basis.as_of).toBe('2026-11-13');
  });

  it('end date is inclusive: active on the last day, expired the day after', () => {
    expect(computeAwardStatus(award({ popEnd: '2026-11-13', popPotentialEnd: '2026-11-13' }), NOW).status).toBe('active');
    expect(computeAwardStatus(award({ popEnd: '2026-11-13' }), NOW).days_until_end).toBe(0);
    expect(computeAwardStatus(award({ popEnd: '2026-11-12', popPotentialEnd: '2026-11-12' }), NOW).status).toBe('expired');
  });

  it('uses the CURRENT end, not unexercised options, and says so', () => {
    const s = computeAwardStatus(award({ popEnd: '2026-09-30', popPotentialEnd: '2028-09-30' }), NOW);
    expect(s.status).toBe('expired');
    expect(s.status_basis.note).toContain('Unexercised options run to 2028-09-30');
  });

  it('not_started before the start date; unknown with no end date', () => {
    expect(computeAwardStatus(award({ popStart: '2027-01-01', popEnd: '2028-01-01' }), NOW).status).toBe('not_started');
    const u = computeAwardStatus(award({ popEnd: null, popPotentialEnd: null }), NOW);
    expect(u.status).toBe('unknown');
    expect(u.days_until_end).toBeNull();
  });

  it('falls back to potential end only when the current end is missing', () => {
    const s = computeAwardStatus(award({ popEnd: null, popPotentialEnd: '2027-03-01' }), NOW);
    expect(s.status).toBe('active');
    expect(s.status_basis.end_date_field).toBe('period_of_performance.potential_end_date');
  });

  it('computes today in US Eastern time (an evening-ET call is still today, not tomorrow)', () => {
    const lateEt = new Date('2026-11-14T03:30:00Z'); // 22:30 ET on Nov 13
    expect(computeAwardStatus(award({ popEnd: '2026-11-13' }), lateEt).status).toBe('active');
  });
});

describe('helpers', () => {
  it('piidOfficePrefix takes the 6-char office code', () => {
    expect(piidOfficePrefix('N0018921F3006')).toBe('N00189');
    expect(piidOfficePrefix('W912EQ26CA009')).toBe('W912EQ');
    expect(piidOfficePrefix('ABC')).toBeNull();
  });
  it('descriptionTerms drops generic words but keeps distinctive acronyms', () => {
    const t = descriptionTerms('CNIC HQ/NAVY PERSONNEL COMMAND (NPC) IDENTIFICATION CARD ADMINISTRATION (ICA) SUPPORT SERVICES');
    expect(t.has('ica')).toBe(true);
    expect(t.has('identification')).toBe(true);
    expect(t.has('services')).toBe(false);
    expect(t.has('navy')).toBe(false);
  });
});

type Row = Record<string, unknown>;
function mockFetcher(byCode: { naics?: Row[]; psc?: Row[] }, opts: { fail?: boolean } = {}) {
  return vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (opts.fail) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    const body = JSON.parse(String(init?.body));
    const isNaics = !!body.filters.naics_codes;
    const rows = body.page === 1 ? (isNaics ? byCode.naics : byCode.psc) ?? [] : [];
    return { ok: true, status: 200, json: async () => ({ results: rows, page_metadata: { hasNext: false } }) } as unknown as Response;
  }) as unknown as typeof fetch;
}

const row = (id: string, desc: string, start: string, recipient = 'X LLC'): Row => ({
  'Award ID': id, 'Recipient Name': recipient, 'Award Amount': 1000, Description: desc,
  'Start Date': start, 'End Date': '2030-01-01', generated_internal_id: `CONT_AWD_${id}`,
});

describe('probeSuccessor', () => {
  it('returns candidates with the evidence used, filtered to office prefix + window + shared terms', async () => {
    const f = mockFetcher({
      psc: [
        row('N0018926FD111', 'MNCC ICA CONUS ID SERVICES', '2026-07-16', 'GEMINI TECH SERVICES LLC'),
        row('N0018926PZ019', 'USNCC DATA ANALYTICS SUPPORT', '2026-01-12'), // no shared term
        row('W912EQ26CA009', 'IDENTIFICATION CARD SERVICES', '2026-08-01'), // other office
        row('N0018921F3006', 'IDENTIFICATION CARD ADMINISTRATION', '2021-01-14'), // the award itself
        row('N0018924F0001', 'IDENTIFICATION CARD SERVICES', '2024-01-01'), // starts before window
      ],
      naics: [row('N0018926FD111', 'MNCC ICA CONUS ID SERVICES', '2026-07-16', 'GEMINI TECH SERVICES LLC')],
    });
    const p = await probeSuccessor(award(), '2026-07-31', NOW, f);
    expect(p.state).toBe('candidates');
    expect(p.candidates.map((c) => c.awardId)).toEqual(['N0018926FD111']);
    const c = p.candidates[0];
    expect(c.evidence.same_piid_office_prefix).toBe('N00189');
    expect(c.evidence.matched_code_filters).toEqual(['naics', 'psc']);
    expect(c.evidence.shared_description_terms).toEqual(['ica']);
    expect(c.evidence.start_days_from_old_end).toBe(-15);
    expect(c.strength).toBe('likely');
    expect(p.checked.start_window).toEqual({ from: '2025-07-31', to: '2026-11-13' });
    // every request is office-anchored on the prefix keyword and bounded by the window
    const bodies = (f as unknown as { mock: { calls: [unknown, { body: string }][] } }).mock.calls.map((x) => JSON.parse(x[1].body));
    expect(bodies.every((b) => b.filters.keywords[0] === 'N00189')).toBe(true);
    expect(bodies.some((b) => b.filters.psc_codes?.[0] === 'R699')).toBe(true);
    expect(bodies.some((b) => b.filters.naics_codes?.require?.[0] === '541330')).toBe(true);
  });

  it('checked, none found: says what was checked (never silent)', async () => {
    const f = mockFetcher({ psc: [row('N0018926PZ019', 'USNCC DATA ANALYTICS SUPPORT', '2026-01-12')], naics: [] });
    const p = await probeSuccessor(award(), '2026-07-31', NOW, f);
    expect(p.state).toBe('none_found');
    expect(p.candidates).toEqual([]);
    expect(p.checked.piid_office_prefix).toBe('N00189');
    expect(p.checked.same_office_same_code_rows).toBe(1);
    expect(p.note).toContain('Checked: awards from office prefix N00189');
    expect(p.note).toContain('No successor found');
  });

  it('source error is "unavailable", never "none_found"', async () => {
    const p = await probeSuccessor(award(), '2026-07-31', NOW, mockFetcher({}, { fail: true }));
    expect(p.state).toBe('unavailable');
  });

  it('does not run without an office prefix or codes', async () => {
    const f = mockFetcher({});
    expect((await probeSuccessor(award({ awardId: 'ABC' }), '2026-07-31', NOW, f)).state).toBe('not_checked');
    expect((await probeSuccessor(award({ naicsCode: '', pscCode: '' }), '2026-07-31', NOW, f)).state).toBe('not_checked');
    expect(f).not.toHaveBeenCalled();
  });
});
