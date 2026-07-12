import { describe, it, expect } from 'vitest';
import { listMcpTools, isMcpTool, creditsFor, runMcpTool, TOOL_CREDITS } from './tool-registry';

describe('mcp tool-registry — catalog + pricing', () => {
  it('lists exactly the v1 tools (Tier-1 + Tier-2 + playbook), each with _credits', () => {
    const names = listMcpTools().map((t) => (t.function as { name: string }).name);
    expect(names).toContain('search_sam_opportunities');
    expect(names).toContain('get_market_vocabulary');
    expect(names).toContain('get_contractor_profile');
    expect(names).toContain('find_capable_contractors');
    expect(names).toContain('get_winning_playbook');
    // Tier-0 (private pipeline/vault) is NOT exposed in v1.
    expect(names).not.toContain('get_my_pipeline');
    expect(names).not.toContain('search_my_vault');
    for (const t of listMcpTools()) expect(typeof t._credits).toBe('number');
  });

  it('credit prices match the table', () => {
    expect(creditsFor('search_sam_opportunities')).toBe(1);
    expect(creditsFor('get_contractor_profile')).toBe(5);
    expect(creditsFor('find_capable_contractors')).toBe(8);
    expect(creditsFor('get_winning_playbook')).toBe(2);
    expect(creditsFor('nope')).toBe(0);
    // every priced tool is a real exposed tool
    for (const name of Object.keys(TOOL_CREDITS)) expect(isMcpTool(name)).toBe(true);
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
