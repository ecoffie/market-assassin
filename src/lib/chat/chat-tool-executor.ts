/**
 * Ask Mindy chat tool executor — the ONLY path the in-app chat uses to run a tool.
 *
 * Every call goes through, in order:
 *   1. per-round budget (MAX_CALLS_PER_ROUND, MAX_WRITES_PER_ROUND)
 *   2. argument parsing — unparseable arguments are REFUSED, never run as `{}`
 *      (an empty argument object turns a filtered search into a national one)
 *   3. confirmation stripping — a model-supplied `confirm` is never a user confirmation
 *   4. the chat tool policy (chat-tool-policy.ts), re-checked here even though blocked tools
 *      are never offered, so an invented or injected tool name cannot reach tool code
 *   5. the same input preflight MCP uses (preflightPaidInput)
 *   6. execution with per-tool error capture — every call yields a tool result, so one
 *      failing tool can never leave the model transcript without a matching result
 *   7. an mcp_call_log row (channel 'app_chat') with redacted arguments, the catalog credit
 *      price, 0 credits charged (approved observation period), model/provider and ids
 *
 * Tool implementations are not duplicated: registry tools dispatch through runMcpTool,
 * chat-private tools through the tier-0 executor.
 */
import { randomUUID } from 'node:crypto';
import { listMcpTools, isMcpTool, runMcpTool, creditsFor } from '@/lib/mcp/tool-registry';
import { logCall, type CallStatus } from '@/lib/mcp/credits';
import { preflightPaidInput } from '@/lib/mcp/credit-integrity';
import { classifyCallOutcome } from '@/lib/mcp/call-outcome';
import { chatToolPolicy, isChatOfferable, type ChatToolPolicy } from './chat-tool-policy';
import { redactToolArgs } from './redact-args';

export const MAX_CALLS_PER_ROUND = 8;
export const MAX_WRITES_PER_ROUND = 1;

export interface ChatToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface Tier0Like {
  defs: ReadonlyArray<{ type: 'function'; function: { name: string } & Record<string, unknown> }>;
  names: ReadonlySet<string>;
  execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ChatToolExecutorDeps {
  listMcpTools: typeof listMcpTools;
  isMcpTool: typeof isMcpTool;
  runMcpTool: typeof runMcpTool;
  creditsFor: typeof creditsFor;
  logCall: typeof logCall;
}

const DEFAULT_DEPS: ChatToolExecutorDeps = { listMcpTools, isMcpTool, runMcpTool, creditsFor, logCall };

/** One executed (or refused) call, for the turn trace. No arguments, no result bodies. */
export interface ChatExecutionRecord {
  execution_id: string;
  tool: string;
  decision: ChatToolPolicy['decision'] | 'not_evaluated';
  status: CallStatus;
  error_category: string | null;
  latency_ms: number;
}

export interface ChatToolResult {
  tool_call_id: string;
  /** JSON string for the role:'tool' message. */
  content: string;
  record: ChatExecutionRecord;
}

/** The planner model/provider that requested a round of calls (logged on every row). */
export interface PlannerIdentity {
  model: string;
  provider: string;
}

export interface ChatToolExecutorOptions {
  userEmail: string;
  chatSessionId: string | null;
  tier0: Tier0Like;
  deps?: Partial<ChatToolExecutorDeps>;
}

function refusal(category: string, message: string): Record<string, unknown> {
  return { ok: false, state: 'unavailable', error_category: category, message };
}

function extractResourceIds(name: string, result: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!result) return null;
  if (name === 'schedule_market_search' || name === 'update_market_schedule') {
    const id = result.schedule_id;
    return typeof id === 'string' && id ? { saved_search_id: id } : null;
  }
  return null;
}

