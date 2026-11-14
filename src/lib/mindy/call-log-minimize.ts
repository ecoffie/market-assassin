/**
 * Account deletion: minimize a user's tool-call log to a transaction record.
 *
 * Existing policy (privacy page, section 7): usage and billing records (tool-call logs, credit
 * ledger) are kept while the account is active; deleting the account removes activity records,
 * and "we may retain a minimal record of a transaction where tax, accounting, or legal obligations
 * require it". So mcp_call_log rows are NOT deleted (they back credit and invoice history); the
 * diagnostic fields added by the Ask Mindy execution trace are cleared:
 *   args_redacted, resource_ids, chat_session_id
 * Kept: tool_name, status, credits_charged, credit_price, channel, timestamps (the transaction).
 *
 * Counts come from `{ count: 'exact' }`, never from a capped RETURNING payload. A missing column
 * (migration not yet applied) means there is nothing to minimize, and is reported as such.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface MinimizeResult {
  table: 'mcp_call_log';
  rowsMinimized: number | null;
  skipped?: 'trace_columns_absent';
  error?: string;
}

export const CALL_LOG_DIAGNOSTIC_COLUMNS = ['args_redacted', 'resource_ids', 'chat_session_id'] as const;

export async function minimizeCallLogDiagnostics(db: Db, email: string): Promise<MinimizeResult> {
  const { error, count } = await db
    .from('mcp_call_log')
    .update({ args_redacted: null, resource_ids: null, chat_session_id: null }, { count: 'exact' })
    .eq('user_email', email.toLowerCase().trim());
  if (error) {
    if (/column .* does not exist|could not find the .* column/i.test(String(error.message))) {
      return { table: 'mcp_call_log', rowsMinimized: 0, skipped: 'trace_columns_absent' };
    }
    return { table: 'mcp_call_log', rowsMinimized: null, error: String(error.message) };
  }
  return { table: 'mcp_call_log', rowsMinimized: count ?? null };
}
