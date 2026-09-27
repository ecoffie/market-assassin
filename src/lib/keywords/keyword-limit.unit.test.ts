import { describe, it, expect } from 'vitest';
import {
  KEYWORD_MAX_COUNT,
  keywordAddLimitError,
  keywordLimitError,
  normalizeKeywordInput,
  validateKeywordSave,
} from './sanitize';

/**
 * The shared keyword normalizer — the rules every user-input writer applies. Behaviour on the
 * real save handlers (writes, rejections, prior settings preserved, identical results across
 * Settings / onboarding / add-keywords) is proven in keyword-save-handlers.unit.test.ts.
 */

// The real list that was truncated (2026-09-24), in the order it was submitted.
const SUBMITTED_53 = 'artificial intelligence, AI governance, AI risk management, responsible AI, generative AI, intelligent automation, workflow automation, process automation, digital transformation, application modernization, software development, systems integration, data analytics, data management, decision support, operational intelligence, business intelligence, information management, case management, knowledge management, records management, evidence management, program management, project management, acquisition support, acquisition modernization, procurement modernization, contract management, compliance, auditability, traceability, provenance, human oversight, human-in-the-loop, cybersecurity, cloud modernization, FedRAMP, FISMA, data governance, privacy, Section 508, workforce development, AI literacy, digital literacy, instructional design, public health, health data, reporting application, regulated data, source selection, acquisition lifecycle, contract administration, market research';

describe('normalizeKeywordInput', () => {
  it('splits a pasted list on real separators and keeps the first spelling', () => {
    const r = normalizeKeywordInput(['Cyber Security, cloud; FedRAMP\nFISMA | fedramp', 'Cloud']);
    expect(r.keywords).toEqual(['Cyber Security', 'cloud', 'FedRAMP', 'FISMA']);
    expect(r.unusable).toEqual([]);
  });

  it('never splits on spaces — a multi-word keyword is one keyword', () => {
    expect(normalizeKeywordInput(['base operations support']).keywords).toEqual(['base operations support']);
  });

  it('reports — never drops — a bare NAICS code and an unsplittable blob', () => {
    const blob = 'a '.repeat(40).trim();
    const r = normalizeKeywordInput(['541511', blob, 'cybersecurity']);
    expect(r.keywords).toEqual(['cybersecurity']);
    expect(r.unusable.map((u) => u.reason)).toEqual(['naics_code', 'too_long']);
  });

  it('the submitted 53-keyword list survives intact', () => {
    expect(normalizeKeywordInput([SUBMITTED_53]).keywords).toHaveLength(53);
  });
});

describe('validateKeywordSave', () => {
  it(`accepts exactly ${KEYWORD_MAX_COUNT}; rejects ${KEYWORD_MAX_COUNT + 1} with the count`, () => {
    const at = Array.from({ length: KEYWORD_MAX_COUNT }, (_, i) => `term ${i}`);
    expect(validateKeywordSave(at)).toEqual({ ok: true, keywords: at });
    const over = validateKeywordSave([...at, 'one more']);
    expect(over).toMatchObject({ ok: false, code: 'keyword_limit', submitted: KEYWORD_MAX_COUNT + 1 });
  });

  it('rejects unusable entries before counting', () => {
    expect(validateKeywordSave(['541511'])).toMatchObject({ ok: false, code: 'keyword_unusable' });
  });
});

describe('limit messages', () => {
  it('a replacing save says how many to remove', () => {
    expect(keywordLimitError(63)).toBe(`You entered 63 keywords; the limit is ${KEYWORD_MAX_COUNT}. Nothing was saved — remove 3 and save again.`);
  });

  it('an ADDITIVE save describes what the user did — not "you entered 61"', () => {
    const full = keywordAddLimitError(KEYWORD_MAX_COUNT, 1);
    expect(full).toBe(`You have ${KEYWORD_MAX_COUNT} saved keywords; adding 1 would make ${KEYWORD_MAX_COUNT + 1}, over the limit of ${KEYWORD_MAX_COUNT}. Nothing was saved. Remove a saved keyword in Settings first.`);
    expect(full).not.toMatch(/You entered/);
    expect(keywordAddLimitError(58, 5)).toMatch(/Only 2 more fit/);
  });
});
