/**
 * Federal Market Profile via the REAL /api/app/chat route — UI body shape.
 *
 * Live fail (session 7f47fce2, 2026-11-20): the stored user message matched
 * FEDERAL_MARKET_PROFILE_SIGNAL, but the turn took CURRENT_FIND (no
 * intent:federal_market_profile / fmp_phase). The /app panel (MindyChatPanel)
 * omits `display` and sends `{ email, message, history }` — pin that shape so a
 * redeploy cannot “work in the API script with narrow_panel” while the panel
 * path falls through to FIND-first.
 *
 * Asserts: FMP arms (trace notices) + writeup phase offers create_document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  plannerResponse, answerStream, isPlannerCall, readSse, chatRequest, withinMs,
} from './__fixtures__/route-harness';
import { RBA_FEDERAL_MARKET_PROFILE_PROMPT } from '@/lib/chat/__fixtures__/rba-federal-market-profile';
import {
  filterToolsForTurn,
  isFederalMarketProfileRequest,
} from '@/lib/chat/tool-selection';
import {
  applyFmpToolResults,
  filterToolsForFmpPhase,
  initialFmpPhaseState,
  earliestIncompleteFmpPhase,
} from '@/lib/chat/fmp-phase-machine';

const h = vi.hoisted(() => ({
  inserts: [] as unknown[],
  runMcpTool: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit', 'update', 'upsert', 'ilike', 'or', 'gte', 'lte', 'neq', 'is']) {
    chain[m] = vi.fn(self);
  }
  chain.insert = vi.fn((rows: unknown) => { h.inserts.push(rows); return chain; });
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  chain.storage = { from: () => ({}) };
  return { createClient: () => chain };
});
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/proposal/loaders', () => ({ loadBidderProfile: vi.fn(async () => ({})), loadBidderProfileResult: async () => ({ status: 'empty' as const, profile: {} }), formatProfileForPrompt: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: vi.fn(async () => false), recordLlmUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/provider-events', () => ({ recordProviderEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/chat/mentioned-notice', () => ({ resolveMentionedNotice: vi.fn(async () => ({ status: 'none' })), answerUsesNotice: () => false }));
vi.mock('@/lib/chat/card-chat-turns', () => ({ parseTurnId: () => null, claimCardTurn: vi.fn(), completeCardTurn: vi.fn(), failCardTurn: vi.fn() }));
vi.mock('@/lib/mcp/credits', async (orig) => ({ ...(await orig<typeof import('@/lib/mcp/credits')>()), logCall: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp/tool-registry', async (orig) => ({
  ...(await orig<typeof import('@/lib/mcp/tool-registry')>()),
  runMcpTool: h.runMcpTool,
}));

/** Exact cold-start JSON fields MindyChatPanel posts (no `display`, empty history). */
function mindyChatPanelBody(message: string): Record<string, unknown> {
  return {
    email: 'erika@example.com',
    message,
    history: [] as Array<{ role: string; content: string }>,
  };
}

const PLANNER_TOOL_NAMES = [
  'find_opportunities',
  'search_sam_opportunities',
  'get_expiring_contracts',
  'get_contractor_award_history',
  'create_document',
  'generate_market_report',
  'search_web',
  'get_agency_forecasts',
];

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk-test';
  vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
  vi.stubEnv('VAULT_DOC_ALLOWLIST', 'erika@example.com');
  vi.stubEnv('MAP_CARD_CHAT_ENABLED', '');
  h.inserts.length = 0;
  h.runMcpTool.mockReset();
  h.runMcpTool.mockImplementation(async (name: string) => ({
    result: { ok: true, tool: name, _meta: { grounded: true } },
    credits: 0,
  }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>;
    if (isPlannerCall(body)) {
      // Round 1: obey FMP force (award history). Empty tool list would still leave FMP notices.
      return plannerResponse([{ name: 'get_contractor_award_history', args: { company: 'RBA Engineering International PLLC' } }]);
    }
    return answerStream(['Award history establishes NAICS 237310.']);
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function assistantTraceNotices(): string[] {
  for (const batch of h.inserts) {
    const rows = Array.isArray(batch) ? batch : [batch];
    for (const row of rows) {
      const r = row as { role?: string; trace?: { notices?: string[] } };
      if (r.role === 'assistant' && Array.isArray(r.trace?.notices)) return r.trace!.notices!;
    }
  }
  return [];
}

describe('Ask Mindy UI body (MindyChatPanel) arms Federal Market Profile', () => {
  it('panel JSON (no display) → federalMarketProfile + FMP phase notices, not CURRENT_FIND', async () => {
    expect(isFederalMarketProfileRequest(RBA_FEDERAL_MARKET_PROFILE_PROMPT)).toBe(true);

    const { POST } = await import('./route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(chatRequest(mindyChatPanelBody(RBA_FEDERAL_MARKET_PROFILE_PROMPT)) as any);
    await withinMs(readSse(res), 8000, 'fmp panel chat stream');

    const notices = assistantTraceNotices();
    expect(notices).toContain('intent:federal_market_profile');
    expect(notices).toContain('fmp_self_report_note');
    expect(notices.some((n) => n.startsWith('fmp_phase:start:'))).toBe(true);
    expect(notices.some((n) => n.includes('current_find_uses_three_horizons'))).toBe(false);
    expect(notices.some((n) => n.includes(':open_opportunity_question'))).toBe(false);
  });

  it('writeup phase offers create_document when prior FMP phases are complete', () => {
    const offer = filterToolsForTurn(
      PLANNER_TOOL_NAMES.map((name) => ({ function: { name } })),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(offer.federalMarketProfile).toBe(true);
    expect(offer.intent).toBe('OTHER');

    let s = initialFmpPhaseState(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    s = applyFmpToolResults(s, [
      { tool: 'search_contractors', status: 'success' },
      { tool: 'get_contractor_award_history', status: 'success' },
      { tool: 'find_opportunities', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'generate_market_report', status: 'success' },
      { tool: 'get_legislation_status', status: 'success' },
      { tool: 'search_web', status: 'success', content: JSON.stringify({ available: true, grounded: true }) },
    ]);
    expect(earliestIncompleteFmpPhase(s)).toBe('writeup');

    const phase = filterToolsForFmpPhase(offer.defs, s);
    expect(phase.defs.map((d) => String(d.function?.name))).toContain('create_document');
    expect(phase.forceTool).toBe('create_document');
  });

  it('narrow_panel display (Map Ask) still arms FMP the same way', async () => {
    const { POST } = await import('./route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(chatRequest({
      ...mindyChatPanelBody(RBA_FEDERAL_MARKET_PROFILE_PROMPT),
      display: 'narrow_panel',
    }) as any);
    await withinMs(readSse(res), 8000, 'fmp map chat stream');
    const notices = assistantTraceNotices();
    expect(notices).toContain('intent:federal_market_profile');
    expect(notices.some((n) => n.startsWith('fmp_phase:start:'))).toBe(true);
  });
});
