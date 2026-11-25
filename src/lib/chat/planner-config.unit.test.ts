import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePlannerChain, anthropicSupportsForcedToolChoice } from './planner-config';

const KEYS = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' };

describe('resolvePlannerChain', () => {
  it('defaults to gpt-4o and makes no Anthropic call even when CHAT_CLAUDE_MODEL is set (prod today)', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_CLAUDE_MODEL: 'claude-sonnet-5' }, { overBudget: false });
    expect(chain).toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
  });

  it('runs Claude only behind CHAT_CLAUDE_ENABLED=true', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_CLAUDE_ENABLED: 'true', CHAT_CLAUDE_MODEL: 'claude-sonnet-5' }, { overBudget: false });
    expect(chain.map((t) => `${t.provider}:${t.model}`)).toEqual(['anthropic:claude-sonnet-5', 'openai:gpt-4o']);
  });

  it('over-budget users are NOT downgraded by default: same models, Claude still allowed (2026-11-25)', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_CLAUDE_ENABLED: 'true', CHAT_CLAUDE_MODEL: 'claude-sonnet-5-5' }, { overBudget: true });
    expect(chain.map((t) => `${t.provider}:${t.model}`)).toEqual(['anthropic:claude-sonnet-5-5', 'openai:gpt-4o']);
  });

  it('with the downgrade lever on (CHAT_BUDGET_DOWNGRADE=true), over-budget users get the cheaper OpenAI model and never Claude', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_CLAUDE_ENABLED: 'true', CHAT_BUDGET_DOWNGRADE: 'true' }, { overBudget: true });
    expect(chain).toEqual([{ provider: 'openai', model: 'gpt-4o-mini' }]);
  });

  it('has no fallback by default (Groq 8B is no longer a tool-round fallback)', () => {
    expect(resolvePlannerChain({ ...KEYS, GROQ_API_KEY: 'g' }, { overBudget: false })).toHaveLength(1);
  });

  it('accepts configured fallbacks only from the compatibility-tested list', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_PLANNER_FALLBACKS: 'openai:gpt-4o-mini, openai:some-untested-model, groq:llama-3.1-8b-instant' }, { overBudget: false });
    expect(chain.map((t) => `${t.provider}:${t.model}`)).toEqual(['openai:gpt-4o', 'openai:gpt-4o-mini']);
  });

  it('gpt-6-luna is a compatibility-tested planner fallback (gpt-4o retirement, 2027-01-14)', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_OPENAI_MODEL: 'gpt-6.1-terra', CHAT_PLANNER_FALLBACKS: 'openai:gpt-6-luna' }, { overBudget: false });
    expect(chain.map((t) => `${t.provider}:${t.model}`)).toEqual(['openai:gpt-6.1-terra', 'openai:gpt-6-luna']);
  });

  it('drops a planner whose provider key is missing', () => {
    expect(resolvePlannerChain({ CHAT_CLAUDE_ENABLED: 'true', ANTHROPIC_API_KEY: 'a' }, { overBudget: false }))
      .toEqual([{ provider: 'anthropic', model: 'claude-sonnet-5' }]);
    expect(resolvePlannerChain({}, { overBudget: false })).toEqual([]);
  });

  it('knows which Claude models reject forced tool choice', () => {
    expect(anthropicSupportsForcedToolChoice('claude-sonnet-5')).toBe(true);
    expect(anthropicSupportsForcedToolChoice('claude-sonnet-5-5')).toBe(false);
    expect(anthropicSupportsForcedToolChoice('claude-opus-5-5')).toBe(false);
  });
});

describe('chat route wiring (source assertions)', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never dispatches tools directly: only through the chat tool executor', () => {
    expect(code).not.toMatch(/\brunMcpTool\s*\(/);
    expect(code).not.toMatch(/from '@\/lib\/mcp\/tool-registry'/);
    expect(code).toMatch(/createChatToolExecutor\(/);
    expect(code).toMatch(/executor\.offeredToolDefs\(\)/);
    expect(code).toMatch(/executor\.executeRound\(/);
  });

  it('selects the planner through resolvePlannerChain and records provider events', () => {
    expect(code).toMatch(/resolvePlannerChain\(modelEnv/);
    // modelEnv is process.env unless the preview-only staging selector applies (never on production).
    expect(code).toMatch(/const modelEnv: Record<string, string \| undefined> = staging \? \{ \.\.\.process\.env, \.\.\.staging\.config\.env \} : process\.env;/);
    expect(code).toMatch(/stagingModelConfig\(request\.headers\.get\(STAGING_CONFIG_HEADER\), TRACE_EVENTS\)/);
    expect(code).toMatch(/recordProviderEvent\(/);
    expect(code).not.toMatch(/CHAT_CLAUDE_MODEL \|\| 'claude-sonnet-5'/);
  });

  it('puts today\'s date into the system prompt', () => {
    expect(route).toContain('TODAY: {today}');
    expect(code).toMatch(/\.replace\('\{today\}', today\)/);
  });

  it('flags a truncated answer instead of cutting it silently', () => {
    expect(code).toMatch(/finishReason === 'length'/);
    expect(code).toMatch(/type: 'truncated'/);
  });

  it('applies the private-data provider allow-list to the planner and the answer fallback', () => {
    expect(code).toMatch(/resolved\.filter\(\(t\) => providerApprovedForPrivate\(t\.provider\)\)/);
    // B2: every answer model (primary and fallbacks) passes the same allow-list.
    expect(code).toMatch(/resolveAnswerChain\(modelEnv, \{ primaryModel: staging\?\.config\.answerPrimary \?\? chatModel \}\)\s*\.filter\(\(t\) => \{\s*if \(providerApprovedForPrivate\(t\.provider\)\) return true;/);
  });

  it('streams verification traces only behind ASK_MINDY_TRACE_EVENTS', () => {
    expect(code).toMatch(/process\.env\.ASK_MINDY_TRACE_EVENTS === 'true' && process\.env\.VERCEL_ENV !== 'production'/);
    expect(code).toMatch(/if \(TRACE_EVENTS\) \{/);
  });

  it('the system prompt does not advertise capabilities chat currently blocks', () => {
    const prompt = route.slice(route.indexOf('const SYSTEM_PROMPT_TEMPLATE'), route.indexOf('{userProfile}'));
    // tool blocked in chat -> phrases that would promise its capability
    const BLOCKED_TOOL_PHRASES: Record<string, RegExp> = {
      search_sbir: /\bSBIR\b|\bSTTR\b/i,
      get_agency_budget_trends: /budget trend/i,
      add_contacts_to_crm: /add (them|contacts) to (your )?CRM/i,
      one_click_proposal: /one[- ]click proposal/i,
      export_proposal: /export (the )?proposal/i,
      delete_market_schedule: /delete (an |your )?(alert|saved search|schedule)/i,
    };
    for (const [tool, re] of Object.entries(BLOCKED_TOOL_PHRASES)) expect(re.test(prompt), tool).toBe(false);
  });

  it('stream close never throws or recurses, and a disconnect stops the provider stream', () => {
    // A7: closeStream is idempotent (the turn watchdog and the normal path may both reach it).
    expect(route).toMatch(/const closeStream = \(\) => \{\n\s+if \(ended\) return;\n\s+ended = true;\n\s+try \{ controller\.close\(\); \} catch \{ clientGone = true; \}/);
    expect(code.match(/controller\.close\(\)/g)).toHaveLength(1); // only inside closeStream
    expect(code).toMatch(/if \(clientGone\) \{ streamCut = true; await reader\.cancel\(\)/);
  });
});

