import { describe, it, expect } from 'vitest';
import { classifyFindIntent, isOpenOnlyRequest, filterToolsForTurn, enforceFindArgs, inheritFindIntent } from './tool-selection';
import { CURRENT_FIND_CHAT_CONTRACT, P2_FIRST_TURN_INSTRUCTIONS } from '@/lib/mcp/potato-journey';

const def = (name: string) => ({ type: 'function', function: { name } });
const CHAT_TOOLS = ['find_opportunities', 'search_sam_opportunities', 'get_expiring_contracts', 'lookup_solicitation', 'get_buying_offices'].map(def);
const names = (d: Array<{ function?: Record<string, unknown> }>) => d.map((x) => String(x.function?.name));

describe('classifyFindIntent (mirrors the MCP P2 classes)', () => {
  it.each([
    ['What open opportunities are there for janitorial services in Florida?', 'CURRENT_FIND'], // Eric's side-by-side Q
    ['What security guard opportunities are open right now?', 'CURRENT_FIND'],
    ["Where's the money for HVAC in Texas?", 'CURRENT_FIND'],
    ['I sell cybersecurity services and want to sell to the Navy', 'CURRENT_FIND'],
    ['Find opportunities for zzqx widget polishing', 'CURRENT_FIND'],
    ['Show me W912DY26R0001', 'KNOWN_ID'],
    ['Who is the incumbent on 70Z08726QKEYWEST?', 'KNOWN_ID'],
    ['What happened to the bid we submitted to Indian Head last month?', 'HISTORICAL'],
    ['Which security guard contracts are expiring in the next 12 months?', 'OTHER'],
    ['How do I write a capability statement?', 'OTHER'],
    ['Which Navy offices buy facilities support services?', 'OTHER'],
  ])('%s -> %s', (q, want) => expect(classifyFindIntent(q)).toBe(want));
});

describe('isOpenOnlyRequest: only an explicit restriction narrows to open solicitations', () => {
  it.each([
    ['What open opportunities are there for janitorial in Florida?', false],
    ['Show me only open solicitations for janitorial in FL', true],
    ['janitorial bids on SAM only', true],
    ['what can I bid on right now, no recompetes', true],
    ['what is biddable now for HVAC?', true],
  ])('%s -> %s', (q, want) => expect(isOpenOnlyRequest(q as string)).toBe(want));
});

describe('filterToolsForTurn', () => {
  it('CURRENT_FIND: find_opportunities offered, the open-only search and expiring tool are not', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'What open opportunities are there for janitorial services in Florida?');
    expect(names(r.defs)).toEqual(['find_opportunities', 'lookup_solicitation', 'get_buying_offices']);
    expect(r.removed.sort()).toEqual(['get_expiring_contracts', 'search_sam_opportunities']);
    expect(r).toMatchObject({ intent: 'CURRENT_FIND', openOnly: false });
  });
  it('an explicit open-only request keeps search_sam_opportunities', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'Show me only open solicitations for janitorial in FL');
    expect(names(r.defs)).toContain('search_sam_opportunities');
  });
  it('KNOWN_ID / HISTORICAL / recompete questions keep every tool they had before', () => {
    expect(filterToolsForTurn(CHAT_TOOLS, 'Show me W912DY26R0001').defs).toHaveLength(5);
    expect(filterToolsForTurn(CHAT_TOOLS, 'What happened to the bid we submitted last month?').defs).toHaveLength(5);
    expect(filterToolsForTurn(CHAT_TOOLS, 'Which security guard contracts are expiring in the next 12 months?').defs).toHaveLength(5);
  });
  it('card chat (allowlist without find_opportunities) is unaffected: search tools are never removed for lack of FIND', () => {
    const card = ['lookup_solicitation', 'get_solicitation_documents', 'search_sam_opportunities'].map(def);
    expect(names(filterToolsForTurn(card, 'What open opportunities are like this one?').defs)).toEqual(['lookup_solicitation', 'get_solicitation_documents', 'search_sam_opportunities']);
  });
});

