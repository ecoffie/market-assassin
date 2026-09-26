import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeKeywords, KEYWORD_MAX_COUNT, keywordLimitError } from './sanitize';

/**
 * NEVER SILENTLY DISCARD KEYWORDS. A customer saved 53 keywords (2026-09-24); the
 * Settings save kept the first 40 with a success response. Every writer now either
 * stores the full list or rejects the save with nothing written.
 */

// The real list that was truncated, in the order it was submitted.
const SUBMITTED_53 = 'artificial intelligence, AI governance, AI risk management, responsible AI, generative AI, intelligent automation, workflow automation, process automation, digital transformation, application modernization, software development, systems integration, data analytics, data management, decision support, operational intelligence, business intelligence, information management, case management, knowledge management, records management, evidence management, program management, project management, acquisition support, acquisition modernization, procurement modernization, contract management, compliance, auditability, traceability, provenance, human oversight, human-in-the-loop, cybersecurity, cloud modernization, FedRAMP, FISMA, data governance, privacy, Section 508, workforce development, AI literacy, digital literacy, instructional design, public health, health data, reporting application, regulated data, source selection, acquisition lifecycle, contract administration, market research'
  .split(',').map((s) => s.trim());

describe('shared keyword limit', () => {
  it('the submitted 53-keyword list fits the shared limit', () => {
    expect(SUBMITTED_53).toHaveLength(53);
    expect(KEYWORD_MAX_COUNT).toBeGreaterThanOrEqual(SUBMITTED_53.length);
    const r = sanitizeKeywords(SUBMITTED_53);
    expect(r.keywords).toHaveLength(53);
    expect(r.overLimit).toEqual([]);
  });

  it('reports what is over the limit instead of dropping it silently', () => {
    const many = Array.from({ length: KEYWORD_MAX_COUNT + 3 }, (_, i) => `term ${i}`);
    const r = sanitizeKeywords(many);
    expect(r.keywords).toHaveLength(KEYWORD_MAX_COUNT);
    expect(r.overLimit).toEqual(['term 60', 'term 61', 'term 62']);
  });

  it('the rejection message says nothing was saved and how many to remove', () => {
    expect(keywordLimitError(63)).toBe(`You entered 63 keywords; the limit is ${KEYWORD_MAX_COUNT}. Nothing was saved — remove 3 and save again.`);
  });
});

describe('every keyword writer rejects over-limit saves instead of truncating', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('no writer keeps a silent numeric keyword cap', () => {
    for (const rel of [
      'src/app/api/alerts/preferences/route.ts',
      'src/app/api/app/profile/route.ts',
      'src/app/api/app/keywords/add/route.ts',
      'src/app/api/admin/set-user-profile/route.ts',
      'src/app/api/app/vault/prefill/route.ts',
    ]) {
      const src = read(rel);
      // Comments may QUOTE the old bug; log lines may truncate a string for display.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .filter((l) => !/console\.(log|warn|error)/.test(l))
        .join('\n');
      expect(code, rel).not.toMatch(/keywords?\b[^;\n]*\.slice\(0,\s*\d+\)/i);
      expect(src, rel).toMatch(/KEYWORD_MAX_COUNT/);
    }
  });

  it('preferences returns 400 before any write when over the limit', () => {
    const src = read('src/app/api/alerts/preferences/route.ts');
    const reject = src.indexOf("code: 'keyword_limit'");
    const firstWrite = Math.min(...['.update(record)', '.insert(record)'].map((w) => src.indexOf(w)).filter((i) => i > 0));
    expect(reject).toBeGreaterThan(0);
    expect(reject).toBeLessThan(firstWrite);
  });
});
