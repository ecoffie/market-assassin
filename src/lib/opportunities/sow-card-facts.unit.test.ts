import { describe, it, expect } from 'vitest';
import { extractSowCardFacts, sowCardFactsHasContent } from './sow-card-facts';

// All tests run with useLLMFallback: false — hermetic, no network. The regex layer covers
// unambiguous LPTA/best-value/tradeoff cases; the one case that WOULD escalate to the LLM
// (conflicting LPTA + best-value language) is asserted to come back null offline (proves the
// escalation gate doesn't silently invent an answer when the LLM is unavailable/disabled).

describe('extractSowCardFacts — brand name / brand-name-or-equal', () => {
  it('detects "similar or equal to <Brand>" and captures the brand (stopping at a line break)', async () => {
    // Real SOW text (from the 50-opp sample) line-wraps the model number onto its own line —
    // the capture correctly stops at the newline rather than reading into the next spec line.
    const text = 'CLIN 01: Similar or equal to Document Reader\nRegula 70X4M\nThe devices must meet the following specifications.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(true);
    expect(facts.brandName).toBe('Document Reader');
    expect(facts.evidence.brandName).toContain('Document Reader');
  });

  it('detects "BRAND NAME <Brand>" and captures the brand', async () => {
    const text = 'This is a BRAND-NAME STRATASYS, FILAMENT RED requirement. Evaluation criteria is Lowest Price Technically Acceptable (LPTA).';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(true);
    expect(facts.brandName).toBe('STRATASYS');
  });

  it('detects "salient characteristics" with no capturable brand name', async () => {
    const text = 'The item shall meet or exceed the salient characteristics described in the attached specification sheet for the compressor unit.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(true);
    expect(facts.brandName).toBeNull();
    expect(facts.evidence.brandName?.toLowerCase()).toContain('salient characteristics');
  });

  it('does NOT flag a bare "equal to X" with no brand-name signal (false-positive guard)', async () => {
    // Real false-positive class found on a 50-opp sample: generic spec language, not a
    // brand-name-or-equal clause.
    const text = 'Parts or material used shall be equal to or exceed the original requirements technical data for this repair.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(false);
    expect(facts.brandName).toBeNull();
  });

  it('does NOT flag "equal to" used for pay-grade/personnel comparisons', async () => {
    const text = 'Contractor personnel shall possess competence roughly equal to at the GS-5 through GS-9 level for this position.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(false);
  });
});

describe('extractSowCardFacts — evaluation basis', () => {
  it('detects LPTA', async () => {
    const text = 'Award will be made on a Lowest Price Technically Acceptable (LPTA) basis to the responsible offeror.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.evalBasis).toBe('lpta');
    expect(facts.evidence.evalBasis?.toLowerCase()).toContain('lowest price technically acceptable');
  });

  it('detects Best Value (unambiguous, no tradeoff/LPTA language)', async () => {
    const text = 'Evaluation criteria is Best Value. This needs to be delivered by August 21st.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.evalBasis).toBe('best_value');
  });

  it('detects an explicit trade-off basis', async () => {
    const text = 'The Government will use a best value tradeoff process weighing technical merit against price.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.evalBasis).toBe('tradeoff');
  });

  it('returns null (not a guess) when both LPTA and best-value language conflict and LLM is disabled', async () => {
    const text = 'This acquisition uses LPTA. Note: the best value trade-off process does not apply here per FAR 15.101.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.evalBasis).toBeNull();
  });

  it('returns null when no eval-basis language is present', async () => {
    const text = 'The contractor shall perform routine HVAC maintenance at the specified facility per the attached schedule.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.evalBasis).toBeNull();
  });
});

