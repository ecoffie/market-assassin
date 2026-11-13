import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMcpUsageRow, MCP_CHANNEL_OR_FILTER, MCP_CHANNEL_SQL, onlyMcpChannels } from './channel-filter';
import { fakeDb } from './fake-postgrest.test-helper';

const rows = [
  { id: 1, channel: null },        // Claude/general MCP edge (never writes a channel)
  { id: 2, channel: undefined },   // legacy row written before the channel column existed
  { id: 3, channel: 'chatgpt' },   // /chatgpt/mcp
  { id: 4, channel: 'app_chat' },  // Ask Mindy — not MCP usage
  { id: 5, channel: 'app_chat' },
];

describe('MCP channel filter', () => {
  it('keeps NULL/legacy and chatgpt rows, drops only app_chat (in-memory rule)', () => {
    expect(rows.filter(isMcpUsageRow).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('the PostgREST filter keeps NULL-channel rows (SQL NULL semantics emulated)', async () => {
    const db = fakeDb({ mcp_call_log: rows });
    const { data } = await onlyMcpChannels(db.from('mcp_call_log').select('id'));
    expect((data as Array<{ id: number }>).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('a bare neq would silently drop all historical MCP rows (why the is.null branch exists)', async () => {
    const db = fakeDb({ mcp_call_log: rows });
    const { data } = await db.from('mcp_call_log').select('id').neq('channel', 'app_chat');
    expect((data as Array<{ id: number }>).map((r) => r.id)).toEqual([3]);
  });

  it('never filters on a positive channel value (there is no channel=mcp)', () => {
    expect(MCP_CHANNEL_OR_FILTER).toBe('channel.is.null,channel.neq.app_chat');
    expect(MCP_CHANNEL_SQL).toBe("(channel IS NULL OR channel <> 'app_chat')");
  });

  it('all four approved MCP readers apply the shared filter', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('src/lib/mcp/extraction-guard.ts')).toMatch(/\.or\(MCP_CHANNEL_OR_FILTER\)/);
    expect(read('src/app/api/mcp/account/route.ts')).toMatch(/\.or\(MCP_CHANNEL_OR_FILTER\)/);
    expect(read('src/app/api/admin/mcp-cohorts/route.ts')).toMatch(/\.or\(MCP_CHANNEL_OR_FILTER\)/);
    expect(read('src/app/api/cron/throughput-digest/route.ts')).toMatch(/from\('mcp_call_log'\)\.select\('user_email'\)\.or\(MCP_CHANNEL_OR_FILTER\)/);
  });
});
