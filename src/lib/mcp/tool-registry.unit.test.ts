import { describe, it, expect } from 'vitest';
import { listMcpTools, isMcpTool, creditsFor, runMcpTool, TOOL_CREDITS } from './tool-registry';

describe('mcp tool-registry — catalog + pricing', () => {
  it('lists the exposed tools, each with _credits', () => {
    const names = listMcpTools().map((t) => (t.function as { name: string }).name);
    expect(names).toContain('search_sam_opportunities');
    expect(names).toContain('get_market_vocabulary');
    expect(names).toContain('get_contractor_profile');
    expect(names).toContain('find_capable_contractors');
    // get_winning_playbook: pulled 2026-07-29, RESTORED 2026-08-06 as the one Pro-gated tool.
    expect(names).toContain('get_winning_playbook');
    // Tier-0 (private pipeline/vault) is NOT exposed.
    expect(names).not.toContain('get_my_pipeline');
    expect(names).not.toContain('search_my_vault');
    for (const t of listMcpTools()) expect(typeof t._credits).toBe('number');
  });

  it('credit prices match the value-based ladder (locked 2026-07-20)', () => {
    expect(creditsFor('search_sam_opportunities')).toBe(5); // scan floor
    expect(creditsFor('get_contractor_profile')).toBe(10); // profile
    expect(creditsFor('find_capable_contractors')).toBe(20); // edge
    expect(creditsFor('draft_proposal')).toBe(40); // multi-agent
    expect(creditsFor('generate_market_report')).toBe(100); // combination
    expect(creditsFor('get_balance')).toBe(0); // free meta
    expect(creditsFor('nope')).toBe(0);
    // every priced tool is a real exposed tool
    for (const name of Object.keys(TOOL_CREDITS)) expect(isMcpTool(name)).toBe(true);
  });

  // PINNED PRICE — capability_market_match = 50 credits (changed 100 -> 50, 2026-09-08).
  //
  // This is a regression guard, not a style preference. The 100-credit price was measured
  // to terminate trials: the tool is a natural FIRST action, 100 credits is 100% of the
  // signup grant, and 8 of 8 users who opened with it were zeroed on action #1 — 7 of those
  // 8 never came back, against a 4.5% (4/89) one-and-done baseline for every other first
  // tool. It also makes ZERO callLLM calls, so it never carried the inference cost that
  // justifies the 100 band.
  //
  // If this test fails because someone "restored consistency" with the other Combination
  // tools, that is the regression — re-read the evidence above before changing the number.
  it('pins capability_market_match at 50 credits (trial-survivability fix)', () => {
    expect(creditsFor('capability_market_match')).toBe(50);
    expect(TOOL_CREDITS.capability_market_match).toBe(50);

    // The change is scoped to THIS tool. Its former band-mates run real LLM chains and are
    // deliberately untouched — a price move by analogy is exactly what this pins against.
    expect(creditsFor('generate_market_report')).toBe(100);
    expect(creditsFor('build_pursuit_dossier')).toBe(100);
    expect(creditsFor('one_click_proposal')).toBe(200);

    // Still a premium deliverable, not demoted into the cheap scan/profile bands.
    expect(creditsFor('capability_market_match')).toBeGreaterThan(creditsFor('draft_proposal'));
  });

  it('isMcpTool rejects unknown + private tools', () => {
    expect(isMcpTool('search_sam_opportunities')).toBe(true);
    expect(isMcpTool('get_my_pipeline')).toBe(false);
    expect(isMcpTool('totally_made_up')).toBe(false);
  });

  it('runMcpTool throws on an unknown tool (no DB needed)', async () => {
    await expect(runMcpTool('totally_made_up', {}, { userEmail: 'x@y.com' })).rejects.toThrow(/Unknown MCP tool/);
  });
});