describe('enforceFindArgs: Ask Mindy sends find_opportunities what the MCP host (Claude) sends', () => {
  const OPEN_ONLY = JSON.stringify({ query: 'janitorial', location: 'Florida', horizons: { open_now: true, coming_back: false, coming_soon: false } });
  it('horizons the planner turned off come back; rows per horizon raised to 25', () => {
    const r = enforceFindArgs('find_opportunities', OPEN_ONLY, 'CURRENT_FIND', false);
    expect(JSON.parse(r.args)).toEqual({ query: 'janitorial', location: 'Florida', horizons: { open_now: true, coming_back: true, coming_soon: true }, limit_per_horizon: 25 });
    expect(r.changes).toEqual(['horizons', 'limit_per_horizon']);
  });
  it("a planner-chosen NAICS is removed (Eric's FL janitorial: 561720 narrowed 44 recompetes to 40)", () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'janitorial services', location: 'Florida', advanced: { naics: '561720' } }), 'CURRENT_FIND', false, []);
    expect(JSON.parse(r.args)).toEqual({ query: 'janitorial services', location: 'Florida', limit_per_horizon: 25 });
    expect(r.changes).toContain('untyped_naics');
  });
  it('a code the customer typed is kept; other advanced filters are kept', () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'cleaning', advanced: { naics: '561720,561730', set_aside: 'SDVOSB' } }), 'CURRENT_FIND', false, ['561720']);
    expect(JSON.parse(r.args).advanced).toEqual({ naics: '561720', set_aside: 'SDVOSB' });
  });
  it('omitted horizons stay omitted (= all three); an explicit higher limit is kept', () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'x', limit_per_horizon: 25 }), 'CURRENT_FIND', false);
    expect(r.changes).toEqual([]);
  });
  it('open-only keeps the horizons the customer asked for (rows and codes still aligned)', () => {
    const r = enforceFindArgs('find_opportunities', OPEN_ONLY, 'CURRENT_FIND', true);
    expect(JSON.parse(r.args).horizons).toEqual({ open_now: true, coming_back: false, coming_soon: false });
  });
  it('other intents, other tools and bad JSON are untouched', () => {
    expect(enforceFindArgs('find_opportunities', OPEN_ONLY, 'OTHER', false)).toEqual({ args: OPEN_ONLY, changes: [] });
    expect(enforceFindArgs('search_sam_opportunities', OPEN_ONLY, 'CURRENT_FIND', false)).toEqual({ args: OPEN_ONLY, changes: [] });
    expect(enforceFindArgs('find_opportunities', 'not json', 'CURRENT_FIND', false)).toEqual({ args: 'not json', changes: [] });
  });
});

describe('CURRENT_FIND contract parity: chat and the MCP host say the same load-bearing things', () => {
  it.each([
    [/find_opportunities ONCE/],
    [/Open now/],
    [/Coming back/],
    [/Coming soon/],
    [/unavailable into zero/i],
  ])('both contain %s', (re) => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(re);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(re);
  });
  it('both route a known solicitation id and a past bid to lookup_solicitation', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/lookup_solicitation/);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(/solicitation number or notice id: call lookup_solicitation/);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(/past bid .*lookup_solicitation/);
  });
});

describe('a short refinement inherits the previous FIND ("What about in Florida?")', () => {
  const PRIOR = 'What security guard opportunities are open right now?';
  it.each([
    ['What about in Florida?', 'CURRENT_FIND'],
    ['and Georgia?', 'CURRENT_FIND'],
    ['How about Texas instead', 'CURRENT_FIND'],
    ['in Virginia', 'CURRENT_FIND'],
  ])('%s after a FIND -> %s', (q, want) => expect(inheritFindIntent(q, PRIOR)).toBe(want));
  it('does not inherit without a FIND before it, for long or different questions, or for recompete follow-ups', () => {
    expect(inheritFindIntent('What about in Florida?', 'How do I write a capability statement?')).toBe('OTHER');
    expect(inheritFindIntent('What about in Florida?', null)).toBe('OTHER');
    expect(inheritFindIntent('What about the buying offices in Florida that handle these and who runs them?', PRIOR)).toBe('OTHER');
    expect(inheritFindIntent('What about the ones expiring next year?', PRIOR)).toBe('OTHER');
  });
  it('filterToolsForTurn applies the inherited FIND (open-only search not offered)', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'What about in Florida?', PRIOR);
    expect(r.intent).toBe('CURRENT_FIND');
    expect(names(r.defs)).not.toContain('search_sam_opportunities');
  });
});
