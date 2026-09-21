/**
 * MRR — the Mindy tool client.
 *
 * Calls tools IN-PROCESS via `runMcpTool` (the same dispatcher the hosted MCP
 * edge uses), so the prototype exercises the real tool code without HTTP, auth,
 * billing, or the credit ledger. Every call returns the raw result PLUS a
 * stamped `EvidenceRef` recording the exact arguments and retrieval instant —
 * so provenance is captured AT THE CALL, never reconstructed from logs later.
 *
 * Failure policy: a thrown call becomes a recorded FAILURE, never an empty
 * success. Callers turn that into `unknown`, never `0` and never `[]`.
 */
import { runMcpTool } from '@/lib/mcp/tool-registry';
import type { EvidenceRef } from './types';

/** Identifies this prototype to the tool layer; not a billing identity. */
const MRR_CALLER_EMAIL = process.env.MRR_CALLER_EMAIL || 'eric@govcongiants.com';

export interface ToolCall<T = Record<string, unknown>> {
  tool: string;
  args: Record<string, unknown>;
  evidence: EvidenceRef;
  /** Present when the call returned. */
  result?: T;
  /** Present when the call threw. Mutually exclusive with `result`. */
  error?: string;
  ok: boolean;
}

function sourceLabel(tool: string): string {
  return `Mindy MCP ${tool}`;
}

/**
 * Invoke one Mindy tool and stamp its evidence.
 * NEVER throws — the failure is returned as data so the caller must decide how
 * to render it (an exception silently caught upstream is how a failed query
 * becomes a fake empty market).
 */
export async function callTool<T = Record<string, unknown>>(
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolCall<T>> {
  const startedAt = new Date().toISOString();
  // SNAPSHOT the arguments. A caller that later mutates its args object (e.g. the
  // §9 agency-scope fallback rewriting its filter) must not be able to rewrite what
  // this call is recorded as having run — provenance describes what happened, and a
  // live reference would let it silently change afterwards.
  const snapshot: Record<string, unknown> = JSON.parse(JSON.stringify(args));
  const evidence: EvidenceRef = { source: sourceLabel(tool), retrievedAt: startedAt, query: snapshot };
  try {
    const run = await runMcpTool(tool, args, { userEmail: MRR_CALLER_EMAIL });
    return {
      tool,
      args: snapshot,
      evidence: { ...evidence, retrievedAt: new Date().toISOString() },
      result: run.result as T,
      ok: true,
    };
  } catch (err) {
    return {
      tool,
      args: snapshot,
      evidence: { ...evidence, retrievedAt: new Date().toISOString() },
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

/** Read `_meta.grounded` without collapsing "absent" into "false". */
export function metaGrounded(result: unknown): boolean | undefined {
  const meta = (result as { _meta?: Record<string, unknown> } | undefined)?._meta;
  if (!meta) return undefined;
  const g = meta.grounded;
  return typeof g === 'boolean' ? g : undefined;
}

/** Read `_meta.degraded` without collapsing "absent" into "false". */
export function metaDegraded(result: unknown): boolean | undefined {
  const meta = (result as { _meta?: Record<string, unknown> } | undefined)?._meta;
  if (!meta) return undefined;
  const d = meta.degraded;
  return typeof d === 'boolean' ? d : undefined;
}
