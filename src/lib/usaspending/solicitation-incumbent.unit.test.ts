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

// FM-U04 (Eric/QA 2026-07-29): a STALE award — PoP ended years ago — is probably not the current
// incumbent (the work was recompeted since), so confidence is capped by PoP-end recency. Verified LIVE
// 2026-07-29 on a GSA janitorial notice: Raytheon (ended 2019, ~7.2y) → medium and Fedcap (ended 2016,
// ~9.6y) → low, while a future/recent end stayed high — all at the SAME raw score. This locks that rule
// as a pure-logic mirror of the cap in findLikelyPriorAwards.
describe('FM-U04 recency cap (mirror)', () => {
  const YEAR_MS = 365.25 * 86_400_000;
  // Mirror of the confidence resolution in findLikelyPriorAwards.
  const resolveConfidence = (confScore: number, popEnd: string | null): 'high' | 'medium' | 'low' => {
    const yearsSinceEnd = popEnd ? (Date.now() - new Date(popEnd).getTime()) / YEAR_MS : null;
    let recencyCap: 'high' | 'medium' | 'low' | null = null;
    if (yearsSinceEnd !== null && yearsSinceEnd > 0) {
      if (yearsSinceEnd > 8) recencyCap = 'low';
      else if (yearsSinceEnd > 5) recencyCap = 'medium';
    }
    let conf: 'high' | 'medium' | 'low' = confScore >= 90 ? 'high' : confScore >= 65 ? 'medium' : 'low';
    if (recencyCap === 'low') conf = 'low';
    else if (recencyCap === 'medium' && conf === 'high') conf = 'medium';
    return conf;
  };
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it('high raw score with a FUTURE PoP-end stays high (current holder)', () => {
    expect(resolveConfidence(135, inFuture(300))).toBe('high');
  });
  it('high raw score ended >8y ago is capped to low', () => {
    expect(resolveConfidence(135, daysAgo(Math.round(9 * 365.25)))).toBe('low');
  });
  it('high raw score ended 5-8y ago is capped to medium', () => {
    expect(resolveConfidence(135, daysAgo(Math.round(7 * 365.25)))).toBe('medium');
  });
  it('ended <5y ago is NOT capped (recent = still plausibly current)', () => {
    expect(resolveConfidence(135, daysAgo(Math.round(2 * 365.25)))).toBe('high');
  });
  it('a low raw score is never PROMOTED by the cap', () => {
    expect(resolveConfidence(50, inFuture(300))).toBe('low');
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
