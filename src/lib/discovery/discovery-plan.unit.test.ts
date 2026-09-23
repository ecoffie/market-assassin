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

import { FIXTURES } from './__fixtures__/fixtures';

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
    expect(a.eligible.map((c) => c.label).sort()).toEqual(['cloud', 'cybersecurity', 'server']);
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
    expect(ranked[0].matched.sort()).toEqual(['cloud', 'compliance', 'cybersecurity', 'network', 'server']);
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

describe('Phase B replay fixes', () => {
  it('"cyber" is the cybersecurity concept (MCP CYBER_DIRECT_RE): it matches "Cybersecurity"', () => {
    const p = planFor({ query: 'cyber' });
    expect(matchesText(p.matcher, ['Cybersecurity Operations Support'])).toBe(true);
    expect(matchesText(p.matcher, ['Cyber Range'])).toBe(true);
    expect(matchesText(p.matcher, ['Cyberdyne Robotics'])).toBe(false);
  });
  it('acronyms are case-sensitive: IT is not the pronoun "it"; AI is not "Ai"-anything', () => {
    const it = planFor({ query: 'IT services' });
    expect(matchesText(it.matcher, ['IT Support Services'])).toBe(true);
    expect(matchesText(it.matcher, ['It is anticipated that the contractor will provide services'])).toBe(false);
    expect(matchesText(it.matcher, ['Information Technology Support'])).toBe(true);
    const ai = planFor({ query: 'ai governance' });
    expect(matchesText(ai.matcher, ['AI governance framework'])).toBe(true);
    expect(firstOr(ai)).toContain('.match.'); // the acronym clause is case-sensitive
  });
  it('an excluded acronym is excluded in upper case only', () => {
    const p = planFor({ query: '541512 -ai' });
    expect(matchesText(p.matcher, ['AI platform'])).toBe(false);
  });
});

describe('PostgREST encoding', () => {
  it('regex values are quoted with doubled backslashes', () => {
    expect(textPredicate(buildTextMatcher('repair'), ['title'])).toBe('title.imatch."\\\\mrepair(s|es|ing|ed)?\\\\M"');
  });
});

describe('Phase C — explicit agency accepts a list of distinct buyers (ORed)', () => {
  const json = (p: DiscoveryPlan) => JSON.parse(JSON.stringify(p));
  it('a one-element list plans exactly like the string (single-buyer MCP input unchanged)', () => {
    for (const f of FIXTURES.filter((x) => typeof x.input.agency === 'string')) {
      expect(json(planFor({ ...f.input, agency: [f.input.agency as string] })), f.id).toEqual(json(planFor(f.input)));
    }
  });
  it('each buyer resolves independently and the buyers are ORed', () => {
    const p = planFor({ query: 'janitorial', agency: ['USDA', 'VA'] });
    expect(p.buyers.map((b) => b.requested)).toEqual(['USDA', 'VA']);
    expect(p.buyers.map((b) => b.canonical)).toEqual([planFor({ query: '', agency: 'USDA' }).buyers[0].canonical, planFor({ query: '', agency: 'VA' }).buyers[0].canonical]);
    expect(buyerMatches(p.buyers, ['AGRICULTURE, DEPARTMENT OF', 'FOREST SERVICE'])).toBe(true);
    expect(buyerMatches(p.buyers, ['VETERANS AFFAIRS, DEPARTMENT OF'])).toBe(true);
    expect(buyerMatches(p.buyers, ['DEPT OF THE NAVY'])).toBe(false);
    // ONE or-op over the buyer columns carries both identities (OR), never two ANDed ops.
    const single = (a: string) => buyerPredicate(planFor({ query: '', agency: a }).buyers, ['department', 'sub_tier'])!;
    const both = buyerPredicate(p.buyers, ['department', 'sub_tier'])!;
    expect(both).toBe(`${single('USDA')},${single('VA')}`);
    expect(p.horizons.open.ops.filter((o) => o.op === 'or' && o.expr === both)).toHaveLength(1);
  });
  it('a pipe-joined string is NOT split — that is a surface adapter job, not a plan rule', () => {
    expect(planFor({ query: '', agency: 'USDA|VA' }).buyers).toHaveLength(1);
  });
  it('blank list entries are dropped; an empty list is no buyer', () => {
    expect(planFor({ query: '', agency: ['', '  ', 'USDA'] }).buyers.map((b) => b.requested)).toEqual(['USDA']);
    expect(planFor({ query: 'janitorial', agency: [] }).buyers).toEqual([]);
  });
});

