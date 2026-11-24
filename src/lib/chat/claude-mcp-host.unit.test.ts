import { describe, it, expect } from 'vitest';
import {
  claudeMcpEnabledFor,
  claudeMcpSystemPrompt,
  buildClaudeMcpMessages,
  claudeMcpModel,
  claudeMcpPromptTokenEquivalent,
} from './claude-mcp-host';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';

describe('claudeMcpEnabledFor (default off)', () => {
  it('is off with no env', () => {
    expect(claudeMcpEnabledFor('a@b.com', {})).toBe(false);
  });
  it('is off when the flag is on but the user is not allowlisted', () => {
    expect(claudeMcpEnabledFor('a@b.com', { ASK_MINDY_CLAUDE_MCP: 'true', ASK_MINDY_CLAUDE_MCP_ALLOWLIST: 'x@y.com' })).toBe(false);
  });
  it('is off when allowlisted but the flag is not exactly "true"', () => {
    expect(claudeMcpEnabledFor('a@b.com', { ASK_MINDY_CLAUDE_MCP: '1', ASK_MINDY_CLAUDE_MCP_ALLOWLIST: 'a@b.com' })).toBe(false);
  });
  it('is on for an allowlisted user, case-insensitive', () => {
    expect(claudeMcpEnabledFor('A@B.com', { ASK_MINDY_CLAUDE_MCP: 'true', ASK_MINDY_CLAUDE_MCP_ALLOWLIST: ' x@y.com, a@b.com ' })).toBe(true);
  });
  it('* opens it to everyone', () => {
    expect(claudeMcpEnabledFor('z@z.com', { ASK_MINDY_CLAUDE_MCP: 'true', ASK_MINDY_CLAUDE_MCP_ALLOWLIST: '*' })).toBe(true);
  });
  it('never for a missing email', () => {
    expect(claudeMcpEnabledFor('', { ASK_MINDY_CLAUDE_MCP: 'true', ASK_MINDY_CLAUDE_MCP_ALLOWLIST: '*' })).toBe(false);
  });
});

describe('same instructions as the MCP server (never a copy)', () => {
  it('the system prompt is the exact constant the MCP endpoint serves on initialize', () => {
    expect(claudeMcpSystemPrompt()).toBe(MCP_CONNECTOR_INSTRUCTIONS);
    expect(claudeMcpSystemPrompt().length).toBeGreaterThan(1000);
  });
});

describe('buildClaudeMcpMessages', () => {
  it('a first question is one user message', () => {
    expect(buildClaudeMcpMessages([], 'Q')).toEqual([{ role: 'user', content: 'Q' }]);
  });
  it('keeps alternating history and appends the new question', () => {
    const m = buildClaudeMcpMessages(
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      'c',
    );
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[2].content).toBe('c');
  });
  it('drops a leading assistant turn, merges same-role neighbours and empty turns', () => {
    const m = buildClaudeMcpMessages(
      [
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'a' },
        { role: 'user', content: '' },
        { role: 'user', content: 'b' },
      ],
      'c',
    );
    expect(m).toEqual([{ role: 'user', content: 'a\n\nb\n\nc' }]);
  });
});

describe('model and cost helpers', () => {
  it('defaults to Claude Opus 5.5 and honours the override', () => {
    expect(claudeMcpModel({})).toBe('claude-opus-5-5');
    expect(claudeMcpModel({ ASK_MINDY_CLAUDE_MCP_MODEL: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5');
  });
  it('bills cache writes at 1.25x and reads at 0.1x', () => {
    expect(claudeMcpPromptTokenEquivalent({ input: 100, output: 5, cacheWrite: 1000, cacheRead: 10000 })).toBe(100 + 1250 + 1000);
  });
});
