/**
 * Ask Mindy as a Claude + Mindy MCP host.
 *
 * Goal (Eric, 2026-11-24): Ask Mindy gives the answers Claude + the Mindy MCP server give in claude.ai.
 * So instead of a parallel planner, prompt and tool list, this runs the same thing claude.ai runs:
 *   - Claude, through the Messages API MCP connector (beta `mcp-client-2025-11-20`);
 *   - the live Mindy MCP server (same tools, same descriptions, same presentation.host_rules in results);
 *   - the server's own connector instructions as the system prompt, imported from the constant the MCP
 *     endpoint serves on initialize (never a copy).
 * Tools run on the MCP server as the signed-in user (a short-lived token signed for them), so metering,
 * tiers and audit are the MCP server's, exactly as in claude.ai.
 *
 * Ask Mindy stays on the Map (the home screen); it does NOT drive the Map. That is Phase 3.
 *
 * Off unless ASK_MINDY_CLAUDE_MCP=true AND the user is on ASK_MINDY_CLAUDE_MCP_ALLOWLIST
 * (comma-separated emails, or `*` for everyone).
 */
import Anthropic from '@anthropic-ai/sdk';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';
import { issueAccessToken, OAUTH_RESOURCE } from '@/lib/mcp/oauth/tokens';

export const CLAUDE_MCP_BETA = 'mcp-client-2025-11-20';
export const CLAUDE_MCP_SERVER_NAME = 'mindy';
export const CLAUDE_MCP_CLIENT_ID = 'ask-mindy';
const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_CONTINUATIONS = 6; // pause_turn resumes

type Env = Record<string, string | undefined>;

export function claudeMcpEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.ASK_MINDY_CLAUDE_MCP !== 'true' || !email) return false;
  const list = (env.ASK_MINDY_CLAUDE_MCP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}

export function claudeMcpModel(env: Env = process.env): string {
  return env.ASK_MINDY_CLAUDE_MCP_MODEL || DEFAULT_MODEL;
}

/** Where the connector reaches the MCP server. Production default = the public connector URL. */
export function claudeMcpServerUrl(env: Env = process.env): string {
  return env.ASK_MINDY_CLAUDE_MCP_URL || OAUTH_RESOURCE;
}

/** The system prompt: the MCP server's own instructions, as any MCP host receives them. */
export function claudeMcpSystemPrompt(): string {
  return MCP_CONNECTOR_INSTRUCTIONS;
}

export interface PriorTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Prior turns as plain text (tool calls are not replayed; Claude re-calls tools when it needs facts). */
export function buildClaudeMcpMessages(history: PriorTurn[], question: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    const text = String(t?.content ?? '').trim();
    if (!text || (t.role !== 'user' && t.role !== 'assistant')) continue;
    const last = out[out.length - 1];
    // The API needs alternating roles and a user first; merge same-role neighbours.
    if (last && last.role === t.role) last.content = `${last.content as string}\n\n${text}`;
    else if (out.length || t.role === 'user') out.push({ role: t.role, content: text });
  }
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.content = `${last.content as string}\n\n${question}`;
  else out.push({ role: 'user', content: question });
  return out;
}

export interface ClaudeMcpToolCall {
  name: string;
  input: unknown;
  isError: boolean;
}

export interface ClaudeMcpResult {
  text: string;
  model: string;
  stopReason: string | null;
  toolCalls: ClaudeMcpToolCall[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export async function runClaudeMcpAnswer(opts: {
  email: string;
  history: PriorTurn[];
  question: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
  env?: Env;
  client?: Anthropic;
}): Promise<ClaudeMcpResult> {
  const env = opts.env ?? process.env;
  const model = claudeMcpModel(env);
  const client = opts.client ?? new Anthropic();
  const { token } = issueAccessToken(opts.email, CLAUDE_MCP_CLIENT_ID);
  const messages = buildClaudeMcpMessages(opts.history, opts.question);
  const toolCalls: ClaudeMcpToolCall[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let text = '';
  let stopReason: string | null = null;

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        // Tools render before system, so this one breakpoint caches the MCP tool list + instructions
        // (~36K tokens, identical every turn). Tool results stay uncached: they are never reused.
        system: [{ type: 'text', text: claudeMcpSystemPrompt(), cache_control: { type: 'ephemeral' } }],
        betas: [CLAUDE_MCP_BETA],
        mcp_servers: [{ type: 'url', url: claudeMcpServerUrl(env), name: CLAUDE_MCP_SERVER_NAME, authorization_token: token }],
        tools: [{ type: 'mcp_toolset', mcp_server_name: CLAUDE_MCP_SERVER_NAME }],
        messages,
      } as Anthropic.Beta.MessageCreateParamsStreaming,
      { signal: opts.signal },
    );
    stream.on('text', (delta) => {
      text += delta;
      opts.onText(delta);
    });
    const msg = await stream.finalMessage();
    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
    for (const b of msg.content) {
      if (b.type === 'mcp_tool_use') toolCalls.push({ name: b.name, input: b.input, isError: false });
      if (b.type === 'mcp_tool_result' && b.is_error && toolCalls.length) toolCalls[toolCalls.length - 1].isError = true;
    }
    stopReason = msg.stop_reason;
    if (stopReason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
  }
  return { text, model, stopReason, toolCalls, usage };
}

/** Prompt-token equivalent for cost logging: cache writes bill at 1.25x, cache reads at 0.1x. */
export function claudeMcpPromptTokenEquivalent(u: ClaudeMcpResult['usage']): number {
  return Math.round(u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1);
}
