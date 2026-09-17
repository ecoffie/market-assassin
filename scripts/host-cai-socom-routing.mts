/**
 * Fresh host-routing test — full live MCP catalog (61 tools).
 * Exact SOCOM cyber prompt; no tool-name hints in the user message.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '../../.env.local') }); // worktree → primary

// Sanitize Vercel-style \\n in env (CAI scar)
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (process.env[k]) process.env[k] = String(process.env[k]).replace(/\\n/g, '').replace(/\r?\n/g, '').trim();
}

import { listMcpTools, runMcpTool, creditsFor, isMcpTool } from '@/lib/mcp/tool-registry';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';

const USER =
  'Using Mindy, what has changed about how SOCOM is buying cybersecurity, why does it matter, and what should I do differently now?';

type ToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  _credits?: number;
};

function toAnthropicTools(defs: ToolDef[]): Anthropic.Tool[] {
  return defs.map((d) => ({
    name: d.function.name,
    description: d.function.description,
    input_schema: (d.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool['input_schema'],
  }));
}

const system = [
  'You are connected to Mindy MCP with the full live tool catalog.',
  'Customers use ordinary language. Prefer the tool that matches the journey intent.',
  'After each successful tool result, look for `_next` and offer its primary suggestion in plain English when present.',
  'Never dump tool jargon. Never invent solicitation numbers or pathways Mindy did not establish.',
  'Do not search the web. Use only Mindy tools.',
  '',
  MCP_CONNECTOR_INSTRUCTIONS,
].join('\n');

async function main() {
  const defs = listMcpTools() as unknown as ToolDef[];
  const tools = toAnthropicTools(defs);

  console.log(
    'PROOF',
    JSON.stringify({
      catalog_count: tools.length,
      cai_registered: isMcpTool('get_current_acquisition_intelligence'),
      cai_credits: creditsFor('get_current_acquisition_intelligence'),
      understand_credits: creditsFor('understand_customer'),
      has_cai_in_tools: tools.some((t) => t.name === 'get_current_acquisition_intelligence'),
    }),
  );

  if (!tools.some((t) => t.name === 'get_current_acquisition_intelligence')) {
    console.error('CAI missing from listMcpTools — abort (invalid host test)');
    process.exit(3);
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: USER }];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let finalText = '';
  const MAX_TURNS = 10;
  const ctx = { userEmail: 'eric@govcongiants.com' };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system,
      tools,
      messages,
    });

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const texts = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text);

    if (toolUses.length === 0 || resp.stop_reason === 'end_turn') {
      finalText = texts.join('\n') || finalText;
      break;
    }

    messages.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      toolCalls.push({ name: tu.name, input: tu.input });
      console.log('\n=== TOOL_CALL ===');
      console.log(tu.name);
      console.log(JSON.stringify(tu.input, null, 2));

      let raw: string;
      try {
        const out = await runMcpTool(tu.name, (tu.input || {}) as Record<string, unknown>, ctx);
        raw = JSON.stringify(out.result ?? out);
      } catch (err) {
        raw = JSON.stringify({
          error: 'tool_exec_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      console.log('=== TOOL_RESULT_META ===');
      try {
        const j = JSON.parse(raw);
        console.log(
          JSON.stringify(
            {
              grounded: j?._meta?.grounded,
              degraded: j?._meta?.degraded,
              what_changed_n: Array.isArray(j?.what_changed) ? j.what_changed.length : undefined,
              seeing_n: Array.isArray(j?.what_we_are_seeing_now) ? j.what_we_are_seeing_now.length : undefined,
              do_n: Array.isArray(j?.do_differently) ? j.do_differently.length : Array.isArray(j?.do_differently_graph) ? j.do_differently_graph.length : undefined,
              nym_n: Array.isArray(j?.not_yet_measurable) ? j.not_yet_measurable.length : undefined,
              next: j?._next?.[0]?.prompt ?? j?._next,
              error: j?.error,
            },
            null,
            2,
          ),
        );
      } catch {
        console.log('(non-json)');
      }

      // Cap huge payloads for the model context
      const capped = raw.length > 100_000 ? raw.slice(0, 100_000) + '…[truncated]' : raw;
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: capped });
    }

    messages.push({ role: 'user', content: results });
    if (texts.length) finalText = texts.join('\n');
  }

  console.log('\n=== TOOL_TRACE ===');
  console.log(JSON.stringify(toolCalls.map((t) => t.name)));
  console.log(JSON.stringify(toolCalls, null, 2));

  console.log('\n=== HOST_FINAL_TEXT ===\n');
  console.log(finalText);

  const usedCai = toolCalls.some((t) => t.name === 'get_current_acquisition_intelligence');
  const lower = (finalText || '').toLowerCase();
  const bannedHits = [
    'the competition already happened',
    'the binding constraint is',
    'where the money goes next',
  ].filter((p) => lower.includes(p));
  const zeroHorizonClaim =
    /\b(0|zero)\s+(forecasts?|open notices?|agency forecasts?)\b/i.test(finalText || '') ||
    /\bno\s+(forecasts?|open notices?)\s+(at all|whatsoever)\b/i.test(finalText || '');

  console.log(
    '\n=== ROUTING_NOTE ===\n',
    JSON.stringify({
      used_cai: usedCai,
      call_count: toolCalls.length,
      tools: toolCalls.map((t) => t.name),
    }),
  );
  console.log(
    '\n=== LANGUAGE_GRADE ===\n',
    JSON.stringify({
      banned_absolute_hits: bannedHits,
      unavailable_described_as_zero: zeroHorizonClaim,
      mentions_cso: /\bcso\b|commercial solutions opening/i.test(finalText || ''),
      invents_when_empty_do:
        usedCai &&
        /\byou (must|should) (immediately|definitely)\b/i.test(finalText || '') &&
        /\bdo differently\b/i.test(finalText || ''),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
