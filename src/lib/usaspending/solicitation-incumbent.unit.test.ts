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

// PSC + derived-work-word matcher (Eric 2026-08-03: a $77M L3Harris Army IDV was wrongly matched as
// the "likely incumbent" of a small BOP APX-radio buy — it shared only the broad NAICS 541519 and $).
// scoreAward isn't exported (pure internal), so source-assert the fix; the BEHAVIOR is live-verified
// (findLikelyPriorAwards returns 0 hits for the radio opp — no fabricated $77M incumbent).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const incSrc = readFileSync(join(__dirname, 'solicitation-incumbent.ts'), 'utf8');

describe('incumbent matcher — PSC + title-derived work-words (not a hardcoded list)', () => {
  it('derives distinctive work-words FROM THE TITLE, dropping non-distinctive procurement boilerplate', () => {
    // the old fixed WORK_WORDS list (radios/APX never in it) is demoted to a booster; the primary
    // signal is the title's own tokens minus a NONDISTINCTIVE set (equipment/procurement/services…)
    expect(incSrc).toContain('const NONDISTINCTIVE = new Set(');
    expect(incSrc).toMatch(/NONDISTINCTIVE[\s\S]{0,200}'equipment'/);
    expect(incSrc).toContain('const distinctive = titleWords.filter((w) => w.length >= 3 && !NONDISTINCTIVE.has(w.toLowerCase()))');
  });
  it('HARD-DISCOUNTS to 0 when no distinctive token AND no PSC match — a big same-NAICS IDV cannot win on $', () => {
    expect(incSrc).toContain('if (distinctive.length > 0 && distinctiveHits === 0 && !pscMatch) return 0');
  });
  it('a PSC match is a STRONG same-product signal (threaded through findLikelyPriorAwards → scoreAward)', () => {
    expect(incSrc).toMatch(/psc_code\?: string \| null;/);          // the input carries PSC
    expect(incSrc).toContain('scoreAward(r as never, titleWords, agencyHint, input.psc_code ?? null)');
    expect(incSrc).toContain('if (pscMatch) score += 45');           // PSC match = large boost
  });
  it('the amount signal stays capped at +5 — size never buys the match', () => {
    expect(incSrc).toContain('score += Math.min(5, Math.log10(Math.max(amt, 1)))');
  });
});

// Variance B (Eric 2026-08-03, the M-Estimate oracle sweep): a title's CUSTOMER/PLACE tokens
// ("national guard", "Brookhaven laboratory") were becoming search phrases + distinctive score
// tokens, so a giant award serving the same customer won — "Kitchen Equipment for Missouri National
// Guard" matched SIKORSKY's $11.6B National Guard aircraft IDV; "Carpentry at Brookhaven Lab" matched
// the lab operator. Fix: customer/place words are NONDISTINCTIVE (not the WORK) + stripped from the
// search phrases (SITE_NOISE). Live-verified: kitchen → a real $9M kitchen contractor; carpentry → none.
describe('incumbent matcher — variance B: customer/place tokens are not the work', () => {
  it('NONDISTINCTIVE drops customer/organization + place/site context words', () => {
    for (const w of ['national', 'guard', 'army', 'navy', 'federal', 'department', 'agency', 'command']) {
      expect(incSrc).toMatch(new RegExp(`'${w}'`)); // present in the NONDISTINCTIVE customer block
    }
    for (const w of ['facility', 'facilities', 'laboratory', 'base', 'station', 'center', 'depot']) {
      expect(incSrc).toMatch(new RegExp(`'${w}'`)); // present in the place block
    }
  });
  it('the search-phrase builder strips the same customer/place noise (SITE_NOISE)', () => {
    expect(incSrc).toMatch(/SITE_NOISE = new Set\(\[[\s\S]{0,400}'national', 'guard'/);
    // with a fallback so a customer-only title still searches SOMETHING
    expect(incSrc).toContain('const workish = stripped.length >= 2 ? stripped : words');
  });
  it('the generic-work booster respects NONDISTINCTIVE (so a customer-context "guard" gets no +20)', () => {
    expect(incSrc).toContain('GENERIC_WORK_WORDS.has(lw) && !NONDISTINCTIVE.has(lw) && desc.includes(lw)');
  });
});

// Variance C (Eric 2026-08-03, the M-Estimate sweep residual): "Sole Source"/"Notice of Intent"
// titles have almost no work-words, so they collapsed to the same generic keyword search → the same
// one giant award (dozens shared the identical wrong $1.06B median). Fix: notice-type / vehicle
// boilerplate is a search STOPWORD, so the search keys on the actual product. (The predecessor
// VALUE sanity-gate is asserted in opp-intel-value-gate.unit.test.ts.)
describe('incumbent matcher — variance C: notice-type boilerplate is a stopword', () => {
  it('STOP drops sole-source / notice-of-intent / RFQ vehicle words', () => {
    for (const w of ['sole', 'source', 'notice', 'intent', 'award', 'rfq', 'sources', 'sought']) {
      expect(incSrc).toMatch(new RegExp(`'${w}'`));
    }
  });
});
