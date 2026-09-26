import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { scoreOpportunityDetailed, type SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import { keywordEvidence, scoreKeywordEvidence, KEYWORD_EVIDENCE_WEIGHTS } from './open-contract-d';
import { renderMatchReason, renderStageLabel } from './match-evidence-copy';
import { CASE_PROFILE, CASE_ROWS, CASE_SENT_AT, asOpportunity } from './__fixtures__/alert-relevance-case';

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(CASE_SENT_AT)); });
afterAll(() => { vi.useRealTimers(); });

const byTitle = (t: string) => {
  const r = CASE_ROWS.find((x) => x.title.startsWith(t));
  if (!r) throw new Error(`fixture missing: ${t}`);
  return asOpportunity(r);
};
const ranked = (profile = CASE_PROFILE) => CASE_ROWS.map(asOpportunity)
  .map((o) => ({ o, ...scoreOpportunityDetailed(o, profile) }))
  .sort((a, b) => b.rank - a.rank);
const pos = (list: ReturnType<typeof ranked>, t: string) => list.findIndex((x) => x.o.title.startsWith(t));

describe('frozen case (2026-09-24 alert) — ranking follows evidence', () => {
  it('rank is not clamped: the live email tied 6 of 7 at 100', () => {
    const list = ranked();
    const ranks = new Set(list.map((x) => x.rank));
    expect(ranks.size).toBeGreaterThan(list.length - 3);
    for (const x of list) expect(x.score).toBeLessThanOrEqual(100);
  });

  it('the title-level AI match outranks a Special Notice that only mentions AI in a list', () => {
    const list = ranked();
    expect(pos(list, 'VA Enterprise Artificial Intelligence')).toBeLessThan(pos(list, 'Surface Transportation Systems Engineering'));
  });

  it('a ceiling-increase Special Notice (nothing to submit) ranks below every biddable/respondable row', () => {
    const list = ranked();
    const mtccs = pos(list, 'MTCCS II Ceiling Increase');
    const actionable = list.filter((x) => x.evidence.stage.respondability !== 'none').map((x) => pos(list, x.o.title));
    expect(Math.max(...actionable)).toBeLessThan(mtccs);
    expect(list[mtccs].evidence.stage.respondability).toBe('none');
  });

  it('genuine program-management title matches are preserved and outrank boilerplate-only body hits', () => {
    const list = ranked();
    const pma = list[pos(list, 'PMA-231 Program/Project Management')];
    expect(pma.evidence.keywords.title).toContain('project management');
    expect(pma.evidence.basis).toBe('keyword');
    // Warehouse support is in the market only via "compliance" in its description.
    const warehouse = list[pos(list, 'Warehouse Support Services')];
    expect(warehouse.evidence.keywords.title).toEqual([]);
    expect(pos(list, 'PMA-231')).toBeLessThan(pos(list, 'Warehouse Support Services'));
  });

  it('Think Trends (four description hits incl. workflow automation) stays in the top 3, above boilerplate and heads-up rows', () => {
    // Not asserted as #1: a TITLE-level program-management match (PMA-231) can
    // legitimately edge it. Which of two real fits leads is a weighting choice we
    // do not tune to one customer — see the PR's open items.
    const list = ranked();
    const tt = pos(list, 'Think Trends');
    expect(tt).toBeLessThan(3);
    expect(tt).toBeLessThan(pos(list, 'Warehouse Support Services'));
    expect(tt).toBeLessThan(pos(list, 'MTCCS II Ceiling Increase'));
  });

  it('agency evidence is anchored: FDA and FHWA are NOT "NIST"; VA and Navy are real', () => {
    const e = (t: string) => scoreOpportunityDetailed(byTitle(t), CASE_PROFILE).evidence.agencies;
    expect(e('Think Trends')).toEqual(['HHS']);
    expect(e('Surface Transportation')).toEqual(['DOT']);
    expect(e('VA Enterprise Artificial Intelligence')).toEqual(['VA']);
    expect(e('PMA-231')).toEqual(expect.arrayContaining(['DOD', 'Navy']));
    expect(e('FedRAMP Webex')).toEqual([]);
  });
});

