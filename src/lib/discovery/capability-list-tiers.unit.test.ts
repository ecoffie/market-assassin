import { describe, it, expect } from 'vitest';
import dfTable from './corpus-word-df.json';
import { buildTextMatcher, matchesText, textPredicate, corpusDf, COMMON_WORD_DF, PARTNER_WORD_DF, MAX_PARTNER_WORDS, CORPUS_DF_MAX_AGE_DAYS } from './matcher';
import { buildDiscoveryPlan } from './plan';
import { MCP_POLICY } from './policy';
import { eligibilityLabel } from '@/lib/opportunities/find-opportunities';

/**
 * Capability-list tiers (Agent 3, 2026-11-14). A capability list (>= 4 meaningful words) used to admit a record on ANY
 * one distinctive word, so corpus-common words admitted thousands of unrelated notices. Blind-labeled evaluation over
 * 8 real customer saved searches + 3 constructed ones (tasks/anyword-matching-2026-11-14.md): 100 labeled irrelevant
 * notices removed, 0 relevant lost on the real searches. The rule:
 *   df >= 5%  → rank only · 1% <= df < 5% → needs a second listed word · df < 1% → admits alone (unchanged).
 * Record texts below are real active-notice titles from the evaluation pool.
 */
const alt = (q: string) => buildTextMatcher(q).alternatives[0];
const labels = (cs: Array<{ label: string }>) => cs.map((c) => c.label);

describe('the measured frequency table', () => {
  const meta = (dfTable as { _meta: { notices: number; minDf: number; words: number } })._meta;
  const df = (dfTable as { df: Record<string, number> }).df;
  it('is a complete, versioned measurement (no partial table)', () => {
    expect(meta.notices).toBeGreaterThan(30000);
    expect(meta.minDf).toBe(0.01);
    expect(Object.keys(df).length).toBe(meta.words);
    for (const v of Object.values(df)) expect(v).toBeGreaterThanOrEqual(0.01);
  });
  it(`is no older than ${'$'}{CORPUS_DF_MAX_AGE_DAYS} days (rebuild with scripts/build-corpus-word-df.ts --write)`, () => {
    const measured = Date.parse((dfTable as { _meta: { measured: string } })._meta.measured);
    expect(Number.isFinite(measured)).toBe(true);
    expect((Date.now() - measured) / 86_400_000).toBeLessThan(CORPUS_DF_MAX_AGE_DAYS);
  });
  it('looks a word up with its singular, and never looks up a phrase', () => {
    expect(corpusDf('grounds')).toBe(corpusDf('ground'));
    expect(corpusDf('provide')).toBeGreaterThanOrEqual(COMMON_WORD_DF);
    expect(corpusDf('janitorial')).toBeLessThan(PARTNER_WORD_DF);
    expect(corpusDf('air conditioning')).toBe(0);
  });
});

describe('real failing searches', () => {
  it('guards: "access" (9% of notices) no longer admits on its own', () => {
    const a = alt('armed and unarmed security guards patrol and access control services');
    expect(a.shape).toBe('capability_list');
    expect(labels(a.rankOnly)).toContain('access');
    expect(labels(a.eligible)).not.toContain('access');
    expect(labels(a.eligible)).toEqual(expect.arrayContaining(['armed', 'unarmed', 'patrol', 'guards']));
    const m = buildTextMatcher('armed and unarmed security guards patrol and access control services');
    expect(matchesText(m, ['Card Access System Upgrade', 'Replace badge readers and access panels'])).toBe(false);
    expect(matchesText(m, ['Unarmed Security Guard Services', 'Guard services at the federal building'])).toBe(true);
  });

  it('janitorial list (customer watch): "grounds" and "removal" need a partner; janitorial words still admit alone', () => {
    const q = 'janitorial custodial grounds turf waste removal';
    const a = alt(q);
    expect(a.partnerRequired?.sort()).toEqual(['grounds', 'removal']);
    const m = buildTextMatcher(q);
    expect(matchesText(m, ['RANGE MAINTENANCE AND REPAIR SUPPORT', 'Maintain range grounds and targets'])).toBe(false);
    expect(matchesText(m, ['Snow and Ice Removal Services'])).toBe(false);
    expect(matchesText(m, ['Custodial Services, Building 12'])).toBe(true);
    expect(matchesText(m, ['Grounds Maintenance and Debris Removal'])).toBe(true);
  });

  it('nurses sentence: "provide" (19%) is rank only', () => {
    const a = alt('we provide nurses physicians and medical staff to VA hospitals');
    expect(labels(a.rankOnly)).toContain('provide');
    expect(labels(a.eligible)).not.toContain('provide');
  });
});

