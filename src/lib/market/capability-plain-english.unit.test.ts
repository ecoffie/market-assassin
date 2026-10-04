/**
 * capability_market_match on PLAIN-ENGLISH descriptions — hermetic replay (ChatGPT blocker #3,
 * owner decision 2026-10-04).
 *
 * Measured in ChatGPT developer mode: 6 of 8 ordinary small-business descriptions returned NO
 * market (50 credits each). Live baseline on this 25-case set before the fix: 16/25 (8 of 22
 * businesses with no market, 1 wrong market). The recorded keyword lists and USASpending keyword
 * coverage (capability-plain-english-recorded.json, from scripts/record-capability-plain-english.ts)
 * are replayed through the REAL ranking, probe choice and selection ladder — no network.
 * The live counterpart is scripts/verify-capability-match.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITY_PLAIN_ENGLISH_CASES } from './__fixtures__/capability-plain-english-cases';
import { scoreCase } from './capability-plain-english-score';
import { rankAnchorCandidates } from './capability-anchor';
import type { KeywordCoverage } from './keyword-coverage';
import { chooseProbePhrases, selectAnchorFromProbes } from '@/mcp/tools/capability-market-match';

const recorded = JSON.parse(readFileSync(join(__dirname, '__fixtures__/capability-plain-english-recorded.json'), 'utf8')) as {
  cases: Record<string, { keywords: string[]; coverage: Record<string, KeywordCoverage | null> }>;
};

/**
 * Known, documented misses — each is a judgement call, not a hidden failure. Removing an id from
 * this list without the case passing fails the suite; a case passing while still listed fails too.
 */
const KNOWN_MISSES: Record<string, string> = {
  'signs-printing':
    '"design and print marketing materials, signs and banners" anchors on "marketing" (541810 Advertising). Federal "signs" spending is mostly highway signage (237310), so neither single word is a clean read.',
};

function replay(id: string, description: string) {
  const rec = recorded.cases[id];
  const probes = chooseProbePhrases(rankAnchorCandidates(rec.keywords, { sourceText: description })).map((phrase) => ({
    phrase,
    coverage: (rec.coverage[phrase] ?? null) as KeywordCoverage | null,
    failed: false,
  }));
  const picked = selectAnchorFromProbes(probes);
  const cov = picked?.probe.coverage ?? null;
  return {
    probes,
    result: {
      market: picked && cov ? { lead_keyword: picked.probe.phrase, top_naics: [], candidate_naics: cov.allNaics } : null,
      _meta: { grounded: false, degraded: false, selected_anchor: picked?.probe.phrase ?? null },
    },
  };
}

describe('plain-English capability → market (recorded replay)', () => {
  for (const c of CAPABILITY_PLAIN_ENGLISH_CASES) {
    it(`${c.id}${KNOWN_MISSES[c.id] ? ' (known miss)' : ''}`, () => {
      expect(recorded.cases[c.id], `no recording for ${c.id} — run scripts/record-capability-plain-english.ts`).toBeDefined();
      const { result, probes } = replay(c.id, c.description);
      const s = scoreCase(c, result);
      const detail = `${s.reasons.join('; ')} | probes: ${probes.map((p) => `${p.phrase}=${p.coverage ? Math.round(p.coverage.totalMarket / 1e6) + 'M' : '∅'}`).join(', ')}`;
      if (KNOWN_MISSES[c.id]) expect(s.pass, `${c.id} now passes — remove it from KNOWN_MISSES`).toBe(false);
      else expect(s.pass, detail).toBe(true);
    });
  }

  it('meets the bar: every non-negative case except the documented misses returns the right market', () => {
    const scored = CAPABILITY_PLAIN_ENGLISH_CASES.map((c) => scoreCase(c, replay(c.id, c.description).result));
    const passing = scored.filter((s) => s.pass).length;
    expect(passing).toBe(CAPABILITY_PLAIN_ENGLISH_CASES.length - Object.keys(KNOWN_MISSES).length);
  });

  it('negatives never come back with a market (no descriptor or adjective can anchor)', () => {
    for (const c of CAPABILITY_PLAIN_ENGLISH_CASES.filter((x) => x.tier === 'empty')) {
      expect(replay(c.id, c.description).result.market, c.id).toBeNull();
    }
  });
});
