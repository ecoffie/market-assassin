/**
 * Potato P2 host acceptance — first turn only.
 * Naive prompts A/B/C. No company / UEI / certs / NAICS / clearance / deliverable.
 *
 * Run from the worktree:
 *   npx tsx scripts/host-potato-p2-first-value.mts
 *
 * Env MUST be loaded before Mindy modules — find_opportunities captures
 * SUPABASE_URL at import time.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '../../.env.local') });

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (process.env[k]) process.env[k] = String(process.env[k]).replace(/\\n/g, '').replace(/\r?\n/g, '').trim();
}

const { listMcpTools, creditsFor, isMcpTool } = await import('@/lib/mcp/tool-registry');
const { runMeteredTool } = await import('@/lib/mcp/metered');
const { MCP_CONNECTOR_INSTRUCTIONS } = await import('@/lib/mcp/schedule-discovery');

const PROMPTS = [
  {
    id: 'A',
    user: 'I do cybersecurity work and want to sell to SOCOM. Help me.',
  },
  {
    id: 'B',
    user: 'I own a construction company and want to work with the Army. Where do I start?',
  },
  {
    id: 'C',
    user: 'I sell IT services and want to work with the VA.',
  },
] as const;

const JARGON =
  /\b(NAICS|PSC codes?|ATO|CNO|CEMA|SOFWERX|SOF AT&L|FCL|UEI|CAGE|set-aside|set aside|other.?transaction|\bOT\b|\bPAE\b|\bCSO\b)\b/i;

const QUALIFICATION_BEFORE =
  /whose company|which company|facility clearance|\bFCL\b|capability statement|market map|access-path|what deliverable|what do you want me to (build|produce)/i;

type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

function toAnthropicTools(defs: ToolDef[]): Anthropic.Tool[] {
  return defs.map((d) => ({
    name: d.function.name,
    description: d.function.description,
    input_schema: (d.function.parameters || { type: 'object', properties: {} }) as Anthropic.Tool['input_schema'],
  }));
}

const system = [
  'You are connected to Mindy MCP with the live tool catalog.',
  'Customers use ordinary language. Obey initialize instructions and each tool result\'s presentation.host_rules.',
  'Never invent solicitation numbers. Unavailable is not zero.',
  '',
  MCP_CONNECTOR_INSTRUCTIONS,
].join('\n');

type Call = { name: string; input: unknown; creditsCharged: number; ok: boolean; ms: number };

async function runOne(
  client: Anthropic,
  tools: Anthropic.Tool[],
  user: string,
): Promise<{
  toolCalls: Call[];
  finalText: string;
  firstFindMs: number | null;
  visibleMs: number | null;
  wallMs: number;
  instructionControlFailed: boolean;
}> {
  const t0 = Date.now();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  const toolCalls: Call[] = [];
  let finalText = '';
  let firstFindMs: number | null = null;
  const ctx = { userEmail: 'eric@govcongiants.com' };
  const MAX_TURNS = 6;

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
      const started = Date.now();
      let creditsCharged = 0;
      let ok = false;
      let raw: string;
      try {
        const out = await runMeteredTool(tu.name, (tu.input || {}) as Record<string, unknown>, ctx);
        ok = out.ok;
        creditsCharged = out.creditsCharged;
        raw = JSON.stringify(out.ok ? out.result : { error: out.error });
        if (!out.ok) {
          console.error(`TOOL_FAIL ${tu.name}`, JSON.stringify(out.error));
        } else {
          const j = out.result as Record<string, unknown>;
          const meta = j?._meta as Record<string, unknown> | undefined;
          console.log(
            `TOOL_OK ${tu.name} credits=${out.creditsCharged} grounded=${String(meta?.grounded)} ms=${Date.now() - started}`,
          );
        }
      } catch (err) {
        raw = JSON.stringify({
          error: 'tool_exec_failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      const ms = Date.now() - started;
      toolCalls.push({ name: tu.name, input: tu.input, creditsCharged, ok, ms });
      if (tu.name === 'find_opportunities' && firstFindMs == null) firstFindMs = Date.now() - t0;

      const capped = raw.length > 80_000 ? raw.slice(0, 80_000) + '…[truncated]' : raw;
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: capped });
    }

    messages.push({ role: 'user', content: results });
    if (texts.length) finalText = texts.join('\n');

    const findSoFar = toolCalls.filter((c) => c.name === 'find_opportunities').length;
    if (findSoFar > 1) {
      return {
        toolCalls,
        finalText: texts.join('\n') || finalText,
        firstFindMs,
        visibleMs: Date.now() - t0,
        wallMs: Date.now() - t0,
        instructionControlFailed: true,
      };
    }
  }

  return {
    toolCalls,
    finalText,
    firstFindMs,
    visibleMs: Date.now() - t0,
    wallMs: Date.now() - t0,
    instructionControlFailed: false,
  };
}

function grade(user: string, r: Awaited<ReturnType<typeof runOne>>) {
  const finds = r.toolCalls.filter((c) => c.name === 'find_opportunities');
  const findCredits = finds.reduce((s, c) => s + c.creditsCharged, 0);
  const mcpCredits = r.toolCalls.reduce((s, c) => s + c.creditsCharged, 0);
  const lower = r.finalText.toLowerCase();
  const askedBeforeValue = finds.length === 0 && (/\?/.test(r.finalText) || QUALIFICATION_BEFORE.test(r.finalText));
  const jargon = JARGON.test(r.finalText) && finds.length === 0;
  const hasOpen = /open now/i.test(r.finalText);
  const hasBack = /coming back/i.test(r.finalText);
  const hasSoon = /coming soon/i.test(r.finalText);
  const unavailableAsZero = /\bunavailable\b.+\b(zero|none|0 matches)\b/i.test(r.finalText);
  const questions = (r.finalText.match(/\?/g) || []).length;
  const deliverableMenu = /market map|access-path|capability statement/i.test(r.finalText) && finds.length === 0;
  const autoUnderstand = r.toolCalls.some((c) => c.name === 'understand_customer');
  const autoCai = r.toolCalls.some((c) => c.name === 'get_current_acquisition_intelligence');
  const extraResearch = r.toolCalls.some((c) =>
    ['lookup_federal_osbp', 'search_past_contracts', 'search_federal_contacts', 'get_expiring_contracts'].includes(
      c.name,
    ),
  );

  const pass =
    finds.length === 1 &&
    findCredits === 10 &&
    !askedBeforeValue &&
    hasOpen &&
    hasBack &&
    hasSoon &&
    !unavailableAsZero &&
    questions <= 2 &&
    !deliverableMenu &&
    !autoUnderstand &&
    !autoCai &&
    !extraResearch &&
    !r.instructionControlFailed;

  return {
    prompt: user,
    pass,
    instruction_control_failed: r.instructionControlFailed,
    find_calls_before_first_value: finds.length,
    find_credits: findCredits,
    total_mcp_credits: mcpCredits,
    tools: r.toolCalls.map((c) => `${c.name}:${c.creditsCharged}`),
    find_args: finds.map((c) => c.input),
    time_to_first_grounded_find_ms: r.firstFindMs,
    time_to_first_user_visible_ms: r.visibleMs,
    wall_ms: r.wallMs,
    questions_before_value: askedBeforeValue,
    jargon_before_value: jargon,
    web_before_value: false,
    artifact_before_value: false,
    presented_open: hasOpen,
    presented_coming_back: hasBack,
    presented_coming_soon: hasSoon,
    unavailable_as_zero: unavailableAsZero,
    question_marks_in_final: questions,
    auto_understand: autoUnderstand,
    auto_cai: autoCai,
    extra_research: extraResearch,
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing');
    process.exit(2);
  }
  if (!isMcpTool('find_opportunities') || creditsFor('find_opportunities') !== 10) {
    console.error('find_opportunities not 10 credits — abort');
    process.exit(3);
  }

  const defs = listMcpTools() as unknown as ToolDef[];
  const tools = toAnthropicTools(defs);
  const client = new Anthropic();
  const runStartedAt = new Date().toISOString();
  const results = [];

  for (const p of PROMPTS) {
    console.log(`\n\n========== PROMPT ${p.id} ==========\n${p.user}\n`);
    const r = await runOne(client, tools, p.user);
    console.log('=== TOOL_TRACE ===');
    console.log(JSON.stringify(r.toolCalls.map((c) => ({ name: c.name, credits: c.creditsCharged, ok: c.ok, ms: c.ms, input: c.input })), null, 2));
    console.log('\n=== HOST_FINAL_TEXT ===\n');
    console.log(r.finalText);
    const g = grade(p.user, r);
    console.log('\n=== GRADE ===\n', JSON.stringify(g, null, 2));
    results.push({ id: p.id, ...g, transcript: r.finalText, instructionControlFailed: r.instructionControlFailed });
    if (r.instructionControlFailed) {
      console.error('\nSTOP — instruction-level one-FIND control failed. Do not add server-side debit guard in this track.');
      break;
    }
  }

  console.log('\n\n========== P2 ACCEPTANCE SUMMARY ==========');
  console.log(JSON.stringify({ runStartedAt, results: results.map(({ transcript, ...rest }) => rest) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
