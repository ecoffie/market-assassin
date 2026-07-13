import { describe, it, expect } from 'vitest';
import { tierFor, isProTool, TOOL_TIER } from './entitlements';
import { listMcpTools } from './tool-registry';

describe('mcp entitlements — tier gating (Phase A)', () => {
  it('the winning playbook is the gated (Pro) tool', () => {
    expect(tierFor('get_winning_playbook')).toBe('pro');
    expect(isProTool('get_winning_playbook')).toBe(true);
    expect(TOOL_TIER.get_winning_playbook).toBe('pro');
  });

  it('everything else defaults to metered', () => {
    expect(tierFor('search_sam_opportunities')).toBe('metered');
    expect(tierFor('find_capable_contractors')).toBe('metered');
    expect(tierFor('get_pricing_intel')).toBe('metered');
    expect(tierFor('get_balance')).toBe('metered');
    expect(isProTool('search_sam_opportunities')).toBe(false);
    // unknown tool → metered (never accidentally gate something unlisted)
    expect(tierFor('some_future_tool')).toBe('metered');
  });

  it('the catalog annotates every tool with a _tier', () => {
    for (const t of listMcpTools()) {
      const tier = t._tier as string;
      expect(tier === 'metered' || tier === 'pro').toBe(true);
    }
    // and the playbook specifically is pro
    const pb = listMcpTools().find((t) => (t.function as { name: string }).name === 'get_winning_playbook');
    expect(pb?._tier).toBe('pro');
  });

  it('only the enumerated moat set is gated — commodity tools stay open', () => {
    const gated = listMcpTools()
      .map((t) => (t.function as { name: string }).name)
      .filter((n) => isProTool(n));
    expect(gated).toEqual(['get_winning_playbook']);
  });
});