describe('keyword evidence — title ≫ description, boilerplate cannot stack', () => {
  it('one title hit beats the most any number of description hits can add', () => {
    const w = KEYWORD_EVIDENCE_WEIGHTS;
    expect(w.titleEach).toBeGreaterThan(w.bodyEach * w.bodyMax);
    const body = keywordEvidence('Operations support', 'compliance privacy auditability traceability program management project management', CASE_PROFILE.keywords);
    const title = keywordEvidence('Records Management Support', '', CASE_PROFILE.keywords);
    expect(scoreKeywordEvidence(title)).toBeGreaterThan(scoreKeywordEvidence(body));
  });

  it('phrases stay intact — "program management" does not match "program" + "management" apart', () => {
    const e = keywordEvidence('Program support for facility management', '', ['program management']);
    expect(e.title).toEqual([]);
  });
});

describe('email copy — shows the evidence and the stage', () => {
  const opp = (t: string) => {
    const o = byTitle(t);
    const d = scoreOpportunityDetailed(o, CASE_PROFILE);
    return { ...o, evidence: d.evidence };
  };

  it('names the keyword and where it was found', () => {
    expect(renderMatchReason(opp('Think Trends'))).toMatch(/Keyword &ldquo;workflow automation&rdquo;.* in description · NAICS 541511|Keyword .*workflow automation.* in description &middot; NAICS 541511/);
    expect(renderMatchReason(opp('PMA-231'))).toMatch(/project management.* in title/);
  });

  it('never prints SAM\'s "NONE" set-aside literal as a reason', () => {
    for (const r of CASE_ROWS) expect(renderMatchReason(opp(r.title))).not.toMatch(/NONE/);
  });

  it('a market-only row says so — it is never labelled a keyword match', () => {
    const o = { ...byTitle('FedRAMP Webex'), title: 'Webex Subscription Maintenance', description: '' } as SAMOpportunity;
    const d = scoreOpportunityDetailed(o, CASE_PROFILE);
    expect(d.evidence.basis).toBe('market_only');
    expect(renderMatchReason({ ...o, evidence: d.evidence })).toMatch(/No keyword match/);
  });

  it('a ceiling-increase Special Notice reads as heads-up only, not a bid', () => {
    const label = renderStageLabel(opp('MTCCS II Ceiling Increase'));
    expect(label).toMatch(/^Heads-up only, nothing to submit/);
    expect(label).not.toMatch(/^Bid/);
    expect(renderStageLabel(opp('Think Trends'))).toMatch(/^Bid/);
    expect(renderStageLabel(opp('PTAG RFI'))).toMatch(/^Respond, not priced/);
  });
});

describe('unrelated profiles — the fix does not only work for one customer', () => {
  // A facilities firm and a construction firm scored against the same rows: none of
  // this market is theirs, so nothing may claim keyword support.
  const FACILITIES = { naics_codes: ['561720', '561210'], agencies: ['GSA', 'VA'], keywords: ['janitorial', 'custodial services', 'property maintenance'], business_type: 'Small Business', business_description: null, setAsides: [] };
  const CONSTRUCTION = { naics_codes: ['236220'], agencies: ['Army'], keywords: ['roofing', 'hvac replacement', 'general contractor'], business_type: 'SDVOSB', business_description: null, setAsides: [] };

  for (const [name, profile] of [['facilities', FACILITIES], ['construction', CONSTRUCTION]] as const) {
    it(`${name}: no keyword basis is fabricated from an IT/AI market`, () => {
      for (const x of ranked(profile)) expect(x.evidence.basis).toBe('market_only');
    });
  }

  it('facilities: a real janitorial title is keyword-supported and outranks a non-match', () => {
    const jan = { ...byTitle('FedRAMP Webex'), title: 'Central Great Plains Janitorial Services', naicsCode: '561720', department: 'VETERANS AFFAIRS, DEPARTMENT OF', subTier: 'VETERANS AFFAIRS, DEPARTMENT OF', description: '' } as SAMOpportunity;
    const other = { ...jan, title: 'Elevator Repair', noticeId: 'x2' } as SAMOpportunity;
    const a = scoreOpportunityDetailed(jan, FACILITIES);
    const b = scoreOpportunityDetailed(other, FACILITIES);
    expect(a.evidence.keywords.title).toEqual(['janitorial']);
    expect(a.evidence.agencies).toEqual(['VA']);
    expect(a.rank).toBeGreaterThan(b.rank);
  });
});
