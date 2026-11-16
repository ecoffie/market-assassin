import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/usaspending/solicitation-incumbent', async (orig) => ({
  ...(await orig<object>()),
  resolveSolicitationIncumbent: vi.fn(async () => { throw new Error('network is not used in unit tests'); }),
}));

import { noticeBuyerFacts, incumbentFactsFromResult, loadSelectedNoticeFacts, formatSelectedNoticeFacts, type SelectedNoticeRecord } from './selected-notice';
import { INCUMBENT_ABSENCE_NOTES, type SolicitationIncumbentResult } from '@/lib/usaspending/solicitation-incumbent';

// The SPRPA127RUA05 shape from the parity audit: `office` is null, the buyer lives in the hierarchy.
const SPRPA = {
  notice_id: '1a02451bf3e04edf93f56216c2113d73', title: '70--INTERFACE UNIT,DATA', solicitation_number: 'SPRPA127RUA05',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEFENSE LOGISTICS AGENCY', office: null, notice_type: 'Solicitation',
  set_aside_description: null, naics_code: '334111', psc_code: '7B22', posted_date: null, response_deadline: '2026-12-14T18:00:00Z',
  pop_city: null, pop_state: null, description: null, sow_text: null, ui_link: null, active: true,
  agency_hierarchy: 'DEPT OF DEFENSE.DEFENSE LOGISTICS AGENCY.DLA AVIATION.DLA AVIATION AT PHILADELPHIA, PA',
  office_address: { city: 'PHILADELPHIA', state: 'PA' },
  points_of_contact: [{ type: 'primary', fullName: 'Keli Barish', email: 'KELI.BARISH@DLA.MIL' }],
} as unknown as SelectedNoticeRecord;

function result(finding: string, extra: Partial<SolicitationIncumbentResult> = {}): SolicitationIncumbentResult {
  return {
    queried: SPRPA.notice_id, notice: null, incumbent: null, prior_awards: [], summary: null,
    _meta: { grounded_notice: true, grounded_incumbent: finding === 'identified', degraded: false, notice_source: null, incumbent_finding: finding },
    ...extra,
  } as unknown as SolicitationIncumbentResult;
}
const award = { recipientName: 'NORTHROP GRUMMAN', awardId: 'SPE8EN22F2859', naicsCode: '336413', pscCode: '7B22', popPotentialEnd: '2027-01-01' };

describe('noticeBuyerFacts', () => {
  it('SPRPA127RUA05: buyer from the hierarchy leaf, DoDAAC SPRPA1, the notice contact', () => {
    expect(noticeBuyerFacts(SPRPA)).toEqual({
      buyer_office: 'DLA AVIATION AT PHILADELPHIA, PA',
      office_city: 'PHILADELPHIA, PA',
      dodaac: 'SPRPA1',
      contact: { name: 'Keli Barish', title: null, email: 'KELI.BARISH@DLA.MIL', phone: null },
    });
  });
  it('a phone stored in the name field is the phone, not a person (live SPRPA127RUA05 record)', () => {
    const f = noticeBuyerFacts({ ...SPRPA, points_of_contact: [{ type: 'primary', fullName: 'Telephone: 2157373861', email: 'KELI.BARISH@DLA.MIL' }] } as SelectedNoticeRecord);
    expect(f.contact).toEqual({ name: null, title: null, email: 'KELI.BARISH@DLA.MIL', phone: '2157373861' });
  });
  it('absent facts stay null (never filled in)', () => {
    const f = noticeBuyerFacts({ ...SPRPA, agency_hierarchy: null, office_address: null, points_of_contact: null, solicitation_number: '12345' } as SelectedNoticeRecord);
    expect(f).toEqual({ buyer_office: null, office_city: null, dodaac: null, contact: null });
  });
});

describe('incumbentFactsFromResult: stated exactly as the tool states it', () => {
  it('identified → the award, which may be named', () => {
    const f = incumbentFactsFromResult(result('identified', { incumbent: award as never }));
    expect(f.finding).toBe('identified');
    expect(f.award).toMatchObject({ recipient: 'NORTHROP GRUMMAN', award_id: 'SPE8EN22F2859' });
  });
  it('candidate_not_confirmed → the absence note and the candidate, labelled as not the incumbent', () => {
    const f = incumbentFactsFromResult(result('candidate_not_confirmed', { prior_awards: [award as never] }));
    expect(f.note).toBe(INCUMBENT_ABSENCE_NOTES.candidate_not_confirmed);
    const lines = formatSelectedNoticeFacts({ ...noticeBuyerFacts(SPRPA), incumbent: f }).join('\n');
    expect(lines).toContain('NOT identified as the incumbent');
    expect(lines).toContain('NAICS 336413');
    expect(lines).not.toMatch(/Incumbent award:/);
  });
  it.each(['not_found', 'search_failed', 'notice_not_found'])('%s → its absence note, no award', (finding) => {
    const f = incumbentFactsFromResult(result(finding, { prior_awards: [award as never] }));
    expect(f.finding).toBe(finding);
    expect(f.note).toBe(INCUMBENT_ABSENCE_NOTES[finding as keyof typeof INCUMBENT_ABSENCE_NOTES]);
    expect(f.award).toBeNull();
  });
});

describe('loadSelectedNoticeFacts', () => {
  it('a slow incumbent lookup → not_checked within the budget (answer is never blocked)', async () => {
    const started = Date.now();
    const f = await loadSelectedNoticeFacts(SPRPA, { timeoutMs: 30, resolveIncumbent: () => new Promise(() => {}) });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(f.incumbent.finding).toBe('not_checked');
    expect(f.incumbent.note).toMatch(/Never say there is no incumbent/);
    expect(f.dodaac).toBe('SPRPA1');
  });
  it('a failing incumbent lookup → not_checked, not an error', async () => {
    const f = await loadSelectedNoticeFacts(SPRPA, { resolveIncumbent: async () => { throw new Error('down'); } });
    expect(f.incumbent.finding).toBe('not_checked');
  });
  it('passes the selected notice id to the resolver', async () => {
    const resolve = vi.fn(async () => result('not_found'));
    await loadSelectedNoticeFacts(SPRPA, { resolveIncumbent: resolve });
    expect(resolve).toHaveBeenCalledWith('1a02451bf3e04edf93f56216c2113d73');
  });
});

describe('formatSelectedNoticeFacts', () => {
  it('points the planner at the office roster with the DoDAAC', () => {
    const lines = formatSelectedNoticeFacts({ ...noticeBuyerFacts(SPRPA), incumbent: incumbentFactsFromResult(result('not_found')) }).join('\n');
    expect(lines).toContain('Office DoDAAC: SPRPA1');
    expect(lines).toContain('search_federal_contacts');
    expect(lines).toContain('Notice point of contact: Keli Barish, KELI.BARISH@DLA.MIL');
  });
});
