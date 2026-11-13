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

  it('over-budget users get the cheaper OpenAI model and never Claude (existing margin guard)', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_CLAUDE_ENABLED: 'true' }, { overBudget: true });
    expect(chain).toEqual([{ provider: 'openai', model: 'gpt-4o-mini' }]);
  });

  it('has no fallback by default (Groq 8B is no longer a tool-round fallback)', () => {
    expect(resolvePlannerChain({ ...KEYS, GROQ_API_KEY: 'g' }, { overBudget: false })).toHaveLength(1);
  });

  it('accepts configured fallbacks only from the compatibility-tested list', () => {
    const chain = resolvePlannerChain({ ...KEYS, CHAT_PLANNER_FALLBACKS: 'openai:gpt-4o-mini, openai:some-untested-model, groq:llama-3.1-8b-instant' }, { overBudget: false });
    expect(chain.map((t) => `${t.provider}:${t.model}`)).toEqual(['openai:gpt-4o', 'openai:gpt-4o-mini']);
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
    expect(code).toMatch(/resolvePlannerChain\(process\.env/);
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
    expect(code).toMatch(/!groqRes && !providerApprovedForPrivate\('groq'\)/);
  });

  it('streams verification traces only behind ASK_MINDY_TRACE_EVENTS', () => {
    expect(code).toMatch(/process\.env\.ASK_MINDY_TRACE_EVENTS === 'true'/);
    expect(code).toMatch(/if \(TRACE_EVENTS\) \{/);
  });
});
