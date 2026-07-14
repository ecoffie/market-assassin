/**
 * MCP corpus extraction guard — Layers A + B (scope: tasks/SCOPE-mcp-extraction-guardrails.md).
 *
 * Protects the PROPRIETARY tools (see PROPRIETARY_TOOLS in tool-registry.ts) from bulk
 * extraction through the hosted MCP server. The public-data passthroughs are NOT touched.
 *
 *   Layer A — free credits can't unlock the crown jewels. The 100-credit signup grant buys
 *             an evaluation of the PUBLIC-data tools; a proprietary call needs PAID standing
 *             (a top-up, a Pro monthly allowance, or an admin/comp grant). A drive-by scraper
 *             with only free credits gets nothing.
 *   Layer B — per-account rolling-window volume caps on proprietary calls. A human researcher
 *             never hits them; an enumerator does.
 *
 * Called from runMeteredTool ONLY when `mcpFlags.extractionGuard` is on, and ONLY for
 * proprietary tools. FAIL-OPEN: if the guard's own queries error, it returns null (allow) so
 * a guard bug can never take down the paid API. Enforcement vs log-only is decided by the
 * caller via `mcpFlags.extractionEnforce`.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Ledger reasons that mark an account as having PAID standing (Layer A gate). */
const PAID_REASONS = ['stripe_topup', 'pro_monthly', 'admin_grant'] as const;

/** Call-log statuses that count as a DELIVERED proprietary result (Layer B tally). */
const DELIVERED_STATUSES = ['success', 'uncharged'] as const;

function intFromEnv(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/** Rolling caps on proprietary calls per account (env-tunable; measure log-only, then set). */
export const PROPRIETARY_CAP_DAY = intFromEnv('MCP_PROPRIETARY_CAP_DAY', 40);
export const PROPRIETARY_CAP_WEEK = intFromEnv('MCP_PROPRIETARY_CAP_WEEK', 150);

const DAY_MS = 24 * 60 * 60 * 1000;

export type GuardStatus = 'requires_paid' | 'throttled';

export interface GuardVerdict {
  /** The blocking rule that fired. */
  status: GuardStatus;
  /** Error code an enforced block returns to the agent. */
  code: string;
  /** Human message the agent can relay. */
  message: string;
}

/** True if the account has ever received PAID credits (top-up / Pro / admin). */
async function hasPaidStanding(userEmail: string): Promise<boolean> {
  const { data, error } = await getWriteClient()
    .from('mcp_credit_ledger')
    .select('id')
    .eq('user_email', userEmail.toLowerCase())
    .gt('delta', 0)
    .in('reason', PAID_REASONS as unknown as string[])
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Count DELIVERED proprietary results for this account since `sinceMs` ago. */
async function proprietaryCountSince(userEmail: string, sinceMs: number, proprietary: string[]): Promise<number> {
  const sinceIso = new Date(Date.now() - sinceMs).toISOString();
  const { count, error } = await getWriteClient()
    .from('mcp_call_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', userEmail.toLowerCase())
    .in('tool_name', proprietary)
    .in('status', DELIVERED_STATUSES as unknown as string[])
    .gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Evaluate the guard for a single proprietary-tool call. Returns a verdict if a rule
 * fired, or null if the call is clean (or on any error — FAIL-OPEN).
 *
 * @param proprietary the full proprietary-tool name list (passed in to keep this module
 *   free of a tool-registry import cycle).
 */
export async function evaluateExtractionGuard(
  userEmail: string,
  proprietary: string[],
): Promise<GuardVerdict | null> {
  try {
    // Layer A — free-only accounts can't call proprietary tools.
    const paid = await hasPaidStanding(userEmail);
    if (!paid) {
      return {
        status: 'requires_paid',
        code: 'requires_paid_credits',
        message:
          'This tool draws on Mindy\'s proprietary corpus and needs a paid credit balance. ' +
          'Top up at getmindy.ai/mcp — your free trial credits still work on every public-data tool.',
      };
    }

    // Layer B — per-account rolling volume caps (paid accounts included).
    const [day, week] = await Promise.all([
      proprietaryCountSince(userEmail, DAY_MS, proprietary),
      proprietaryCountSince(userEmail, 7 * DAY_MS, proprietary),
    ]);
    if (day >= PROPRIETARY_CAP_DAY || week >= PROPRIETARY_CAP_WEEK) {
      const which = day >= PROPRIETARY_CAP_DAY ? `${PROPRIETARY_CAP_DAY}/day` : `${PROPRIETARY_CAP_WEEK}/week`;
      return {
        status: 'throttled',
        code: 'rate_limited',
        message:
          `You've reached the proprietary-tool limit (${which}). This protects Mindy's curated ` +
          'intelligence from bulk export. It resets on a rolling window; contact hello@govcongiants.com for higher limits.',
      };
    }

    return null;
  } catch (err) {
    // FAIL-OPEN: never let a guard-query error block a paying customer.
    console.error('[mcp:extraction-guard] evaluation failed (fail-open, allowing call):', err);
    return null;
  }
}
