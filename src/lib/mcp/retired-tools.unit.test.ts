/**
 * A retired tool must be absent from EVERY discovery surface and must never be re-registered by a
 * later merge (e.g. a branch cut before the retirement). Real registry — nothing mocked.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { RETIRED_TOOLS, isRetiredTool, matchRetiredToolCall, retiredToolJsonRpcResponse, retiredToolResult } from './retired-tools';
import { listMcpTools, isMcpTool, creditsFor } from './tool-registry';
import { mcpRegistrationList } from './tool-schemas';
import { TOOL_GROUPS } from '@/app/mcp/tools/tool-groups';

const RETIRED = Object.keys(RETIRED_TOOLS);
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('retired tools are absent from discovery', () => {
  it('search_sbir is on the retired list', () => {
    expect(RETIRED).toContain('search_sbir');
  });

  it.each(RETIRED)('%s — not in listMcpTools / isMcpTool / mcpRegistrationList', (name) => {
    const listed = listMcpTools().map((t) => (t as { function: { name: string } }).function.name);
    expect(listed).not.toContain(name);
    expect(isMcpTool(name)).toBe(false);
    expect(mcpRegistrationList().map((t) => t.name)).not.toContain(name);
  });

  it.each(RETIRED)('%s — not priced, not grouped, not in the stdio server or any catalog', (name) => {
    expect(creditsFor(name)).toBeFalsy();
    expect(TOOL_GROUPS.flatMap((g) => g.tools)).not.toContain(name);
    expect(read('src/mcp/server.ts')).not.toContain(`'${name}'`);
    expect(read('docs/mcp-tool-catalog.json')).not.toContain(`"${name}"`);
    expect(read('docs/marketing/MCP-WHITEPAPER.md')).not.toContain(`| \`${name}\``);
    expect(read('src/mcp/README.md')).not.toContain(`\`${name}\``);
    expect(read('scripts/mcp-smoke.mjs')).not.toContain(`name: '${name}'`);
  });
});

describe('stale-call contract', () => {
  it('matches a single tools/call for a retired name only', () => {
    expect(matchRetiredToolCall({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_sbir' } })).toEqual({ name: 'search_sbir', id: 3 });
    expect(matchRetiredToolCall({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_grants' } })).toBeNull();
    expect(matchRetiredToolCall({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).toBeNull();
    expect(matchRetiredToolCall([{ method: 'tools/call', params: { name: 'search_sbir' } }])).toBeNull();
    expect(matchRetiredToolCall(null)).toBeNull();
    expect(isRetiredTool('toString')).toBe(false); // no prototype-key leaks
  });

  it('answers with a clear, uncharged, non-error result carrying the request id', () => {
    const r = retiredToolJsonRpcResponse({ name: 'search_sbir', id: 'abc' });
    expect(r).toMatchObject({ jsonrpc: '2.0', id: 'abc' });
    const res = retiredToolResult('search_sbir');
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toMatch(/retired on 2026-09-26/);
    expect(res.content[0].text).toMatch(/No credits were charged/);
    expect(res.structuredContent.error).toMatchObject({ code: 'tool_retired', credits_charged: 0 });
  });
});
