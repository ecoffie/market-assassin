import { describe, it, expect } from 'vitest';
import { tierFor, isProTool, TOOL_TIER } from './entitlements';
import { listMcpTools } from './tool-registry';

describe('mcp entitlements — tier gating (Phase A)', () => {
  it('get_winning_playbook is the one Pro-gated tool', () => {
    // Removed from MCP 2026-07-29 (an external tester hit the gate and read it as a bug),
    // restored 2026-08-06 with the Pro entitlement check corrected. If this flips back to
    // an empty map, read the HISTORY note in entitlements.ts before "fixing" it.
    expect(Object.keys(TOOL_TIER)).toEqual(['get_winning_playbook']);
    expect(tierFor('get_winning_playbook')).toBe('pro');
    expect(isProTool('get_winning_playbook')).toBe(true);
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

  it('the catalog annotates every tool with a _tier, and the playbook carries pro', () => {
    for (const t of listMcpTools()) {
      const tier = t._tier as string;
      expect(tier === 'metered' || tier === 'pro').toBe(true);
    }
    const pb = listMcpTools().find((t) => (t.function as { name: string }).name === 'get_winning_playbook');
    expect(pb).toBeDefined();
    expect(pb?._tier).toBe('pro');
    expect(pb?._credits).toBe(20);
  });

  it('exactly one tool is gated — the gate is narrow by design', () => {
    const gated = listMcpTools()
      .map((t) => (t.function as { name: string }).name)
      .filter((n) => isProTool(n));
    expect(gated).toEqual(['get_winning_playbook']);
  });

  it('every gated tool is also extraction-guarded (a Pro tool is a moat tool)', async () => {
    const { PROPRIETARY_TOOLS } = await import('./tool-registry');
    for (const name of Object.keys(TOOL_TIER)) {
      expect(PROPRIETARY_TOOLS.has(name)).toBe(true);
    }
  });
});
