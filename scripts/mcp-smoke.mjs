#!/usr/bin/env node
/**
 * mcp-smoke.mjs — prove the Mindy MCP server works end-to-end over stdio WITHOUT
 * needing Claude Desktop. Uses the official MCP client SDK to spawn the server,
 * handshake, list tools, and call get_winning_playbook, then asserts real corpus
 * content came back.
 *
 * This IS the Phase 0 acceptance test (PRD §7): transport works + tool returns
 * grounded proprietary content.
 *
 * Usage:
 *   npm run mcp:smoke                          # loads .env.local
 *   node scripts/mcp-smoke.mjs --env-file X    # known-good env
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = process.argv.slice(2);
const envFileIdx = args.indexOf('--env-file');
const envFile = envFileIdx >= 0 ? args[envFileIdx + 1] : resolve(repoRoot, '.env.local');

const loaded = {};
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    // `vercel env pull` writes literal \n inside values — strip it or a trailing newline
    // on the URL breaks the request path.
    val = val.replace(/\\n/g, '').trim();
    loaded[key] = val;
  }
}

const topic = args.find((a) => !a.startsWith('--') && a !== envFile) || 'how to win an 8(a) construction recompete';

function fail(msg) {
  console.error(`\n❌ SMOKE FAILED: ${msg}`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', resolve(repoRoot, 'src/mcp/server.ts')],
  cwd: repoRoot,
  env: { ...process.env, ...loaded },
});

const client = new Client({ name: 'mcp-smoke', version: '0.1.0' });

try {
  await client.connect(transport);
  console.error('✓ connected + initialized');

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  console.error(`✓ tools/list → [${names.join(', ')}]`);
  if (!names.includes('get_winning_playbook')) fail('get_winning_playbook not registered');

  console.error(`\n→ calling get_winning_playbook("${topic}")`);
  const res = await client.callTool({
    name: 'get_winning_playbook',
    arguments: { topic, naics_codes: ['236220'] },
  });

  const structured = res.structuredContent;
  if (!structured) fail('no structuredContent returned');
  console.error(`✓ grounded=${structured._meta?.grounded} · guidance_chunks=${structured._meta?.guidance_chunks} · win_story=${structured.win_story ? 'yes' : 'no'}`);
  console.error(`\n_ai_hint.summary:\n  ${structured._ai_hint?.summary}`);

  if (structured.guidance?.length) {
    console.error(`\nfirst guidance passage (${structured.guidance[0].source}):`);
    console.error(`  "${String(structured.guidance[0].text).slice(0, 220)}…"`);
  }

  if (!structured._meta?.grounded) {
    fail('grounded=false — corpus returned nothing (check SUPABASE_SERVICE_ROLE_KEY / try a broader topic)');
  }

  console.error('\n✅ SMOKE PASSED — MCP transport + proprietary corpus tool both live');
  await client.close();
  process.exit(0);
} catch (err) {
  fail(err?.message || String(err));
}
