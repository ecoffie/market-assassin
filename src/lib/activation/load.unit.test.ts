import { describe, it, expect } from 'vitest';
import { loadActivationData, isExcludedAccount, isEmailClick, isSuccessfulMainChatAnswer, OPEN_OPPORTUNITY_TOOLS } from './load';

type Row = Record<string, unknown>;
type Rows = Record<string, Row[] | { error: { message: string; code?: string } }>;

/**
 * Read-only Supabase double that HONOURS what the loader asks for: select() projects only the listed columns
 * (aliases like `kind:metadata->>kind` read metadata.kind as text), and in()/eq()/gte() filter rows. A selected
 * column the table does not have returns PostgREST's 42703, so a loader that reads a column it never selected,
 * or forgets a filter, fails here instead of in production.
 */
function fakeDb(tables: Rows, users: { email: string; created_at: string; last_sign_in_at?: string | null }[]) {
  const writes: string[] = [];
  return {
    writes,
    db: {
      auth: { admin: { listUsers: async ({ page }: { page: number }) => ({ data: { users: page === 1 ? users : [] }, error: null }) } },
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let cols: { out: string; read: (r: Row) => unknown; base: string }[] = [];
        const b: Record<string, unknown> = {};
        b.select = (spec: string) => {
          cols = spec.split(',').map((c) => c.trim()).map((c) => {
            const i = c.indexOf(':');
            const alias = i >= 0 ? c.slice(0, i) : c;
            const expr = i >= 0 ? c.slice(i + 1) : c;
            const m = expr.match(/^(\w+)->>?(\w+)$/);
            if (m) {
              const asText = expr.includes('->>');
              return { out: alias, base: m[1], read: (r: Row) => { const v = (r[m[1]] as Row | undefined)?.[m[2]]; return v === undefined || v === null ? null : asText ? String(v) : v; } };
            }
            return { out: alias, base: expr, read: (r: Row) => r[expr] };
          });
          return b;
        };
        b.in = (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return b; };
        b.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; };
        b.gte = (col: string, val: string) => { filters.push((r) => String(r[col]) >= val); return b; };
        b.order = () => b;
        for (const m of ['insert', 'update', 'upsert', 'delete']) b[m] = () => { writes.push(table); return b; };
        b.range = async (from: number) => {
          const t = tables[table];
          if (t && !Array.isArray(t)) return { data: null, error: t.error };
          const rows = (t ?? []).filter((r) => filters.every((f) => f(r)));
          const missing = rows.length ? cols.find((c) => !(c.base in rows[0])) : undefined;
          if (missing) return { data: null, error: { message: `column ${table}.${missing.base} does not exist`, code: '42703' } };
          const out = rows.map((r) => Object.fromEntries(cols.map((c) => [c.out, c.read(r)])));
          return { data: from === 0 ? out : [], error: null };
        };
        return b;
      },
    } as never,
  };
}

const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-10-01T00:00:00Z');
const E = 'customer@acme.io';
const user = { email: 'Customer@Acme.io', created_at: '2026-09-05T10:00:00Z', last_sign_in_at: '2026-09-05T10:00:00Z' };
const ev = (event_type: string, created_at: string, extra: Row = {}, metadata: Row = {}): Row =>
  ({ id: created_at, user_email: E, event_type, event_source: null, created_at, metadata, ...extra });

