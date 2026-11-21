import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECIPES, RECIPE_IDS, isImplemented, type RecipeId } from './recipes';
import { planWaves, runRecipe, type ToolExecutor } from './orchestrator';
import { classifyIntent, extractIdentifiers, buildIntentPrompt, type IntentModel } from './intent';
import { askMindyRecipesEnabledFor } from './flags';
import { REGRESSION_CASES, REGRESSION_VERSION, profileFor, prohibitedHits } from './regression';
import { isMcpTool, toolParameters } from '@/lib/mcp/tool-registry';

afterEach(() => vi.unstubAllEnvs());

describe('recipe contracts', () => {
  it('declares all ten spec recipes', () => {
    expect(RECIPE_IDS).toHaveLength(10);
    for (const id of RECIPE_IDS) expect(RECIPES[id].id).toBe(id);
  });

  it('builds the three high-priority recipes first; the rest are declared, not implemented', () => {
    const built = RECIPE_IDS.filter(isImplemented);
    expect(built.sort()).toEqual(['opportunity_deep_dive', 'profile_setup', 'where_to_start']);
  });

  it('every step tool is a real MCP tool, and every arg a step can produce is a real parameter of it', () => {
    const ctx = { question: 'q', profile: { companyName: 'Acme', uei: 'ABCDEFGH1234', naicsCodes: ['561320'], states: ['TN'], agencies: ['Department of Veterans Affairs'], keywords: ['staffing'] }, identifiers: { noticeId: 'n1', solicitation: 'S1' } };
    const prior = new Proxy({}, { get: () => ({ state: 'ok', value: { notice_id: 'n1', solicitation_number: 'S1', agency: 'VA', uei: 'ABCDEFGH1234', name: 'Acme' } }) });
    for (const id of RECIPE_IDS) for (const step of RECIPES[id].steps) {
      if (step.tool === null) { expect(step.requirement, `${id}.${step.id}`).toBeTruthy(); continue; }
      expect(isMcpTool(step.tool), `${id}.${step.id} → ${step.tool}`).toBe(true);
      const planned = step.args ? step.args(ctx, prior) : { args: {} };
      if ('skip' in planned) continue;
      const props = Object.keys(toolParameters(step.tool)?.properties ?? {});
      for (const k of Object.keys(planned.args)) expect(props, `${step.tool} has no parameter "${k}"`).toContain(k);
    }
  });

  it('dependencies form valid waves (no cycles, no unknown needs)', () => {
    for (const id of RECIPE_IDS.filter(isImplemented)) expect(() => planWaves(RECIPES[id].steps)).not.toThrow();
  });

  it('planWaves rejects an unknown dependency and a cycle', () => {
    expect(() => planWaves([{ id: 'a', tool: 't', needs: ['zz'] }])).toThrow(/unknown step/);
    expect(() => planWaves([{ id: 'a', tool: 't', needs: ['b'] }, { id: 'b', tool: 't', needs: ['a'] }])).toThrow(/cycle/);
  });
});

