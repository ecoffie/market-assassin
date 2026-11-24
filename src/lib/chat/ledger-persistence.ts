/**
 * Persisting the signed source ledger with each assistant turn (Agent 4 design approval, 2026-11-22; no migration).
 *
 * Why: a reopened conversation used to lose its ledger (the client keeps it only in memory), so "#12" references and
 * the contract-identity routing (#2303) stopped working after a reopen. The ledger is stored in the EXISTING
 * mindy_chat_messages.trace jsonb column (20261114_ask_mindy_execution_trace; RLS, service role only) as
 * trace.ledger, and /api/app/chat-sessions returns it as `sources` for the owner's assistant messages.
 *
 * What is stored is exactly the SourceLedger the turn already sends the client in its `sources` event: ids, kinds,
 * tool names, short labels, statuses, dates, shown/total, code-only query args (free text is stripped when each
 * source is built) and record keys, HMAC-signed. No tool result bodies and no arguments. Retention is the
 * conversation's: messages cascade-delete with their session. On read-back the route verifies the signature and
 * drops private entries from another acting scope (parseLedger), exactly as for a client-held ledger.
 *
 * Gated under ASK_MINDY_RECIPES (default off) for now.
 */
import type { SourceLedger } from './context-sources';

/** Hard cap on the serialized ledger stored per assistant turn. Larger ledgers are not stored (a notice says so). */
export const LEDGER_PERSIST_MAX_BYTES = 16 * 1024;

export type LedgerForTrace = { ledger: SourceLedger } | { notice: string };

/** The ledger to store on the assistant row's trace, or a notice saying why it was not stored. */
export function ledgerForTrace(ledger: SourceLedger | null | undefined): LedgerForTrace {
  if (!ledger || !Array.isArray(ledger.entries) || ledger.entries.length === 0) return { notice: 'ledger_not_persisted:empty' };
  const bytes = Buffer.byteLength(JSON.stringify(ledger), 'utf8');
  if (bytes > LEDGER_PERSIST_MAX_BYTES) return { notice: `ledger_not_persisted:too_large:${bytes}` };
  return { ledger };
}

/** The stored ledger from a message's trace (unverified: the chat route verifies the signature when it is re-sent). */
export function ledgerFromTrace(trace: unknown): SourceLedger | null {
  if (!trace || typeof trace !== 'object') return null;
  const l = (trace as { ledger?: unknown }).ledger;
  if (!l || typeof l !== 'object' || !Array.isArray((l as { entries?: unknown }).entries)) return null;
  return l as SourceLedger;
}
