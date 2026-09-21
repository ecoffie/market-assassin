/**
 * Compliance scanner DQ traps (PT-04, Eric/QA 2026-07-28). Two precision bugs found running the
 * planted-violation matrix: (1) a draft that said "QC plan" was falsely flagged as missing a Quality
 * Control Plan because the check required the fully-spelled phrase; (2) "shall not exceed N pages" —
 * the single most common page-limit phrasing — was not detected because the regex required "not TO
 * exceed". Both fixed. These lock the fix + guard against a false-DQ regression on a compliant draft.
 */
import { describe, it, expect } from 'vitest';
import { scanProposalCompliance } from '@/mcp/tools/scan-compliance';

const scan = (requirement: string, draft_text: string, extra: Record<string, unknown> = {}) =>
  scanProposalCompliance({ requirements: [{ id: 'R', requirement }], draft_text, ...extra });

describe('QC Plan detection — no false-positive on the "QC plan" abbreviation (PT-04)', () => {
  it('a draft that says "QC plan" is NOT flagged as missing the Quality Control Plan', () => {
    const r = scan('The Offeror shall provide a Quality Control Plan', 'Our QC plan is documented and enforced.');
    expect(r.findings.some((f) => /quality control/i.test(f.title))).toBe(false);
  });
  it('a draft that genuinely omits any QC plan IS flagged (dq)', () => {
    const r = scan('The Offeror shall provide a Quality Control Plan', 'We will deliver widgets on time.');
    const f = r.findings.find((x) => /quality control/i.test(x.title));
    expect(f?.severity).toBe('dq');
  });
});

describe('page-limit extraction across phrasings, only fires when over (PT-04)', () => {
  const short = 'word '.repeat(300);      // ~1 page
  const long = 'word '.repeat(15000);     // ~30 pages
  const phrasings: Array<[string, number]> = [
    ['Proposal shall not exceed 5 pages', 5],
    ['The technical volume is not to exceed 10 pages', 10],
    ['Limited to 20 pages', 20],
    ['Volume II has a 15-page limit', 15],
    ['No more than 25 pages', 25],
  ];
  for (const [req, lim] of phrasings) {
    it(`"${req}" → DQ when over the ${lim}-page limit`, () => {
      const r = scan(req, long);
      const f = r.findings.find((x) => /page/i.test(x.title));
      expect(f, req).toBeTruthy();
      expect(f!.severity).toBe('dq');
      expect(f!.title).toContain(`${lim}-page`);
    });
    it(`"${req}" → NO page finding when under the limit`, () => {
      const r = scan(req, short);
      expect(r.findings.some((x) => /page/i.test(x.title))).toBe(false);
    });
  }
});

describe('S3 nits from v5 QA (PT-04)', () => {
  it('a set-aside named twice is NOT printed twice ("hubzone, hubzone" dedup)', () => {
    const r = scan('This HUBZone set-aside is restricted to HUBZone concerns', 'we are qualified', { bidder_set_asides: [] });
    const f = r.findings.find((x) => /set.aside/i.test(x.rule || ''));
    expect(f?.detail || '').not.toMatch(/hubzone.*hubzone/i);
  });
  it('a DELIVERY window is NOT flagged as the submission deadline', () => {
    const r = scan('The Contractor shall deliver all items within 120 days after award', 'ok');
    expect(r.findings.some((x) => /submission deadline/i.test(x.title))).toBe(false);
  });
  it('a period-of-performance clause is NOT flagged as the submission deadline', () => {
    const r = scan('The period of performance is 12 months from date of award', 'ok');
    expect(r.findings.some((x) => /submission deadline/i.test(x.title))).toBe(false);
  });
  it('a REAL submission deadline IS flagged', () => {
    const r = scan('Proposals are due no later than 3:00 PM EST on 15 August 2026', 'ok');
    expect(r.findings.some((x) => /submission deadline/i.test(x.title))).toBe(true);
  });
});

describe('set-aside eligibility (PT-04)', () => {
  it('a set-aside the bidder does not hold → dq', () => {
    const r = scan('This is set aside for SDVOSB concerns', 'we are qualified', { bidder_set_asides: [] });
    expect(r.findings.some((f) => f.severity === 'dq')).toBe(true);
  });
  it('a set-aside the bidder DOES hold → no dq', () => {
    const r = scan('This is set aside for SDVOSB concerns', 'we are qualified', { bidder_set_asides: ['SDVOSB'] });
    expect(r.findings.some((f) => f.severity === 'dq')).toBe(false);
  });
});