describe('orchestrator', () => {
  const profile = { companyName: 'Superb Staffing Solutions', naicsCodes: ['561320'], states: ['TN'], keywords: ['staffing'] };

  it('Where to start: independent calls run in the first wave together; dependent ones wait', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown>; at: number }> = [];
    let clock = 0;
    const exec: ToolExecutor = async (tool, args) => {
      calls.push({ tool, args, at: clock });
      await Promise.resolve();
      if (tool === 'find_opportunities') return { ok: true, items: [{ agency: 'Department of Veterans Affairs' }] };
      return { ok: true, items: [] };
    };
    const run = await runRecipe('where_to_start', { question: 'What should we go after?', profile }, async (t, a) => { const r = await exec(t, a); clock++; return r; });
    expect(run.status).toBe('ran');
    if (run.status !== 'ran') return;
    const byId = Object.fromEntries(run.steps.map((s) => [s.id, s]));
    expect(byId.open.wave).toBe(0); expect(byId.expiring.wave).toBe(0); expect(byId.forecasts.wave).toBe(0); expect(byId.competitors.wave).toBe(0);
    expect(byId.buyer_intel.wave).toBe(1);
    // the dependent step used the agency the first wave returned; nothing was invented
    expect(byId.buyer_intel.args).toEqual({ agency: 'Department of Veterans Affairs' });
    expect(byId.expiring.args).toEqual({ naics: '561320', state: 'TN' });
  });

  it('a failing or ok:false tool is unavailable, never an empty result', async () => {
    const exec: ToolExecutor = async (tool) => {
      if (tool === 'get_expiring_contracts') throw new Error('timeout');
      if (tool === 'get_agency_forecasts') return { ok: false, error_category: 'unavailable' };
      return { ok: true, items: [] };
    };
    const run = await runRecipe('where_to_start', { question: 'q', profile }, exec);
    if (run.status !== 'ran') throw new Error('expected ran');
    expect(run.results.expiring).toEqual({ state: 'unavailable', reason: 'timeout' });
    expect(run.results.forecasts).toEqual({ state: 'unavailable', reason: 'unavailable' });
  });

  it('unknown profile fields skip a step with the reason instead of guessing', async () => {
    const exec = vi.fn<ToolExecutor>(async () => ({ ok: true, items: [] }));
    const run = await runRecipe('where_to_start', { question: 'What should I go after?', profile: {} }, exec);
    if (run.status !== 'ran') throw new Error('expected ran');
    expect(run.results.expiring).toEqual({ state: 'skipped', reason: 'profile NAICS unknown' });
    expect(exec.mock.calls.map((c) => c[0])).not.toContain('get_expiring_contracts');
  });

  it('Profile setup records the missing SBA tool as a Data Core requirement and still runs the rest', async () => {
    const exec: ToolExecutor = async (tool) => (tool === 'lookup_sam_entity' ? { ok: true, entity: { uei: 'ABCDEFGH1234', legal_business_name: 'Superb Staffing Solutions' } } : { ok: true });
    const run = await runRecipe('profile_setup', { question: 'ABCDEFGH1234', profile: {}, identifiers: { uei: 'ABCDEFGH1234' } }, exec);
    if (run.status !== 'ran') throw new Error('expected ran');
    expect(run.results.sba_profile.state).toBe('missing_tool');
    expect((run.results.sba_profile as { reason: string }).reason).toMatch(/^SBA profile lookup/);
    expect(run.steps.find((s) => s.id === 'awards')?.args).toEqual({ uei: 'ABCDEFGH1234' });
  });

  it('Deep dive never fills evaluate_bid_decision gates itself', async () => {
    const exec = vi.fn<ToolExecutor>(async () => ({ ok: true, notice_id: 'abc', solicitation_number: '36C25027R5412' }));
    const run = await runRecipe('opportunity_deep_dive', { question: 'Tell me about 36C25027R5412', profile, identifiers: { solicitation: '36C25027R5412' } }, exec);
    if (run.status !== 'ran') throw new Error('expected ran');
    expect(run.results.bid_decision.state).toBe('skipped');
    expect(exec.mock.calls.map((c) => c[0])).not.toContain('evaluate_bid_decision');
    expect(run.steps.find((s) => s.id === 'notice')?.args).toEqual({ query: '36C25027R5412' });
  });

  it('an unbuilt recipe calls nothing', async () => {
    const exec = vi.fn<ToolExecutor>();
    expect(await runRecipe('buyer_brief', { question: 'Tell me about the Coast Guard', profile }, exec)).toEqual({ recipe: 'buyer_brief', status: 'not_implemented' });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('intent classification', () => {
  const answering = (primary: string, secondary: string | null = null): IntentModel => vi.fn(async () => JSON.stringify({ primary, secondary }));

  it('a lone notice id or solicitation number routes to the deep dive without a model call', async () => {
    const model = vi.fn<IntentModel>();
    expect((await classifyIntent('36C25027R5412', {}, model)).primary).toBe('opportunity_deep_dive');
    expect((await classifyIntent('6ba812a7e0284f79bc44c4932777c340', {}, model)).primary).toBe('opportunity_deep_dive');
    expect(model).not.toHaveBeenCalled();
  });

  it('a lone 12-character token is ambiguous (UEI or solicitation) and goes to the model with a hint', async () => {
    const model = vi.fn<IntentModel>(async () => JSON.stringify({ primary: 'profile_setup', secondary: null }));
    const r = await classifyIntent('ABCDEFGH1234', {}, model);
    expect(model).toHaveBeenCalledOnce();
    expect(model.mock.calls[0][1]).toMatch(/12-character token may be a UEI or a solicitation number/);
    expect(r).toMatchObject({ primary: 'profile_setup', via: 'model', identifiers: { uei: 'ABCDEFGH1234' } });
  });

  it('meaningful questions are classified by the model, not by words in them', async () => {
    const r = await classifyIntent('Where is the money for a staffing firm like us?', { companyName: 'X' }, answering('where_to_start', 'buyer_brief'));
    expect(r).toMatchObject({ primary: 'where_to_start', secondary: 'buyer_brief', via: 'model' });
  });

  it('an invalid or failed model answer falls back to general research', async () => {
    expect((await classifyIntent('hmm', {}, answering('make_coffee'))).primary).toBe('general_research');
    expect((await classifyIntent('hmm', {}, vi.fn(async () => 'not json'))).via).toBe('fallback');
    expect((await classifyIntent('hmm', {}, vi.fn(async () => { throw new Error('down'); }))).primary).toBe('general_research');
  });

  it('a secondary equal to the primary is dropped', async () => {
    expect((await classifyIntent('q', {}, answering('where_to_start', 'where_to_start'))).secondary).toBeNull();
  });

  it('reports profile-first for an empty profile without applying it (product decision)', async () => {
    const r = await classifyIntent('What should I go after?', {}, answering('where_to_start'));
    expect(r).toMatchObject({ primary: 'where_to_start', profileFirst: true });
  });

  it('extracts identifiers from inside a sentence', () => {
    expect(extractIdentifiers('Tell me about 36C25027R5412, please')).toEqual({ solicitation: '36C25027R5412' });
    expect(extractIdentifiers("Here's my website: superbstaffing.example.com")).toEqual({ url: 'superbstaffing.example.com' });
  });

  it('the prompt lists every recipe and asks for meaning over words', () => {
    const p = buildIntentPrompt();
    for (const id of RECIPE_IDS) expect(p).toContain(`- ${id}:`);
    expect(p).toMatch(/not by which words appear/);
  });
});

describe('ASK_MINDY_RECIPES flag', () => {
  it('is off by default; allowlist only for listed emails', () => {
    expect(askMindyRecipesEnabledFor('a@b.com')).toBe(false);
    vi.stubEnv('ASK_MINDY_RECIPES', 'allowlist');
    vi.stubEnv('ASK_MINDY_RECIPES_ALLOWLIST', 'a@b.com');
    expect(askMindyRecipesEnabledFor('A@B.com')).toBe(true);
    expect(askMindyRecipesEnabledFor('c@d.com')).toBe(false);
  });
});

describe('regression set v1', () => {
  it('is versioned and every case names a known recipe and profile', () => {
    expect(REGRESSION_VERSION).toBe(1);
    expect(REGRESSION_CASES.length).toBeGreaterThanOrEqual(10);
    for (const c of REGRESSION_CASES) {
      expect(RECIPE_IDS).toContain(c.expectedRecipe);
      expect(() => profileFor(c)).not.toThrow();
      expect(isImplemented(c.expectedRecipe), c.id).toBe(!c.notImplementedYet);
    }
  });

  it('covers the three priority recipes', () => {
    const recipes = new Set(REGRESSION_CASES.map((c) => c.expectedRecipe));
    for (const id of ['where_to_start', 'opportunity_deep_dive', 'profile_setup'] as RecipeId[]) expect(recipes).toContain(id);
  });

  it('rule-routed cases route without a model; identifier and profile-first expectations hold', async () => {
    for (const c of REGRESSION_CASES) {
      const model = vi.fn<IntentModel>(async () => JSON.stringify({ primary: c.expectedRecipe, secondary: null }));
      const r = await classifyIntent(c.question, profileFor(c), model);
      expect(r.primary, c.id).toBe(c.expectedRecipe);
      if (c.expectedVia) expect(r.via, c.id).toBe(c.expectedVia);
      if (c.expectedIdentifiers) expect(r.identifiers, c.id).toMatchObject(c.expectedIdentifiers);
      if (c.expectProfileFirst !== undefined) expect(r.profileFirst, c.id).toBe(c.expectProfileFirst);
    }
  });

  it('profiles keep unknown fields absent (never guessed)', () => {
    const p = profileFor(REGRESSION_CASES.find((c) => c.profile === 'superb_staffing_spec')!);
    expect(p.uei).toBeUndefined();
    expect(p.setAsides).toBeUndefined();
    expect(Object.keys(p).some((k) => k.startsWith('_'))).toBe(false);
  });

  it('prohibitedHits flags the banned answer patterns and passes a clean answer', () => {
    const bad = 'There are 719 matches — ask me to list them. Check SAM.gov for updates. Upgrade to Mindy Pro for more. Fit score: 82.';
    expect(prohibitedHits(bad).map((h) => h.id).sort()).toEqual(['ask_to_list', 'em_dash', 'fit_score_number', 'go_check_sam', 'mindy_pricing']);
    expect(prohibitedHits('Two Tennessee staffing contracts come back next year. Start with the Fort Campbell clerks.')).toEqual([]);
  });
});