describe('the SQL predicate and the JS mirror carry the same rule', () => {
  it('a partner word appears only inside an AND pair, a rare word on its own', () => {
    const m = buildTextMatcher('janitorial custodial grounds turf waste removal');
    const p = textPredicate(m, ['title'])!;
    expect(p).toContain('title.imatch."\\\\mjanitorial');
    expect(p).toMatch(/and\(or\(title\.imatch\."\\\\m\(grounds/);
    expect(p).not.toMatch(/(^|,)title\.imatch\."\\\\m\(grounds[^)]*\)\\\\M"(,|$)/);
  });
});

describe('the tool output describes the rule the code applies', () => {
  it('eligibility label names every partner-required word under PAIR, never under ANY', () => {
    const plan = buildDiscoveryPlan({ query: 'janitorial custodial grounds turf waste removal' }, MCP_POLICY);
    const label = eligibilityLabel(plan);
    const a = plan.matcher.alternatives[0];
    expect(a.partnerRequired?.length).toBeGreaterThan(0);
    const pair = label.match(/PAIR_ANY_TWO\(([^)]*)\)/)?.[1] ?? '';
    const any = label.match(/(?:^|\s)ANY\(([^)]*)\)/)?.[1] ?? '';
    for (const w of a.partnerRequired!) { expect(pair).toContain(w); expect(any).not.toContain(w); }
    expect(any).toContain('janitorial');
  });
});

describe('query size stays bounded', () => {
  it(`keeps at most ${'$'}{MAX_PARTNER_WORDS} partner words (<= 15 pairs); the rest rank only`, () => {
    // 9 words that each sit between 1% and 5% of notices, plus one rare word.
    const q = 'janitorial staff training medical building construction development digital removal guard';
    const a = buildTextMatcher(q).alternatives[0];
    expect((a.partnerRequired || []).length).toBeLessThanOrEqual(MAX_PARTNER_WORDS);
    const pairs = (textPredicate(buildTextMatcher(q), ['title']) || '').match(/and\(or\(/g) || [];
    expect(pairs.length).toBeLessThanOrEqual((MAX_PARTNER_WORDS * (MAX_PARTNER_WORDS - 1)) / 2);
  });
});

describe('what does not change', () => {
  it.each(['janitorial services', 'hvac maintenance', 'medical staffing', 'security guard services'])(
    'short query "%s" keeps its all-required shape with no partner rule', (q) => {
      const a = alt(q);
      expect(a.shape).toBe('concept_query');
      expect(a.eligibility).toBe('all');
      expect(a.partnerRequired).toBeUndefined();
    });

  it('"cyber cloud compliance network server" (verify:search regression) still admits on its rare words', () => {
    const a = alt('cyber cloud compliance network server');
    expect(a.shape).toBe('capability_list');
    expect(labels(a.eligible)).toEqual(expect.arrayContaining(['cybersecurity', 'cloud', 'server']));
    expect(a.partnerRequired).toBeUndefined();
  });

  it('a list with one partner word and no rare word lets that word admit alone (never unmatchable)', () => {
    const m = buildTextMatcher('provide access digital government repair');
    const a = m.alternatives[0];
    expect(labels(a.eligible)).toEqual(['digital']);
    expect(a.partnerRequired).toBeUndefined();
    expect(matchesText(m, ['Digital signage replacement'])).toBe(true);
  });

  it('a list of only corpus-common words fails narrow (all required), never any-one', () => {
    const a = alt('provide access repair control design');
    expect(a.eligibility).toBe('all');
  });
});
