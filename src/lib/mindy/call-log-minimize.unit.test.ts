import { describe, it, expect, vi } from 'vitest';
import { minimizeCallLogDiagnostics } from './call-log-minimize';
import { USER_EMAIL_TABLES } from './user-scoped-tables';

function mockDb(result: { error: { message: string } | null; count: number | null }) {
  const eq = vi.fn(async () => result);
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { db: { from }, from, update, eq };
}

describe('account deletion and Ask Mindy records', () => {
  it('includes mindy_chat_sessions in the shared deletion / re-key list', () => {
    expect(USER_EMAIL_TABLES).toContain('mindy_chat_sessions');
  });

  it('clears only diagnostic fields on mcp_call_log, keeping the transaction record', async () => {
    const m = mockDb({ error: null, count: 7 });
    const r = await minimizeCallLogDiagnostics(m.db, ' User@X.com ');
    expect(m.from).toHaveBeenCalledWith('mcp_call_log');
    const [payload, opts] = m.update.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(payload).toEqual({ args_redacted: null, resource_ids: null, chat_session_id: null });
    expect(payload).not.toHaveProperty('credits_charged');
    expect(payload).not.toHaveProperty('tool_name');
    expect(opts).toEqual({ count: 'exact' });
    expect(m.eq).toHaveBeenCalledWith('user_email', 'user@x.com');
    expect(r).toEqual({ table: 'mcp_call_log', rowsMinimized: 7 });
  });

  it('reports a missing migration as nothing to minimize, not an error', async () => {
    const m = mockDb({ error: { message: 'column "args_redacted" of relation "mcp_call_log" does not exist' }, count: null });
    expect(await minimizeCallLogDiagnostics(m.db, 'u@x.com')).toEqual({ table: 'mcp_call_log', rowsMinimized: 0, skipped: 'trace_columns_absent' });
  });

  it('surfaces any other error and never turns an unknown count into zero', async () => {
    const m = mockDb({ error: { message: 'permission denied' }, count: null });
    expect(await minimizeCallLogDiagnostics(m.db, 'u@x.com')).toEqual({ table: 'mcp_call_log', rowsMinimized: null, error: 'permission denied' });
  });
});
