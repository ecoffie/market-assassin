/**
 * MCP tool: lookup_solicitation — historical / known-id solicitation lookup.
 *
 * Closed ≠ gone. Not FIND. Credits: 5 (scan-class, local DB, no external API).
 * Session identity is taken from MCP context, never from a user-supplied email arg.
 */
import {
  lookupSolicitation,
  type LookupSolicitationResult,
} from '@/lib/sam/lookup-solicitation';

export type { LookupSolicitationResult };

export interface LookupSolicitationToolInput {
  query: string;
  confirm_notice_id?: string;
}

export async function lookupSolicitationTool(
  input: LookupSolicitationToolInput,
  ctx?: { userEmail?: string | null },
): Promise<LookupSolicitationResult> {
  return lookupSolicitation({
    query: String(input.query || ''),
    confirm_notice_id: input.confirm_notice_id,
    userEmail: ctx?.userEmail ?? null,
  });
}
