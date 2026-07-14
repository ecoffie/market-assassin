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
import { creditsFor, isMcpTool, isProprietaryTool, PROPRIETARY_TOOLS, runMcpTool, type McpToolContext } from './tool-registry';
import { getBalance, debitCredits, logCall, type CallStatus } from './credits';
import { mcpFlags } from './flags';
import { isProTool, isProForMcp } from './entitlements';
import { evaluateExtractionGuard } from './extraction-guard';

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

  // 0) Tier gate — Pro-only tools require a Pro subscription. Flag-gated (off by
  // default → zero behavior change). A denied call is NOT charged and does NOT throw:
  // the agent gets a clear `requires_pro` message it can relay, not a mid-run crash.
  // The `gated` log row is the upsell queue (who hit the wall = who to convert).
  if (mcpFlags.enforceTiers && isProTool(name)) {
    const pro = await isProForMcp(ctx.userEmail);
    if (!pro) {
      await logCall({ userEmail: ctx.userEmail, toolName: name, status: 'gated', creditsCharged: 0, apiKeyId: ctx.apiKeyId });
      return {
        ok: false,
        error: {
          code: 'requires_pro',
          message: `${name} is a Mindy Pro tool. Upgrade at getmindy.ai/app to use it — your credits for every other tool still work.`,
        },
        creditsCharged: 0,
      };
    }
  }

  // 0.5) Extraction guard (Layers A+B) — protect the proprietary corpora from bulk
  // export. Runs ONLY when flagged on AND only for proprietary tools (zero cost/latency
  // otherwise). LOG-ONLY by default: a violation writes a `shadow_*` call-log row but the
  // call still runs, so we measure real impact before enforcing. With extractionEnforce
  // on, a violation is blocked with a clean, non-charged error (never a mid-run crash) —
  // same shape as the tier gate above.
  if (mcpFlags.extractionGuard && isProprietaryTool(name)) {
    const verdict = await evaluateExtractionGuard(ctx.userEmail, Array.from(PROPRIETARY_TOOLS));
    if (verdict) {
      const enforce = mcpFlags.extractionEnforce;
      await logCall({
        userEmail: ctx.userEmail,
        toolName: name,
        status: (enforce ? verdict.status : `shadow_${verdict.status}`) as CallStatus,
        creditsCharged: 0,
        apiKeyId: ctx.apiKeyId,
      });
      if (enforce) {
        return { ok: false, error: { code: verdict.code, message: verdict.message }, creditsCharged: 0 };
      }
      // log-only: fall through and run the call exactly as before.
    }
  }

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
