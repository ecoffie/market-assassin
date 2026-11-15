import { describe, it, expect } from 'vitest';
import { loadActivationData, isExcludedAccount } from './load';

type Rows = Record<string, Record<string, unknown>[] | { error: { message: string; code?: string } }>;

/** Minimal read-only Supabase double: every builder method chains; range() resolves the table's rows once. */
function fakeDb(tables: Rows, users: { email: string; created_at: string; last_sign_in_at?: string | null }[]) {
  const writes: string[] = [];
  return {
    writes,
    db: {
      auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: page === 1 ? users : [] }, error: null }) } },
      from(table: string) {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'in', 'gte', 'eq', 'order']) b[m] = () => b;
        for (const m of ['insert', 'update', 'upsert', 'delete']) b[m] = () => { writes.push(table); return b; };
        b.range = async (from: number) => {
          const t = tables[table];
          if (t && !Array.isArray(t)) return { data: null, error: t.error };
          return { data: from === 0 ? (t ?? []) : [], error: null };
        };
        return b;
      },
    } as never,
  };
}

const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-10-01T00:00:00Z');
const user = { email: 'Customer@Acme.io', created_at: '2026-09-05T10:00:00Z', last_sign_in_at: '2026-09-05T10:00:00Z' };

describe('activation loader', () => {
  it('reads the Map event name from metadata.action and separates email events', async () => {
    const { db, writes } = fakeDb({
      user_engagement: [
        { user_email: 'customer@acme.io', event_type: 'tool_use', created_at: '2026-09-05T11:00:00Z', tool: null, action: 'listing_open' },
        { user_email: 'customer@acme.io', event_type: 'page_view', created_at: '2026-09-06T11:00:00Z', tool: null, action: null },
        { user_email: 'customer@acme.io', event_type: 'link_click', created_at: '2026-09-07T11:00:00Z' },
        { user_email: 'customer@acme.io', event_type: 'email_open', created_at: '2026-09-07T10:00:00Z' },
      ],
      card_chat_turns: [{ user_email: 'customer@acme.io', completed_at: '2026-09-06T12:00:00Z' }],
    }, [user]);
    const { accounts, cardChatAvailable } = await loadActivationData(db, { from: FROM, to: TO });
    expect(writes).toEqual([]);
    expect(cardChatAvailable).toBe(true);
    expect(accounts).toHaveLength(1);
    const a = accounts[0];
    expect(a.email).toBe('customer@acme.io');
    expect(a.appEvents).toEqual([
      { at: '2026-09-05T11:00:00Z', openedOpportunity: true },
      { at: '2026-09-06T11:00:00Z', openedOpportunity: false },
    ]);
    expect(a.emailClicks).toHaveLength(1);
    expect(a.emailOpens).toHaveLength(1);
    expect(a.cardAnswers).toEqual(['2026-09-06T12:00:00Z']);
  });

  it('a missing card_chat_turns table is unavailable (null), not zero', async () => {
    const { db } = fakeDb({ card_chat_turns: { error: { message: 'relation does not exist', code: '42P01' } } }, [user]);
    const { accounts, cardChatAvailable } = await loadActivationData(db, { from: FROM, to: TO });
    expect(cardChatAvailable).toBe(false);
    expect(accounts[0].cardAnswers).toBeNull();
  });

  it('any other read failure throws instead of reporting a smaller number', async () => {
    const { db } = fakeDb({ mcp_call_log: { error: { message: 'timeout' } } }, [user]);
    await expect(loadActivationData(db, { from: FROM, to: TO })).rejects.toThrow(/mcp_call_log: timeout/);
  });

  it('only accounts created inside the window, customers only', async () => {
    const { db } = fakeDb({}, [
      user,
      { email: 'old@acme.io', created_at: '2026-08-01T00:00:00Z' },
      { email: 'eric@govcongiants.com', created_at: '2026-09-05T00:00:00Z' },
      { email: 'card-chat-rollout-1@example.invalid', created_at: '2026-09-05T00:00:00Z' },
    ]);
    const { accounts } = await loadActivationData(db, { from: FROM, to: TO });
    expect(accounts.map((a) => a.email)).toEqual(['customer@acme.io']);
  });

  it('exclusions', () => {
    expect(isExcludedAccount('demo@getmindy.ai')).toBe(true);
    expect(isExcludedAccount('someone@govcongiants.com')).toBe(true);
    expect(isExcludedAccount('westover105@gmail.com')).toBe(true); // advocate
    expect(isExcludedAccount('x@example.com')).toBe(true);
    expect(isExcludedAccount('buyer@acme.io')).toBe(false);
  });
});
