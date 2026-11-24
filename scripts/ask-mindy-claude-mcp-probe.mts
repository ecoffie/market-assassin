/**
 * Ask Mindy ↔ Claude + MCP probe.
 *
 * Asks Claude the same questions a customer asks in claude.ai, with Claude
 * connected to the live Mindy MCP server through the Messages API MCP
 * connector. Same server, same tools, same tool descriptions, same
 * presentation rules in the results: this is the answer Ask Mindy should give.
 *
 * Read-only toward our code paths. It DOES call production tools as the
 * chosen account, so that account's credits are spent (use a staff test account).
 *
 *   npx tsx scripts/ask-mindy-claude-mcp-probe.mts --email erika@govcongiants.com \
 *     [--model claude-opus-5-5] [--only 1,3] [--no-instructions] [--out <dir>]
 */
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { issueAccessToken, OAUTH_RESOURCE } from '../src/lib/mcp/oauth/tokens';
import { PROBE_QUESTIONS } from '../src/lib/chat/claude-mcp-parity-questions';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const has = (k: string) => process.argv.includes(`--${k}`);

const EMAIL = arg('email');
if (!EMAIL) throw new Error('--email is required (use a staff test account)');
const MODEL = arg('model') || 'claude-opus-5-5';
const MCP_URL = arg('mcp-url') || OAUTH_RESOURCE;
const OUT = arg('out') || join(process.cwd(), '.tmp-claude-mcp-probe', new Date().toISOString().replace(/[:.]/g, '-'));
const USE_INSTRUCTIONS = !has('no-instructions');


const only = arg('only')?.split(',').map(Number);
const questions = only ? PROBE_QUESTIONS.filter((x) => only.includes(x.id)) : PROBE_QUESTIONS;

const { token } = issueAccessToken(EMAIL, 'ask-mindy-claude-mcp-probe');

/** The MCP server's own instructions, exactly as an MCP host receives them on initialize. */
async function fetchServerInstructions(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ask-mindy-probe', version: '0' } },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP initialize ${res.status}: ${text.slice(0, 300)}`);
  const json = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) || '').slice(5);
  const parsed = JSON.parse(json);
  return parsed?.result?.instructions || '';
}

type Block = Anthropic.Beta.BetaContentBlock;

async function ask(client: Anthropic, system: string, q: string) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: q }];
  const calls: { name: string; input: unknown; isError?: boolean }[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let finalText = '';
  let stop: string | null = null;
  const started = Date.now();
  for (let turn = 0; turn < 8; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      ...(system ? { system } : {}),
      betas: ['mcp-client-2025-11-20'],
      mcp_servers: [{ type: 'url', url: MCP_URL, name: 'mindy', authorization_token: token }],
      tools: [{ type: 'mcp_toolset', mcp_server_name: 'mindy' }],
      messages,
    } as Anthropic.Beta.MessageCreateParamsStreaming);
    const msg = await stream.finalMessage();
    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    for (const b of msg.content as Block[]) {
      if (b.type === 'mcp_tool_use') calls.push({ name: b.name, input: b.input });
      if (b.type === 'mcp_tool_result' && b.is_error && calls.length) calls[calls.length - 1].isError = true;
      if (b.type === 'text') finalText += b.text;
    }
    stop = msg.stop_reason;
    if (stop !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
  }
  return { calls, finalText, stop, usage, seconds: Math.round((Date.now() - started) / 1000) };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const client = new Anthropic();
  const system = USE_INSTRUCTIONS ? await fetchServerInstructions() : '';
  writeFileSync(join(OUT, 'server-instructions.txt'), system);
  console.log(`model=${MODEL} mcp=${MCP_URL} account=${EMAIL} instructions=${system.length} chars → ${OUT}`);

  const results = await Promise.all(
    questions.map(async (item) => {
      try {
        const r = await ask(client, system, item.q);
        console.log(`#${item.id} ${item.intent}: ${r.calls.map((c) => c.name + (c.isError ? '(error)' : '')).join(' → ') || 'no tools'} · ${r.seconds}s · stop=${r.stop}`);
        return { ...item, ...r };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        console.log(`#${item.id} FAILED: ${err.slice(0, 300)}`);
        return { ...item, error: err };
      }
    }),
  );

  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ model: MODEL, mcp: MCP_URL, results }, null, 2));
  const md = results
    .map((r) =>
      [
        `## #${r.id} ${r.intent}`,
        `**Q:** ${r.q}`,
        'error' in r
          ? `**ERROR:** ${r.error}`
          : [
              `**Tools:** ${r.calls.map((c) => `\`${c.name}\` ${JSON.stringify(c.input)}`).join('<br>') || 'none'}`,
              `**Tokens:** in ${r.usage.input} · out ${r.usage.output} · ${r.seconds}s`,
              '',
              r.finalText,
            ].join('\n'),
      ].join('\n\n'),
    )
    .join('\n\n---\n\n');
  writeFileSync(join(OUT, 'answers.md'), `# Claude + Mindy MCP probe (${MODEL})\n\n${md}\n`);
  console.log(`wrote ${join(OUT, 'answers.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