describe('Phase D — a leading "<word> me <opportunity noun>" is an imperative wrapper (structural, not fuzzy)', () => {
  it('"shoe me opportunities in the Virgin Islands" → state VI only, no "shoe" concept', () => {
    const p = planFor({ query: 'shoe me opportunities in the Virgin Islands' });
    expect(p.states).toEqual(['VI']);
    expect(p.matcher.mode).toBe('none');
    expect(p.intent.stripped).toContain('shoe me');
    expect(p.status).toBe('ok');
  });
  it('any verb in that clause shape is a request when the remainder is structured ("email me opportunities in Virginia")', () => {
    const p = planFor({ query: 'email me opportunities in Virginia' });
    expect(p.states).toEqual(['VA']);
    expect(p.matcher.mode).toBe('none');
  });
  it('without a STRUCTURED remainder the word stays a search term ("email me opportunities in cyber")', () => {
    const p = planFor({ query: 'email me opportunities in cyber' });
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label).sort()).toEqual(['cybersecurity', 'email']);
    expect(p.intent.stripped).not.toContain('email me');
  });
  it('is NARROW: without "me" + an opportunity noun the word stays a concept', () => {
    expect(planFor({ query: 'shoe opportunities' }).matcher.alternatives[0].eligible.map((c) => c.label)).toEqual(['shoe']);
    expect(planFor({ query: 'shoes in Virginia' }).matcher.mode).toBe('lexical');
    expect(planFor({ query: 'kitchen exhaust' }).intent.stripped).toEqual([]);
  });
  it('known wrappers are untouched ("Show me USDA opportunities" still plans exactly as before)', () => {
    const p = planFor({ query: 'Show me USDA opportunities' });
    expect(p.intent.stripped).toEqual(['show me', 'opportunities']);
    expect(p.buyers.map((b) => b.requested)).toEqual(['USDA']);
  });
});

describe('Decision #4 — "software license" is ONE concept with procurement-equivalent forms (audited records)', () => {
  const m = buildTextMatcher('software license');
  // Real rows from the a9eb09ff saved-search audit (2026-09-23), title + description as stored.
  it.each([
    ['ANSYS Fluent License Maintenance- Notice of Intent'],
    ['Fortify On Demand Software Subscriptions'],
    ['Applanix POSPac MMS Software Maintenance Renewal'],
    ['BRAND NAME RF CODE CENTERSCAPE TERM SOFTWARE LICENSES'],
    ['Software licensing for the enterprise'],
    ['NUTANIX LICENSE RENEWAL'],
    ['GITLAB ULTIMATE LICENSE SUBSCRIPTIONS'],
  ])('admits %s', (title) => expect(matchesText(m, [title])).toBe(true));

  it.each([
    ['Predictor Remediation Exam', 'Online nursing remediation exam for students'],
    ['AI Legal Research RFI', 'NAICS 513210 Software Publishers. Market research for legal research tools'],
    ['AI Legal Research RFI', 'Access to agency-licensed databases and case law'],
    ['Enterprise Software Support Services', 'Tier 2 software support and help desk'],
    ['Simview Simulation Renewal', 'Simview Simulation Software- PN: Z9500A-RFP-1YR'],
  ])('does not admit %s', (title, desc) => expect(matchesText(m, [title, desc])).toBe(false));

  it('bare license / subscription / maintenance / renewal are never sufficient', () => {
    for (const t of ['Annual license fee', 'Magazine subscription', 'HVAC maintenance renewal', 'Lease renewal', 'Software engineering']) {
      expect(matchesText(m, [t]), t).toBe(false);
    }
  });
  it('query recognition is inflection-aware and yields ONE concept', () => {
    for (const q of ['software license', 'software licenses', 'software licensing', 'Software Licensed']) {
      const a = buildTextMatcher(q).alternatives[0];
      expect(a.eligible.map((c) => c.label), q).toEqual(['software license']);
      expect(a.eligible[0].basis).toBe('recognized_concept');
    }
  });
  it('record-only forms typed as a query keep their plain-word meaning (only the NAME recognizes)', () => {
    expect(buildTextMatcher('license renewal').alternatives[0].eligible.map((c) => c.label)).toEqual(['license', 'renewal']);
    expect(buildTextMatcher('software subscriptions').alternatives[0].eligible.map((c) => c.label)).toEqual(['software', 'subscriptions']);
  });
  it('the concept only ADDS: software + license anywhere still admits (pre-concept meaning kept)', () => {
    expect(matchesText(m, ['Microsoft Software Enterprise Licenses for BIA'])).toBe(true);
    expect(matchesText(m, ['Renewal of Adobe Subscription Licenses', 'Adobe software for staff'])).toBe(true);
  });
  it('an exclusion removes the named forms, never the two-word co-occurrence', () => {
    const x = buildTextMatcher('cloud', ['software license']);
    expect(x.excluded[0].cooccur).toBeUndefined();
  });
  it('bare words in a query stay ordinary words (not the concept)', () => {
    expect(buildTextMatcher('license').alternatives[0].eligible.map((c) => c.label)).toEqual(['license']);
    expect(buildTextMatcher('software').alternatives[0].eligible.map((c) => c.label)).toEqual(['software']);
  });
});
