/**
 * Canonical Discovery — golden plans + contract proofs (Phase A, decisions locked 2026-09-22).
 *
 * The golden file locks the FULL plan for every fixture. A diff means the meaning of a query changed
 * for every surface at once — review it as a product change, then regenerate:
 *   UPDATE_DISCOVERY_GOLDEN=1 npx vitest run src/lib/discovery
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiscoveryPlan, type DiscoveryInput, type DiscoveryPlan, type PlanContext, PIPELINE } from './plan';
import { MCP_POLICY, MAPS_POLICY, SAVED_SEARCH_POLICY } from './policy';
import { buildTextMatcher, matchesText, textPredicate, classifyWord } from './matcher';
import { extractStructuredIntent } from './intent';
import { resolveBuyer, buyerMatches, buyerPredicate } from './buyer';
import { rankRecords } from './rank';
import { matchTerm } from '@/lib/beginner/relevance';

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };
const GOLDEN = join(__dirname, '__fixtures__', 'golden-plans.json');

export const FIXTURES: Array<{ id: string; cls: string; input: DiscoveryInput }> = [
  { id: '541320', cls: 'exact 6-digit NAICS', input: { query: '541320' } },
  { id: '5413', cls: 'partial NAICS', input: { query: '5413' } },
  { id: 'pam', cls: 'ordinary keyword', input: { query: 'pam' } },
  { id: 'ai governance', cls: 'short concept query', input: { query: 'ai governance' } },
  { id: 'artificial intelligence governance', cls: 'short concept query (long form)', input: { query: 'artificial intelligence governance' } },
  { id: 'cybersecurity', cls: 'cyber taxonomy', input: { query: 'cybersecurity' } },
  { id: 'janitorial', cls: 'distinctive keyword + industry preset', input: { query: 'janitorial' } },
  { id: 'market research', cls: 'distinctive + generic', input: { query: 'market research' } },
  { id: 'zzzxxyyqqq', cls: 'nonsense', input: { query: 'zzzxxyyqqq' } },
  { id: 'veterans affairs', cls: 'agency name typed as query', input: { query: 'veterans affairs' } },
  { id: 'agency=VA janitorial', cls: 'explicit agency param', input: { query: 'janitorial', agency: 'VA' } },
  { id: 'management', cls: 'generic single term', input: { query: 'management' } },
  { id: 'drones', cls: 'term of art', input: { query: 'drones' } },
  { id: '"ai governance"', cls: 'quoted exact phrase', input: { query: '"ai governance"' } },
  { id: '8a', cls: 'set-aside term', input: { query: '8a' } },
  { id: 'follow-on support', cls: 'hyphenated compound', input: { query: 'follow-on support' } },
  { id: 'Show me USDA opportunities', cls: 'NL wrapper → agency', input: { query: 'Show me USDA opportunities' } },
  { id: 'SDVOSB cybersecurity opportunities in Virginia', cls: 'set-aside + capability + state', input: { query: 'SDVOSB cybersecurity opportunities in Virginia' } },
  { id: 'cyber cloud compliance network server', cls: 'capability list', input: { query: 'cyber cloud compliance network server' } },
  { id: 'cyber, cloud', cls: 'explicit alternatives', input: { query: 'cyber, cloud' } },
  { id: 'Pro Audio', cls: 'generic modifier + distinctive', input: { query: 'Pro Audio' } },
  { id: '541512 -computers', cls: 'anchored exclusion', input: { query: '541512 -computers' } },
  { id: '-computers', cls: 'naked exclusion', input: { query: '-computers' } },
  { id: 'agency=USDA', cls: 'USDA alias collision', input: { query: '', agency: 'USDA' } },
  { id: 'agency=VA', cls: 'VA/Naval collision', input: { query: '', agency: 'VA' } },
  { id: 'Naval facilities in Nevada', cls: 'VA/Naval collision (free text)', input: { query: 'Naval facilities in Nevada' } },
];

const planFor = (input: DiscoveryInput, policy = MCP_POLICY) => buildDiscoveryPlan(input, policy, CTX);
const opExprs = (p: DiscoveryPlan) => [
  ...p.horizons.open.ops, ...p.horizons.recompete.ops, ...p.horizons.forecast.ops,
].map((o) => (o.op === 'or' ? o.expr : `${o.col}.${o.op}.${o.val}`));
const firstOr = (p: DiscoveryPlan) => (p.horizons.open.ops.find((o) => o.op === 'or') as { expr: string } | undefined)?.expr || '';

describe('golden plans', () => {
  const built: Record<string, DiscoveryPlan> = Object.fromEntries(FIXTURES.map((f) => [f.id, planFor(f.input)]));
  it('match the locked golden file', () => {
    if (process.env.UPDATE_DISCOVERY_GOLDEN === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(built, null, 2)}\n`);
    expect(JSON.parse(JSON.stringify(built))).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });
  it('every plan declares the locked pipeline order', () => {
    for (const p of Object.values(built)) expect(p.pipeline).toEqual([...PIPELINE]);
  });
});

describe('1 · structured intent is extracted before lexical matching', () => {
  it('"Show me USDA opportunities" → agency USDA, no keyword concepts', () => {
    const p = planFor({ query: 'Show me USDA opportunities' });
    expect(p.buyers.map((b) => b.requested)).toEqual(['USDA']);
    expect(p.matcher.mode).toBe('none');
    expect(p.status).toBe('ok');
  });
  it('"SDVOSB cybersecurity opportunities in Virginia" → set-aside + state + cyber capability', () => {
    const p = planFor({ query: 'SDVOSB cybersecurity opportunities in Virginia' });
    expect(p.setAsides).toEqual(['sdvosb']);
    expect(p.states).toEqual(['VA']);
    expect(p.buyers).toEqual([]); // Virginia is a state, not Veterans Affairs
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label)).toEqual(['cybersecurity']);
    expect(p.expansion.capability_kind).toBe('cyber_with_related_it');
  });
  it('capability words that are also alias keys never become agencies', () => {
    for (const q of ['cybersecurity', 'logistics support', 'health care staffing', 'energy efficiency', 'space systems']) {
      expect(extractStructuredIntent(q).agencies, q).toEqual([]);
    }
  });
});

describe('agency aliases match identity, never substrings', () => {
  const usda = resolveBuyer('USDA');
  const va = resolveBuyer('VA');
  it('USDA cannot match Defense Logistics Agency through "AG"', () => {
    expect(buyerMatches([usda], ['DEPT OF DEFENSE', 'DEFENSE LOGISTICS AGENCY'])).toBe(false);
    expect(buyerMatches([usda], ['DEPT OF DEFENSE', 'DEFENSE INFORMATION SYSTEMS AGENCY (DISA)'])).toBe(false);
    expect(buyerMatches([usda], ['AGRICULTURE, DEPARTMENT OF', 'FOREST SERVICE'])).toBe(true);
    expect(buyerPredicate([usda], ['department'])).not.toMatch(/ilike/);
  });
  it('VA cannot match Naval / Nevada / Navy', () => {
    for (const t of ['NAVAL SEA SYSTEMS COMMAND', 'NEVADA', 'DEPT OF THE NAVY', 'NAVAL FACILITIES ENGINEERING COMMAND']) {
      expect(buyerMatches([va], [t]), t).toBe(false);
    }
    expect(buyerMatches([va], ['VETERANS AFFAIRS, DEPARTMENT OF'])).toBe(true);
  });
  it('"Naval facilities in Nevada" extracts state NV and no VA buyer', () => {
    const p = planFor({ query: 'Naval facilities in Nevada' });
    expect(p.states).toEqual(['NV']);
    expect(p.buyers).toEqual([]);
  });
});

describe('2 · classification is semantic, never by length', () => {
  it('3-letter words are classified by meaning', () => {
    expect(classifyWord('pro').cls).toBe('supporting');
    expect(classifyWord('pam').cls).toBe('distinctive');
    expect(classifyWord('gis').cls).toBe('distinctive');
  });
  it('Pro Audio: audio establishes eligibility; pro only ranks', () => {
    const p = planFor({ query: 'Pro Audio' });
    const a = p.matcher.alternatives[0];
    expect(a.eligible.map((c) => c.label)).toEqual(['audio']);
    expect(a.rankOnly.map((c) => c.label)).toEqual(['pro']);
    expect(firstOr(p)).not.toContain('mpro');
  });
});

describe('3 · eligibility', () => {
  it('qualifiers are meaningful: "medical billing" requires both words', () => {
    const p = planFor({ query: 'medical billing' });
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label).sort()).toEqual(['billing', 'medical']);
    expect(matchesText(p.matcher, ['Utility billing services'])).toBe(false);
    expect(matchesText(p.matcher, ['Medical billing and coding'])).toBe(true);
  });
  it('"market research" requires both words (market alone admitted 2,924 forecasts)', () => {
    const p = planFor({ query: 'market research' });
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label).sort()).toEqual(['market', 'research']);
  });
  const ai = planFor({ query: 'ai governance' });
  it('short concept query requires every distinctive concept (AND), word-bounded', () => {
    expect(ai.matcher.alternatives[0]).toMatchObject({ shape: 'concept_query', eligibility: 'all' });
    expect(firstOr(ai).startsWith('and(or(')).toBe(true);
    for (const e of opExprs(ai)) { expect(e).not.toMatch(/\.ilike\.%ai%/i); expect(e).not.toMatch(/\.ilike\.%governance%/i); }
  });
  it('"ai governance" ≡ "artificial intelligence governance" on every horizon', () => {
    const q = planFor({ query: 'artificial intelligence governance' });
    expect(q.horizons).toEqual(ai.horizons);
  });
  it('audited false positives are rejected; real AI governance is admitted', () => {
    for (const t of ['Bldg 13 Window Repair Replacement', 'PKA - VIP Furniture Management 2.1 MAINTENANCE', 'Amendment remains 21 September', 'Air Force governance board']) {
      expect(matchesText(ai.matcher, [t]), t).toBe(false);
    }
    expect(matchesText(ai.matcher, ['AI Governance - RFI (VA-26-00070202)'])).toBe(true);
  });
  it('capability list: ANY distinctive concept admits; generic concepts never admit', () => {
    const p = planFor({ query: 'cyber cloud compliance network server' });
    const a = p.matcher.alternatives[0];
    expect(a).toMatchObject({ shape: 'capability_list', eligibility: 'any' });
    expect(a.eligible.map((c) => c.label).sort()).toEqual(['cloud', 'cyber', 'server']);
    expect(a.rankOnly.map((c) => c.label).sort()).toEqual(['compliance', 'network']);
    expect(firstOr(p)).not.toMatch(/compliance|network/);
    expect(matchesText(p.matcher, ['Network compliance audit services'])).toBe(false);
    expect(matchesText(p.matcher, ['Cloud hosting'])).toBe(true);
  });
  it('explicit commas are alternatives', () => {
    const p = planFor({ query: 'cyber, cloud' });
    expect(p.matcher.alternatives.length).toBe(2);
    expect(matchesText(p.matcher, ['Cloud hosting'])).toBe(true);
    expect(matchesText(p.matcher, ['Cyber range'])).toBe(true);
  });
  it('every horizon reads the same eligibility (regex bodies identical, columns differ)', () => {
    const p = planFor({ query: 'market research' });
    const bodies = (s: string) => new Set([...s.matchAll(/imatch\."([^"]+)"/g)].map((x) => x[1]));
    const rc = p.horizons.recompete.ops.find((o) => o.op === 'or' && o.expr.includes('imatch')) as { expr: string };
    const fc = p.horizons.forecast.ops.find((o) => o.op === 'or' && o.expr.includes('imatch')) as { expr: string };
    expect(bodies(rc.expr)).toEqual(bodies(firstOr(p)));
    expect(bodies(fc.expr)).toEqual(bodies(firstOr(p)));
  });
});

describe('explicit and query NAICS are separate constraints (AND)', () => {
  it('a saved/advanced NAICS AND a query NAICS both apply', () => {
    const p = planFor({ query: '6114', naics: '541512' });
    const naicsOps = p.horizons.recompete.ops.filter((o) => o.op === 'or' && o.expr.startsWith('naics_code'));
    expect(naicsOps.length).toBe(2);
  });
});

describe('quoted phrase', () => {
  it('a fully quoted query is an exact phrase — never re-extracted or split', () => {
    const p = planFor({ query: '"ai governance"' });
    expect(p.matcher.mode).toBe('exact_phrase');
    expect(p.matcher.phrase).toBe('ai governance');
    expect(matchesText(p.matcher, ['AI Governance - RFI'])).toBe(true);
    expect(matchesText(p.matcher, ['Enterprise AI with data governance'])).toBe(false);
  });
});

describe('exclusions require a positive anchor', () => {
  it('"541512 -computers" is valid: NAICS anchors, computers excluded (NULL-safe)', () => {
    const p = planFor({ query: '541512 -computers' });
    expect(p.status).toBe('ok');
    expect(p.naics).toEqual(['541512']);
    expect(p.matcher.excluded.map((c) => c.label)).toEqual(['computers']);
    const ex = p.horizons.open.ops.find((o) => o.op === 'or' && o.expr.includes('not.imatch')) as { expr: string };
    expect(ex.expr).toContain('title.is.null');
  });
  it('naked "-computers" returns needs_positive_scope and matches nothing on every horizon', () => {
    const p = planFor({ query: '-computers' });
    expect(p.status).toBe('needs_positive_scope');
    expect(p.refinement).toBeTruthy();
    // `<pk> IS NULL` — never true and type-safe (a text sentinel 400s on the uuid forecast id).
    expect(p.horizons.open.ops).toEqual([{ op: 'is', col: 'notice_id', val: null }]);
    expect(p.horizons.recompete.ops).toEqual([{ op: 'is', col: 'contract_id', val: null }]);
    expect(p.horizons.forecast.ops).toEqual([{ op: 'is', col: 'id', val: null }]);
  });
  it('"-computers" is valid when the SURFACE supplies scope (a saved search with NAICS)', () => {
    expect(planFor({ query: '-computers', hasSurfaceScope: true }).status).toBe('ok');
    expect(planFor({ query: '-computers', agency: 'VA' }).status).toBe('ok');
  });
});

describe('fail closed', () => {
  it('nonsense is a literal word match, never empty', () => {
    const p = planFor({ query: 'zzzxxyyqqq' });
    expect(firstOr(p)).toContain('zzzxxyyqqq');
    expect(p.matcher.alternatives[0].eligible[0].unrecognized).toBe(true);
  });
  it('every non-empty fixture constrains Open or is explicitly blocked', () => {
    for (const f of FIXTURES) {
      if (!f.input.query) continue;
      const p = planFor(f.input);
      const constrained = p.horizons.open.ops.length > 0 || Object.keys(p.horizons.open.mapFilters).length > 1;
      expect(constrained, f.id).toBe(true);
    }
  });
});

describe('4 · policy', () => {
  it('forecast default is current + future fiscal years on MCP, Maps and saved searches alike', () => {
    for (const pol of [MCP_POLICY, MAPS_POLICY, SAVED_SEARCH_POLICY]) {
      const p = planFor({ query: 'janitorial' }, pol);
      expect(p.horizons.forecast.ops.some((o) => o.op === 'or' && o.expr.startsWith('fiscal_year.is.null,fiscal_year.ilike.%2026%'))).toBe(true);
    }
  });
  it('Maps and MCP share meaning — the plan differs only in the declared policy', () => {
    for (const f of FIXTURES) {
      const a = planFor(f.input, MCP_POLICY);
      const b = planFor(f.input, MAPS_POLICY);
      expect(b.matcher, f.id).toEqual(a.matcher);
      expect(b.horizons.recompete.ops, f.id).toEqual(a.horizons.recompete.ops);
      expect(b.horizons.forecast.ops, f.id).toEqual(a.horizons.forecast.ops);
      expect(b.horizons.open.ops, f.id).toEqual(a.horizons.open.ops);
    }
  });
  it('janitorial Recompete = MCP industry preset + 18 months', () => {
    const p = planFor({ query: 'janitorial' });
    expect(p.horizons.recompete.via).toBe('industry_preset');
    expect(p.horizons.recompete.naics).toEqual(['561210', '561720', '561730']);
    expect(p.horizons.recompete.ops).toContainEqual({ op: 'lte', col: 'period_of_performance_current_end', val: '2028-03-22' });
  });
});

describe('5 · ranking reorders, never admits', () => {
  it('breadth of concepts outranks a single mention; title outranks body', () => {
    const p = planFor({ query: 'cyber cloud compliance network server' });
    const rows = [
      { id: 'a', title: 'Valve repair', description: 'cyber compliance clause' },
      { id: 'b', title: 'Cloud server hosting with cyber monitoring', description: 'network compliance' },
      { id: 'c', title: 'Cyber range support', description: '' },
    ];
    const ranked = rankRecords(p, rows, ['title', 'description']);
    expect(ranked.map((r) => r.row.id)).toEqual(['b', 'c', 'a']);
    expect(ranked[0].breadth).toBe(3); // cyber + cloud + server — eligible breadth is the primary key
    expect(ranked[0].matched.sort()).toEqual(['cloud', 'compliance', 'cyber', 'network', 'server']);
  });
});

describe('word rule parity with /try relevance.ts matchTerm (exact hits)', () => {
  const cases: Array<[string, string]> = [
    ['fence', 'CJAG Fence Install'], ['roof', 'Roofing Repair Bldg 4'], ['cater', 'Catering Services'],
    ['trucking', 'Trucks, Heavy'], ['window', 'Bldg 13 Window Replacement'], ['janitorial', 'Janitorial Services'],
    ['governance', 'Data Governance Support'], ['person', 'Personnel Security Platform'],
  ];
  for (const [term, title] of cases) {
    it(`${term} ↔ "${title}"`, () => expect(matchesText(buildTextMatcher(term), [title])).toBe(matchTerm(title, term) === 'exact'));
  }
  it('"fences" matches Fence (plural is not derivation — /try singularizes upstream)', () => {
    expect(matchesText(buildTextMatcher('fences'), ['Z--CON Chain Link Fence'])).toBe(true);
  });
});

describe('PostgREST encoding', () => {
  it('regex values are quoted with doubled backslashes', () => {
    expect(textPredicate(buildTextMatcher('repair'), ['title'])).toBe('title.imatch."\\\\mrepair(s|es|ing|ed)?\\\\M"');
  });
});
