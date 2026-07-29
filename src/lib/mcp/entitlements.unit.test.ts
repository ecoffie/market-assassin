import { describe, it, expect } from 'vitest';
import { tierFor, isProTool, TOOL_TIER } from './entitlements';
import { listMcpTools } from './tool-registry';

describe('mcp entitlements — tier gating (Phase A)', () => {
  it('NO tool is Pro-gated today — get_winning_playbook was removed from MCP 2026-07-29', () => {
    // The one Pro tool (the proprietary playbook) is no longer exposed on MCP; TOOL_TIER is empty.
    expect(Object.keys(TOOL_TIER)).toEqual([]);
    expect(tierFor('get_winning_playbook')).toBe('metered'); // not registered → default
  });

  it('everything defaults to metered', () => {
    expect(tierFor('search_sam_opportunities')).toBe('metered');
    expect(tierFor('find_capable_contractors')).toBe('metered');
    expect(tierFor('get_pricing_intel')).toBe('metered');
    expect(tierFor('get_balance')).toBe('metered');
    expect(isProTool('search_sam_opportunities')).toBe(false);
    // unknown tool → metered (never accidentally gate something unlisted)
    expect(tierFor('some_future_tool')).toBe('metered');
  });

  it('the catalog annotates every tool with a _tier (all metered today)', () => {
    for (const t of listMcpTools()) {
      const tier = t._tier as string;
      expect(tier === 'metered' || tier === 'pro').toBe(true);
    }
    // the playbook is no longer in the catalog at all.
    const pb = listMcpTools().find((t) => (t.function as { name: string }).name === 'get_winning_playbook');
    expect(pb).toBeUndefined();
  });

  it('no tools are gated — every exposed tool is open to anyone with credits', () => {
    const gated = listMcpTools()
      .map((t) => (t.function as { name: string }).name)
      .filter((n) => isProTool(n));
    expect(gated).toEqual([]);
  });
});
