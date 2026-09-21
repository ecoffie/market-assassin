import { describe, it, expect, afterEach } from 'vitest';
import { mcpFlags } from './flags';

describe('mcpFlags — default-off toggles', () => {
  const orig = process.env.MCP_ENABLE_AI_HINT;
  afterEach(() => {
    if (orig === undefined) delete process.env.MCP_ENABLE_AI_HINT;
    else process.env.MCP_ENABLE_AI_HINT = orig;
  });

  it('aiHint defaults OFF when the env var is unset', () => {
    delete process.env.MCP_ENABLE_AI_HINT;
    expect(mcpFlags.aiHint).toBe(false);
  });

  it('aiHint is ON only for exactly "true" (case/space-insensitive)', () => {
    process.env.MCP_ENABLE_AI_HINT = ' TRUE ';
    expect(mcpFlags.aiHint).toBe(true);
    process.env.MCP_ENABLE_AI_HINT = 'true';
    expect(mcpFlags.aiHint).toBe(true);
  });

  it('aiHint stays OFF for other truthy-looking values', () => {
    for (const v of ['1', 'yes', 'on', 'True!', '']) {
      process.env.MCP_ENABLE_AI_HINT = v;
      expect(mcpFlags.aiHint).toBe(false);
    }
  });
});
