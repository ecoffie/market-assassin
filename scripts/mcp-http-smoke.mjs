#!/usr/bin/env node
/**
 * mcp-http-smoke.mjs — prove the HOSTED Mindy MCP edge works end-to-end over
 * Streamable HTTP (the mcp.getmindy.ai transport), the way a real remote agent
 * hits it. Sibling to mcp-smoke.mjs (which covers the stdio transport).
 *
 * Asserts, in order:
 *   1. AUTH — connecting with NO key is rejected (401). The edge is required:true.
 *   2. HANDSHAKE + TOOLS — with a valid key, initialize succeeds and the tool
 *      list contains get_winning_playbook.
 *   3. TOOL CALL — get_winning_playbook returns a well-formed result.
 *
 * This is the Slice-2 acceptance test (PRD §7, HTTP edge).
 *
 * Usage:
 *   # against a local dev server (npm run dev in another shell):
 *   MCP_KEY=mcp_live_xxx node scripts/mcp-http-smoke.mjs --url http://localhost:3000/mcp/mcp
 *   # against production once the domain is live:
 *   MCP_KEY=mcp_live_xxx node scripts/mcp-http-smoke.mjs --url https://mcp.getmindy.ai/mcp
 *
 * The key must be a real mcp_live_ key from the mcp_api_keys table (issue one via
 * /api/mcp/keys or api-keys.ts issueApiKey). Without --key/MCP_KEY only test 1 runs.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
function argVal(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const rawUrl = argVal('--url', process.env.MCP_URL || 'http://localhost:3000/mcp/mcp');
const key = argVal('--key', process.env.MCP_KEY || '');
const topic = argVal('--topic', 'how to win an 8(a) construction recompete at the VA');
const url = new URL(rawUrl);

function fail(msg) {
  console.error(`\n❌ HTTP SMOKE FAILED: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

function makeClient(bearer) {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: bearer
      ? { headers: { Authorization: `Bearer ${bearer}` } }
      : undefined,
  });
  const client = new Client({ name: 'mcp-http-smoke', version: '1.0.0' });
  return { client, transport };
}

console.log(`\n── MCP HTTP edge smoke ──\n   URL: ${url.href}\n   key: ${key ? key.slice(0, 12) + '…' : '(none — only the auth test runs)'}\n`);

// ── Test 1: no key must be rejected ─────────────────────────────────────────
{
  const { client, transport } = makeClient('');
  try {
    await client.connect(transport);
    await client.close().catch(() => {});
    fail('unauthenticated connect SUCCEEDED — the edge is not gating on the API key!');
  } catch (err) {
    const s = String(err?.message || err);
    // The MCP auth spec rejects with 401 + an OAuth-style body; the SDK surfaces
    // it as a message string (no status field), so match the auth vocabulary too.
    if (/401|unauthorized|forbidden|invalid_token|no authorization|authorization provided|http 4\d\d/i.test(s)) {
      ok('unauthenticated request rejected — auth gate works');
    } else {
      fail(`unauthenticated connect failed, but not with an auth error: ${s}`);
    }
  }
}

if (!key) {
  console.log('\n(no key provided — skipping handshake + tool-call tests)\n');
  console.log('✅ AUTH GATE VERIFIED. Provide MCP_KEY to run the full suite.\n');
  process.exit(0);
}

// ── Test 2 + 3: authenticated handshake, tool list, tool call ───────────────
{
  const { client, transport } = makeClient(key);
  try {
    await client.connect(transport);
    ok('authenticated initialize handshake succeeded');

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    if (!names.includes('get_winning_playbook')) {
      fail(`tool list missing get_winning_playbook (got: ${names.join(', ') || 'none'})`);
    }
    ok(`tools/list contains get_winning_playbook (${names.length} tool(s))`);

    const res = await client.callTool({
      name: 'get_winning_playbook',
      arguments: { topic },
    });
    const text = res?.content?.find((c) => c.type === 'text')?.text;
    if (!text) fail('tool call returned no text content');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail('tool result text was not JSON');
    }
    if (typeof parsed !== 'object' || !('topic' in parsed)) {
      fail(`tool result shape unexpected: ${text.slice(0, 200)}`);
    }
    ok(`get_winning_playbook returned a well-formed result (grounded=${parsed?._meta?.grounded})`);

    await client.close().catch(() => {});
    console.log('\n✅ HTTP EDGE SMOKE PASSED — transport + auth + tool all working.\n');
  } catch (err) {
    fail(String(err?.message || err));
  }
}