describe('activation loader', () => {
  it('reads the Map event name from metadata.action, card events from metadata.kind, and separates email events', async () => {
    const { db, writes } = fakeDb({
      user_engagement: [
        ev('tool_use', '2026-09-05T11:00:00Z', { event_source: 'opportunity_map' }, { action: 'listing_open' }),
        ev('page_view', '2026-09-06T11:00:00Z'),
        ev('link_click', '2026-09-07T11:00:00Z', { event_source: 'daily_alert' }, { url: 'x' }),
        ev('email_open', '2026-09-07T10:00:00Z', { event_source: 'daily_alert' }),
        ev('tool_use', '2026-09-08T11:00:00Z', { event_source: 'source_feed' }, { kind: 'popup_open' }),
        ev('tool_use', '2026-09-08T12:00:00Z', { event_source: 'source_feed' }, { kind: 'impression' }),
        ev('tool_use', '2026-09-08T13:00:00Z', { event_source: 'opportunity_map' }, { action: 'pin_clicked' }),
        ev('tool_use', '2026-09-08T14:00:00Z', { event_source: 'opportunity_map' }, { action: 'office_viewed' }),
        { ...ev('page_view', '2026-09-08T15:00:00Z'), user_email: 'someone-else@acme.io' },
      ],
      card_chat_turns: [{ turn_id: 't1', user_email: E, status: 'completed', completed_at: '2026-09-06T12:00:00Z' }],
    }, [user]);
    const { accounts, cardChatAvailable } = await loadActivationData(db, { from: FROM, to: TO });
    expect(writes).toEqual([]);
    expect(cardChatAvailable).toBe(true);
    expect(accounts).toHaveLength(1);
    const a = accounts[0];
    expect(a.email).toBe(E);
    expect(a.appEvents.map((e) => e.openedOpportunity)).toEqual([true, false, true, false, false, false]);
    expect(a.emailClicks).toEqual(['2026-09-07T11:00:00Z']);
    expect(a.emailOpens).toHaveLength(1);
    expect(a.cardAnswers).toEqual(['2026-09-06T12:00:00Z']);
  });

  it('in-app link clicks are app activity, not email clicks', async () => {
    const { db } = fakeDb({
      user_engagement: [
        ev('link_click', '2026-09-06T11:00:00Z', { event_source: 'sidebar' }, { action: 'open_map' }),
        ev('link_click', '2026-09-06T12:00:00Z', { event_source: 'market_intel_dashboard' }),
        ev('link_click', '2026-09-06T13:00:00Z', { event_source: 'source_feed' }, { kind: 'click' }),
        ev('link_click', '2026-09-06T14:00:00Z', { event_source: 'opportunity_map' }, { action: 'proposal_started' }),
        ev('link_click', '2026-09-06T15:00:00Z', { event_source: 'daily_alerts' }), // in-app Alerts panel
        ev('link_click', '2026-09-06T16:00:00Z', { event_source: 'weekly_deep_dive' }),
      ],
    }, [user]);
    const [a] = (await loadActivationData(db, { from: FROM, to: TO })).accounts;
    expect(a.emailClicks).toEqual(['2026-09-06T16:00:00Z']);
    expect(a.appEvents).toHaveLength(5);
    expect(a.appEvents.find((e) => e.at === '2026-09-06T13:00:00Z')?.openedOpportunity).toBe(true); // card click
  });

  it('in-app Ask Mindy tool calls (channel app_chat) are app activity, not MCP use; chatgpt vs claude split', async () => {
    const { db } = fakeDb({
      mcp_call_log: [
        { id: 1, user_email: E, created_at: '2026-09-06T10:00:00Z', status: 'success', channel: 'app_chat' },
        { id: 2, user_email: E, created_at: '2026-09-06T11:00:00Z', status: 'success', channel: 'chatgpt' },
        { id: 3, user_email: E, created_at: '2026-09-06T12:00:00Z', status: 'rejected_no_credits', channel: null },
        { id: 4, user_email: E, created_at: '2026-09-06T13:00:00Z', status: 'tool_error', channel: 'app_chat' },
      ],
    }, [user]);
    const [a] = (await loadActivationData(db, { from: FROM, to: TO })).accounts;
    expect(a.appEvents).toEqual([{ at: '2026-09-06T10:00:00Z', openedOpportunity: false }]);
    expect(a.mcpCalls).toEqual([
      { at: '2026-09-06T11:00:00Z', ok: true, rejectedNoCredits: false, channel: 'chatgpt' },
      { at: '2026-09-06T12:00:00Z', ok: false, rejectedNoCredits: true, channel: 'claude' },
    ]);
  });

  it('bulk base44 imports are not user tracking; engagement track events are a durable backup', async () => {
    const { db } = fakeDb({
      user_pipeline: [
        { id: 1, user_email: E, created_at: '2026-09-05T12:00:00Z', source: 'manual' },
        { id: 2, user_email: E, created_at: '2026-09-05T10:00:01Z', source: 'base44_import' },
      ],
      user_engagement: [ev('tool_use', '2026-09-06T09:00:00Z', { event_source: 'opportunity_map' }, { action: 'pursuit_started' })],
    }, [user]);
    const r = await loadActivationData(db, { from: FROM, to: TO });
    expect(r.accounts[0].tracked).toEqual(['2026-09-05T12:00:00Z']);
    expect(r.accounts[0].trackedEvents).toEqual(['2026-09-06T09:00:00Z']);
    expect(r.bulkPipelineRowsSkipped).toBe(1);
  });

  it('map_search with a result count is a measured search; older searches without one are ignored', async () => {
    const { db } = fakeDb({
      user_engagement: [
        ev('tool_use', '2026-09-05T11:00:00Z', { event_source: 'opportunity_map' }, { action: 'map_search', query: 'roofing' }),
        ev('tool_use', '2026-09-06T11:00:00Z', { event_source: 'opportunity_map' }, { action: 'map_search', via: 'intent', results: 12 }),
        ev('tool_use', '2026-09-07T11:00:00Z', { event_source: 'opportunity_map' }, { action: 'map_search', via: 'keyword', results: null }),
      ],
    }, [user]);
    const r = await loadActivationData(db, { from: FROM, to: TO });
    expect(r.accounts[0].searches).toEqual([{ at: '2026-09-06T11:00:00Z', results: 12 }, { at: '2026-09-07T11:00:00Z', results: null }]);
    expect(r.searchMeasuredSince).toBe('2026-09-06T11:00:00Z');
  });

  it('main Ask Mindy: counts traced, complete answers; untraced is unknown; card turns are not double counted', async () => {
    const ok = { answer: { finish_reason: 'stop' }, notices: [] };
    const { db } = fakeDb({
      mindy_chat_sessions: [{ id: 's1', user_email: E, updated_at: '2026-09-07T00:00:00Z' }],
      mindy_chat_messages: [
        { id: 'm1', session_id: 's1', role: 'assistant', created_at: '2026-09-06T10:00:00Z', content: 'Answer', trace: ok },
        { id: 'm2', session_id: 's1', role: 'user', created_at: '2026-09-06T10:00:00Z', content: 'Q', trace: ok },
        { id: 'm3', session_id: 's1', role: 'assistant', created_at: '2026-09-06T11:00:00Z', content: 'Cut', trace: { answer: { finish_reason: 'length' }, notices: ['truncated'] } },
        { id: 'm4', session_id: 's1', role: 'assistant', created_at: '2026-09-06T12:00:00Z', content: 'Old', trace: null },
        { id: 'm5', session_id: 's1', role: 'assistant', created_at: '2026-09-06T13:00:00Z', content: 'Card', trace: { ...ok, context: { kind: 'opportunity' } } },
      ],
    }, [user]);
    const r = await loadActivationData(db, { from: FROM, to: TO });
    expect(r.mainChatAvailable).toBe(true);
    expect(r.accounts[0].mainChatAnswers).toEqual(['2026-09-06T10:00:00Z']);
    expect(r.mainChatUntraced).toBe(1);
  });

  it('a missing trace column makes main chat unavailable (null), not zero', async () => {
    const { db } = fakeDb({
      mindy_chat_sessions: [{ id: 's1', user_email: E, updated_at: '2026-09-07T00:00:00Z' }],
      mindy_chat_messages: [{ id: 'm1', session_id: 's1', role: 'assistant', created_at: '2026-09-06T10:00:00Z', content: 'A' }],
    }, [user]);
    const r = await loadActivationData(db, { from: FROM, to: TO });
    expect(r.mainChatAvailable).toBe(false);
    expect(r.accounts[0].mainChatAnswers).toBeNull();
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
    expect(accounts.map((a) => a.email)).toEqual([E]);
  });

  it('exclusions', () => {
    expect(isExcludedAccount('demo@getmindy.ai')).toBe(true);
    expect(isExcludedAccount('someone@govcongiants.com')).toBe(true);
    expect(isExcludedAccount('westover105@gmail.com')).toBe(true); // advocate
    expect(isExcludedAccount('x@example.com')).toBe(true);
    expect(isExcludedAccount('buyer@acme.io')).toBe(false);
  });

  it('classifiers', () => {
    expect(isEmailClick('link_click', 'daily_alert')).toBe(true);
    expect(isEmailClick('link_click', 'daily_alerts')).toBe(false);
    expect(isEmailClick('link_click', null)).toBe(false);
    expect(isEmailClick('tool_use', 'daily_alert')).toBe(false);
    expect(OPEN_OPPORTUNITY_TOOLS.has('pin_clicked')).toBe(false);
    expect(OPEN_OPPORTUNITY_TOOLS.has('office_viewed')).toBe(false);
    expect(isSuccessfulMainChatAnswer({ content: '  ', trace: { answer: { finish_reason: 'stop' } } })).toBe(false);
    expect(isSuccessfulMainChatAnswer({ content: 'x', trace: { answer: { finish_reason: 'stop' }, notices: ['tools_unavailable'] } })).toBe(false);
    expect(isSuccessfulMainChatAnswer({ content: 'x', trace: { answer: null, notices: [] } })).toBe(false);
    expect(isSuccessfulMainChatAnswer({ content: 'x', trace: null })).toBeNull();
  });
});
