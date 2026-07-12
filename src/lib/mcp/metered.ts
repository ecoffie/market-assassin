/**
 * Metered tool execution — the credit-aware wrapper the hosted MCP route calls.
 *
 * Phase 1 Slice 3. Wraps the transport-agnostic runMcpTool (Slice 2) with the
 * "debit on success only" flow:
 *   1. pre-check balance (priced tools) → reject empties BEFORE running (top-up msg)
 *   2. run the tool
 *   3. success → atomic debit; failure → debit 0
 * Every outcome writes a mcp_call_log row. Free tools (get_balance) skip billing.
 */
import { creditsFor, isMcpTool, runMcpTool, type McpToolContext } from './tool-registry';
import { getBalance, debitCredits, logCall } from './credits';

export interface MeteredContext extends McpToolContext {
  /** The verified key id, for the call log / ledger attribution. */
  apiKeyId?: string | null;
}

export type MeteredOutcome =
  | { ok: true; result: Record<string, unknown>; creditsCharged: number; balance: number | null }
  | { ok: false; error: { code: string; message: string }; creditsCharged: 0; balance?: number };

export async function runMeteredTool(
  name: string,
  args: Record<string, unknown>,
  ctx: MeteredContext,
): Promise<MeteredOutcome> {
  if (!isMcpTool(name)) {
    return { ok: false, error: { code: 'unknown_tool', message: `Unknown tool: ${name}` }, creditsCharged: 0 };
  }

  const cost = creditsFor(name);

  // 1) Pre-check — reject an empty balance before doing any work.
  if (cost > 0) {
    const balance = await getBalance(ctx.userEmail);
    if (balance < cost) {
      await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'rejected_no_credits', creditsCharged: 0, apiKeyId: ctx.apiKeyId });
      return {
        ok: false,
        error: {
          code: 'insufficient_credits',
          message: `This tool costs ${cost} credit${cost === 1 ? '' : 's'}; your balance is ${balance}. Top up at getmindy.ai/mcp.`,
        },
        creditsCharged: 0,
        balance,
      };
    }
  }

  // 2) Run the tool.
  const startedAt = Date.now();
  let result: Record<string, unknown>;
  try {
    const run = await runMcpTool(name, args, ctx);
    result = run.result;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'failed', creditsCharged: 0, latencyMs, apiKeyId: ctx.apiKeyId });
    return { ok: false, error: { code: 'tool_error', message: err instanceof Error ? err.message : String(err) }, creditsCharged: 0 };
  }
  const latencyMs = Date.now() - startedAt;

  // 3) Free tool → success, no billing.
  if (cost <= 0) {
    await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'success', creditsCharged: 0, latencyMs, apiKeyId: ctx.apiKeyId });
    return { ok: true, result, creditsCharged: 0, balance: null };
  }

  // 3) Priced tool → debit on success (atomic).
  const debit = await debitCredits(ctx.userEmail, cost, { reason: 'tool_call', toolName: name, apiKeyId: ctx.apiKeyId });
  if (debit.ok) {
    await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'success', creditsCharged: cost, latencyMs, apiKeyId: ctx.apiKeyId });
    return { ok: true, result, creditsCharged: cost, balance: debit.newBalance };
  }

  // Edge race: balance dropped below cost between pre-check and debit (concurrent
  // calls at a near-empty balance). The result is already produced — deliver it, but
  // charge 0 and mark it uncharged for reconciliation. Balance is never negative.
  await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'uncharged', creditsCharged: 0, latencyMs, apiKeyId: ctx.apiKeyId });
  return { ok: true, result, creditsCharged: 0, balance: debit.newBalance };
}