describe('extractSowCardFacts — set-aside from text + mismatch flag', () => {
  it('detects SDVOSB stated in the text', async () => {
    const text = 'This solicitation will be issued as an SDVOSB set aside. All responsible sources may submit a proposal.';
    const facts = await extractSowCardFacts(text, 'SDVOSBC', { useLLMFallback: false });
    expect(facts.setAsideFromText).toBe('SDVOSB');
    expect(facts.setAsideMismatch).toBe(false); // same family as structured SDVOSBC
  });

  it('matches the raw coded suffix form (SDVOSBC) inline in a metadata field', async () => {
    const text = 'GENERAL INFORMATION\nSET-ASIDE\n\nSDVOSBC\n\nPRODUCT SERVICE CODE\n\nZ2DA\n\nNAICS CODE\n\n236220';
    const facts = await extractSowCardFacts(text, 'SDVOSBC', { useLLMFallback: false });
    expect(facts.setAsideFromText).toBe('SDVOSB');
  });

  it('flags a genuine mismatch between structured code and text assertion', async () => {
    const text = 'This solicitation will be issued as an SDVOSB set aside. All responsible sources may submit a proposal.';
    const facts = await extractSowCardFacts(text, 'SBA', { useLLMFallback: false }); // structured says generic small business
    expect(facts.setAsideFromText).toBe('SDVOSB');
    expect(facts.setAsideMismatch).toBe(true);
  });

  it('does NOT flag a mismatch when the structured code is null (the gap-fill case)', async () => {
    const text = 'This acquisition is set-aside for small business concerns under the 8(a) program.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    expect(facts.setAsideFromText).toBe('8(a)');
    expect(facts.setAsideMismatch).toBe(false);
  });

  it('ignores an SF-1449 checklist LEGEND (every category listed, none selected)', async () => {
    const text = 'Socioeconomic Status (Check all that apply):\n'
      + '( ) Small Business ( ) SDB ( ) HUBZone ( ) Woman-Owned SB\n'
      + '( ) SDVOSB ( ) 8(a) ( ) EDWOSB ( ) Other – Please State:\n'
      + 'Point of Contact Name/Phone Number: _______';
    const facts = await extractSowCardFacts(text, 'SBA', { useLLMFallback: false });
    expect(facts.setAsideFromText).toBeNull();
    expect(facts.setAsideMismatch).toBe(false);
  });

  it('ignores an UNCHECKED FAR-clause checkbox line as a negative, not an assertion', async () => {
    const text = '☐ 52.219-4 Notice of Price Evaluation Preference for HUBZone Small Business Concerns (Nov 2025)\n'
      + '☒ 52.219-6 Notice of Total Small Business Set-Aside (Nov 2025)';
    const facts = await extractSowCardFacts(text, 'SBA', { useLLMFallback: false });
    expect(facts.setAsideFromText).toBe('100% Small Business');
    expect(facts.setAsideMismatch).toBe(false);
  });

  it('ignores a FAR 52.212-3 Offeror Representations definitions clause (boilerplate, not an assertion)', async () => {
    const text = 'FAR 52.212-3 – Offeror Representations and Certifications—Commercial Items (Nov 2015)\n'
      + '(a) Definitions. As used in this provision—\n'
      + '“Economically disadvantaged women-owned small business (EDWOSB) concern” means a\n'
      + 'small business concern that is at least 51 percent directly and unconditionally owned by, and the\n'
      + 'management and daily business operations of which are controlled by, one or more women who\n'
      + 'are citizens of the United States and who are economically disadvantaged. It automatically qualifies\n'
      + 'as a women-owned small business eligible under the WOSB Program.';
    const facts = await extractSowCardFacts(text, 'SBA', { useLLMFallback: false });
    expect(facts.setAsideFromText).toBeNull();
    expect(facts.setAsideMismatch).toBe(false);
  });
});

describe('extractSowCardFacts — grounding + edge cases', () => {
  it('returns all-null facts for short/empty SOW text (never fabricates)', async () => {
    const facts = await extractSowCardFacts('', null, { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(false);
    expect(facts.evalBasis).toBeNull();
    expect(facts.setAsideFromText).toBeNull();
    expect(facts.setAsideMismatch).toBe(false);
  });

  it('returns all-null facts for null sowText', async () => {
    const facts = await extractSowCardFacts(null, 'SBA', { useLLMFallback: false });
    expect(facts.brandNameOrEqual).toBe(false);
    expect(facts.evalBasis).toBeNull();
    expect(facts.setAsideFromText).toBeNull();
  });

  it('every non-null fact carries a verbatim evidence span present in the source text', async () => {
    const text = 'Similar or equal to Document Reader Regula 70X4M. Award will use Lowest Price Technically Acceptable (LPTA). This is an SDVOSB set aside.';
    const facts = await extractSowCardFacts(text, null, { useLLMFallback: false });
    if (facts.brandNameOrEqual && facts.evidence.brandName) {
      expect(text.toLowerCase()).toContain(facts.evidence.brandName.toLowerCase());
    }
    if (facts.evalBasis && facts.evidence.evalBasis) {
      expect(text.toLowerCase()).toContain(facts.evidence.evalBasis.toLowerCase());
    }
    if (facts.setAsideFromText && facts.evidence.setAside) {
      expect(text.toLowerCase()).toContain(facts.evidence.setAside.toLowerCase());
    }
  });

  it('computedAt is a valid ISO timestamp', async () => {
    const facts = await extractSowCardFacts('some placeholder SOW text over fifty characters long', null, { useLLMFallback: false });
    expect(() => new Date(facts.computedAt).toISOString()).not.toThrow();
  });
});

describe('sowCardFactsHasContent', () => {
  it('is true when any fact is present', async () => {
    const facts = await extractSowCardFacts('This is a Best Value acquisition per the solicitation.', null, { useLLMFallback: false });
    expect(sowCardFactsHasContent(facts)).toBe(true);
  });

  it('is false when nothing was found', async () => {
    const facts = await extractSowCardFacts('Routine janitorial services at the specified facility per the attached schedule of work.', null, { useLLMFallback: false });
    expect(sowCardFactsHasContent(facts)).toBe(false);
  });
});
