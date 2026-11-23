/**
 * Compound concepts + road/bridge taxonomy (Agent 4 decision, 2026-11-23).
 *
 * Live defect (production MCP find_opportunities, "bridge and highway heavy civil construction", VA/MD/DC — the RBA
 * Engineering benchmark, src/lib/chat/__fixtures__/rba-federal-market-profile.ts): eligibility was
 * ANY(bridge · highway · heavy · civil), so "heavy" alone admitted a DDG-1000 "Heavy Lift" RFI (Open #1) and "civil"
 * alone admitted USCG "Office of Civil Engineering" support; Coming back used the whole Construction preset
 * (236/237/238) and every DIRECT row was a building trade, none road/bridge.
 *
 * Controls: plans for unrelated queries must be byte-identical to origin/main (DISCOVERY_PLAN_VERSION 4), except the
 * version stamp. __fixtures__/compound-concept-controls.json was built from origin/main fb4b71f2f.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDiscoveryPlan, type DiscoveryInput, type PlanContext } from './plan';
import { MCP_POLICY } from './policy';
import { buildTextMatcher, matchesText, textPredicate, classifyWord } from './matcher';
import { interpretCapability, classifyRecord } from '@/lib/opportunities/market-interpretation';
import { RBA_FEDERAL_MARKET_PROFILE_PROMPT } from '@/lib/chat/__fixtures__/rba-federal-market-profile';

const CTX: PlanContext = { today: '2026-09-22', fiscalYear: 2026 };
const RBA: DiscoveryInput = { query: 'bridge and highway heavy civil construction', state: 'VA,MD,DC' };
const plan = (i: DiscoveryInput) => buildDiscoveryPlan(i, MCP_POLICY, CTX);
const labels = (cs: Array<{ label: string }>) => cs.map((c) => c.label);
const allExprs = (p: ReturnType<typeof plan>) => [...p.horizons.open.ops, ...p.horizons.recompete.ops, ...p.horizons.forecast.ops]
  .map((o) => (o.op === 'or' ? o.expr : `${o.col}.${o.op}.${o.val}`)).join('\n');

describe('RBA: "bridge and highway heavy civil construction" (VA, MD, DC)', () => {
  const p = plan(RBA);
  const alt = p.matcher.alternatives[0];

  it('is the benchmark customer\'s trade (fixture sanity)', () => {
    expect(RBA_FEDERAL_MARKET_PROFILE_PROMPT).toMatch(/8\(a\)/);
  });

  it('recognizes the compounds: "highway and bridge" admits, "heavy civil" + "construction" rank only', () => {
    expect(p.matcher.alternatives).toHaveLength(1);
    expect(alt.eligibility).toBe('all');
    expect(labels(alt.eligible)).toEqual(['highway and bridge']);
    expect(alt.eligible[0].basis).toBe('recognized_concept');
    expect(labels(alt.rankOnly).sort()).toEqual(['construction', 'heavy civil']);
    expect(p.states).toEqual(['VA', 'MD', 'DC']);
  });

  it('"heavy" and "civil" never satisfy eligibility on their own', () => {
    const recall = [...labels(alt.eligible)];
    expect(recall).not.toContain('heavy');
    expect(recall).not.toContain('civil');
    // The defect rows, verbatim shapes from the live run: none of them is admitted any more.
    for (const t of [
      ['DDG 1000 Heavy Lift Request for Information', 'Heavy lift capability for the ship'],
      ['Aft Heavy Weapon aircraft lot', null],
      ['Office of Civil Engineering program support', 'USCG civil engineering program management'],
      ['Electron microscope service agreement', 'Civil aviation accident laboratory'],
      ['Research Communications', 'heavy civil program office communications'],
    ]) expect(matchesText(p.matcher, t), String(t[0])).toBe(false);
    // The same predicate the database runs carries no heavy/civil clause.
    const pred = textPredicate(p.matcher, ['title']) || '';
    expect(pred).not.toMatch(/heavy|civil/);
  });

  it('admits road work whatever word the agency used (road, roadway, pavement, paving, bridge, highway)', () => {
    for (const t of [
      'GWMP Bridge Rehabilitation, Fort Myer',
      'Highway lane widening',
      'Road repaving at Joint Base Andrews',
      'Roadway resurfacing and striping',
      'Airfield pavement repair',
      'Asphalt paving of service roads',
    ]) expect(matchesText(p.matcher, [t]), t).toBe(true);
  });

  it('Coming back resolves to the road/bridge market (237310 + Y1LB/Z1LB/Z2LB), not the 236/237/238 Construction preset', () => {
    expect(p.expansion.capability_kind).toBe('industry_preset');
    expect(p.expansion.direct.naics).toEqual(['237310']);
    expect(p.expansion.direct.psc).toEqual(['Y1LB', 'Z1LB', 'Z2LB']);
    expect(p.expansion.related).toBeNull();
    expect(p.horizons.recompete.naics).toEqual(['237310']);
    const exprs = allExprs(p);
    expect(exprs).toContain('naics_code.eq.237310');
    expect(exprs).toContain('psc_code.eq.Y1LB');
    expect(exprs).not.toMatch(/naics_code\.like\.23[678]%/);
  });

  it('labels a building trade as NOT a direct road/bridge match, and a 237310 / Z2LB row as direct', () => {
    const cap = interpretCapability(RBA.query);
    for (const naics of ['236220', '238160', '238210', '237110']) {
      expect(classifyRecord({ title: 'Repair roof and HVAC, Building 12', naics_code: naics }, cap), naics).toBeNull();
    }
    expect(classifyRecord({ title: 'Rehabilitation of GWMP', naics_code: '237310' }, cap)).toBe('DIRECT_MATCH');
    expect(classifyRecord({ title: 'Repair', psc_code: 'Z2LB' }, cap)).toBe('DIRECT_MATCH');
  });
});

describe('the compound rules stay narrow', () => {
  it('"heavy" and "civil" are qualifiers (required inside a short query, never a list admitter)', () => {
    expect(classifyWord('heavy').cls).toBe('qualifier');
    expect(classifyWord('civil').cls).toBe('qualifier');
    const m = buildTextMatcher('heavy lift');
    expect(m.alternatives[0].eligibility).toBe('all');
    expect(labels(m.alternatives[0].eligible).sort()).toEqual(['heavy', 'lift']);
  });

  it('a bare "bridge" is not the road concept and gets no road taxonomy ("bridge contract")', () => {
    const p = plan({ query: 'bridge contract' });
    expect(labels(p.matcher.alternatives[0].eligible)).toEqual(['bridge']);
    expect(p.expansion.capability_kind).toBe('literal');
    expect(interpretCapability('IT services bridge contract').direct.source).toBe('IT Services');
  });

  it('"heavy civil" is one concept (the phrase), not two words', () => {
    const m = buildTextMatcher('heavy civil construction');
    expect(labels(m.alternatives[0].eligible)).toEqual(['heavy civil', 'construction']);
    expect(matchesText(m, ['Heavy civil construction MATOC'])).toBe(true);
    expect(matchesText(m, ['Heavy lift construction for the Office of Civil Engineering'])).toBe(false);
  });

  it('plain "construction" keeps the whole Construction preset', () => {
    expect(plan({ query: 'construction' }).expansion.direct.naics).toEqual(['236', '237', '238']);
  });
});

describe('controls: unrelated plans are unchanged from origin/main (version stamp aside)', () => {
  const frozen = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'compound-concept-controls.json'), 'utf8')) as {
    controls: Record<string, { input: DiscoveryInput; plan: Record<string, unknown> }>;
  };
  for (const [id, c] of Object.entries(frozen.controls)) {
    it(id, () => {
      const { version: _v, ...rest } = plan(c.input);
      expect(JSON.parse(JSON.stringify(rest))).toEqual(c.plan);
    });
  }
  it('covers the three agreed controls', () => {
    expect(Object.keys(frozen.controls).sort()).toEqual(['IT services + state=VA', 'cybersecurity + agency=SOCOM', 'janitorial services']);
  });
});