export function createChatToolExecutor(opts: ChatToolExecutorOptions) {
  const deps: ChatToolExecutorDeps = { ...DEFAULT_DEPS, ...(opts.deps ?? {}) };
  const tier0 = opts.tier0;

  const isRegistered = (name: string) => tier0.names.has(name) || deps.isMcpTool(name);
  const policyFor = (name: string) => chatToolPolicy(name, isRegistered(name));

  /** Tool definitions the model may see: tier-0 + registry, filtered by the policy. */
  function offeredToolDefs(): Array<{ type: 'function'; function: Record<string, unknown> }> {
    const registry = deps
      .listMcpTools()
      .map((d) => ({ type: 'function' as const, function: d.function as Record<string, unknown> }))
      // A registry tool may never shadow a chat-private tool.
      .filter((d) => !tier0.names.has(String(d.function?.name ?? '')));
    const all = [...tier0.defs.map((d) => ({ type: 'function' as const, function: d.function as Record<string, unknown> })), ...registry];
    return all.filter((d) => isChatOfferable(policyFor(String(d.function?.name ?? ''))));
  }

  async function log(
    planner: PlannerIdentity,
    name: string,
    status: CallStatus,
    executionId: string,
    fields: {
      args?: Record<string, unknown>;
      latencyMs?: number;
      errorCategory?: string | null;
      resourceIds?: Record<string, unknown> | null;
      result?: unknown;
    },
  ) {
    const isRegistry = deps.isMcpTool(name);
    await deps.logCall({
      userEmail: opts.userEmail,
      toolName: name || '(empty)',
      status,
      creditsCharged: 0, // observation period: price recorded, nothing deducted
      latencyMs: fields.latencyMs,
      channel: 'app_chat',
      ...(fields.result !== undefined ? { outcome: classifyCallOutcome(fields.result) } : {}),
      trace: {
        executionId,
        chatSessionId: opts.chatSessionId,
        model: planner.model,
        provider: planner.provider,
        argsRedacted: fields.args ? redactToolArgs(fields.args) : null,
        creditPrice: isRegistry ? deps.creditsFor(name) : 0,
        resourceIds: fields.resourceIds ?? null,
        errorCategory: fields.errorCategory ?? null,
      },
    });
  }

  async function executeOne(
    call: ChatToolCall,
    budget: { calls: number; writes: number },
    planner: PlannerIdentity,
  ): Promise<ChatToolResult> {
    const executionId = randomUUID();
    const toolCallId = call.id || `call_${executionId.slice(0, 8)}`;
    const name = String(call.function?.name ?? '');
    const started = Date.now();
    const done = (
      status: CallStatus,
      decision: ChatExecutionRecord['decision'],
      errorCategory: string | null,
      body: Record<string, unknown>,
    ): ChatToolResult => ({
      tool_call_id: toolCallId,
      content: JSON.stringify(body),
      record: { execution_id: executionId, tool: name, decision, status, error_category: errorCategory, latency_ms: Date.now() - started },
    });

    // 1) Round budget.
    budget.calls += 1;
    if (budget.calls > MAX_CALLS_PER_ROUND) {
      await log(planner, name, 'blocked_policy', executionId, { errorCategory: 'round_budget_exceeded' });
      return done('blocked_policy', 'not_evaluated', 'round_budget_exceeded',
        refusal('round_budget_exceeded', `Only ${MAX_CALLS_PER_ROUND} lookups run per step; this one was skipped. Do not treat it as an empty result.`));
    }

    // 2) Arguments. Refuse unparseable input instead of running it as {}.
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(call.function?.arguments || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      args = parsed as Record<string, unknown>;
    } catch {
      await log(planner, name, 'blocked_policy', executionId, { errorCategory: 'invalid_arguments' });
      return done('blocked_policy', 'not_evaluated', 'invalid_arguments',
        refusal('invalid_arguments', 'The lookup arguments could not be read, so it did not run. Do not treat this as an empty result.'));
    }

    // 3) A model-supplied confirmation is never a user confirmation.
    if ('confirm' in args) {
      const { confirm: _ignored, ...rest } = args;
      void _ignored;
      args = rest;
    }

    // 4) Policy — re-checked at execution, not only when offering.
    const policy = policyFor(name);
    if (!isChatOfferable(policy)) {
      const category = policy.decision === 'requires_confirmation' ? 'confirmation_required' : policy.decision;
      await log(planner, name, 'blocked_policy', executionId, { args, errorCategory: category });
      return done('blocked_policy', policy.decision, category,
        refusal(category, policy.userMessage || 'That capability is not available from chat.'));
    }
    if (policy.decision === 'allowed_write') {
      budget.writes += 1;
      if (budget.writes > MAX_WRITES_PER_ROUND) {
        await log(planner, name, 'blocked_policy', executionId, { args, errorCategory: 'write_budget_exceeded' });
        return done('blocked_policy', policy.decision, 'write_budget_exceeded',
          refusal('write_budget_exceeded', 'Only one change can be made per step. Ask the user to confirm the next change separately.'));
      }
    }

    // 5) Same input preflight as MCP (registry tools only).
    if (deps.isMcpTool(name)) {
      const rejection = preflightPaidInput(name, args);
      if (rejection) {
        await log(planner, name, 'rejected_invalid_input', executionId, { args, errorCategory: 'invalid_input' });
        return done('rejected_invalid_input', policy.decision, 'invalid_input', refusal('invalid_input', rejection.message));
      }
    }

    // 6) Execute with per-tool error capture.
    try {
      const result = tier0.names.has(name)
        ? await tier0.execute(name, args)
        : (await deps.runMcpTool(name, args, { userEmail: opts.userEmail })).result;
      const latencyMs = Date.now() - started;
      const resourceIds = policy.decision === 'allowed_write' ? extractResourceIds(name, result) : null;
      await log(planner, name, 'success', executionId, { args, latencyMs, resourceIds, result });
      return done('success', policy.decision, null, result ?? {});
    } catch (err) {
      const latencyMs = Date.now() - started;
      console.error(`[chat] tool ${name} failed:`, err);
      await log(planner, name, 'failed', executionId, { args, latencyMs, errorCategory: 'tool_error' });
      return done('failed', policy.decision, 'tool_error',
        refusal('tool_error', 'This lookup failed, so its data is unavailable. Do not treat it as an empty result.'));
    }
  }

  /** Run one model round of tool calls. Always returns one result per call, in order. */
  async function executeRound(calls: ChatToolCall[], planner: PlannerIdentity): Promise<ChatToolResult[]> {
    const budget = { calls: 0, writes: 0 };
    const out: ChatToolResult[] = [];
    // Sequential, as before (parallel execution of independent calls is Phase 2).
    for (const call of calls) out.push(await executeOne(call, budget, planner));
    return out;
  }

  return { offeredToolDefs, executeRound, policyFor };
}
