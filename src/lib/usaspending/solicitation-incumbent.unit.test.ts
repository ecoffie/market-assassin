/**
 * Unit tests for solicitation→incumbent helpers (no live network).
 */
import { describe, expect, it } from 'vitest';
import {
  titleKeywordCandidates,
  toUsaSpendingAgency,
  summarizeSolicitationIncumbent,
} from '@/lib/usaspending/solicitation-incumbent';

describe('toUsaSpendingAgency', () => {
  it('maps INTERIOR, DEPARTMENT OF THE', () => {
    expect(toUsaSpendingAgency('INTERIOR, DEPARTMENT OF THE')).toBe('Department of the Interior');
  });
  it('maps BLM strings to Interior', () => {
    expect(toUsaSpendingAgency('BUREAU OF LAND MANAGEMENT')).toBe('Department of the Interior');
  });
});

describe('titleKeywordCandidates', () => {
  it('extracts Wheatland hoof trimming phrases', () => {
    const k = titleKeywordCandidates('WHEATLAND ORC HOOF TRIMMING SERVICES (BASE + 4 YEA');
    expect(k.some((x) => /wheatland/i.test(x) && /hoof/i.test(x))).toBe(true);
    expect(k.some((x) => /hoof trimming/i.test(x))).toBe(true);
  });
});

describe('summarizeSolicitationIncumbent', () => {
  it('covers notice + incumbent', () => {
    const s = summarizeSolicitationIncumbent(
      {
        notice_id: 'abc',
        solicitation_number: '140L6226Q0013',
        title: 'WHEATLAND ORC HOOF TRIMMING',
        agency: 'BLM',
        department: 'INTERIOR',
        naics_code: '115210',
        psc_code: 'F016',
        set_aside: 'SBA',
        notice_type: 'Combined',
        posted_date: null,
        response_deadline: null,
        ui_link: null,
        source: 'sam_public',
      },
      {
        awardId: '140L6221P0029',
        generatedId: 'x',
        description: 'WHEATLAND HOOF TRIMMING SERVICES',
        obligated: 601007,
        ceiling: 601007,
        currentValue: 601007,
        parentIdvId: null,
        parentIdvPiid: null,
        popStart: '2021-05-01',
        popEnd: '2026-08-31',
        popPotentialEnd: '2026-08-31',
        recipientName: 'MATT L KEIL',
        recipientCity: 'WHEATLAND',
        recipientState: 'WY',
        recipientCongressionalDistrict: '',
        recipientUei: 'L325N9N323E3',
        naicsCode: '115210',
        naicsDescription: '',
        pscCode: 'F016',
        pscDescription: '',
        awardingAgency: 'DOI',
        awardingSubAgency: 'BLM',
        awardingOffice: '',
        fundingAccount: null,
        usaSpendingUrl: 'https://www.usaspending.gov/',
        matchConfidence: 'high',
        matchScore: 100,
      },
    );
    expect(s).toMatch(/140L6226Q0013/);
    expect(s).toMatch(/MATT L KEIL/);
    expect(s).toMatch(/140L6221P0029/);
  });
});
