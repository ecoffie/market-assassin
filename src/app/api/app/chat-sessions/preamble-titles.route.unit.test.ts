/**
 * Conversation history titles for Map conversations: older rows were titled with the first 60 characters
 * of the stored message (the Map view preamble). The sessions API re-titles them from the customer's first
 * question at read time and leaves message content exactly as stored (the model still needs the preamble).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const VIEW = '[Current map view — 12 Open Now opps in view; in VA. Location: the map is filtered to VA. Answer for THIS view.]\n\n';
const OLD_TITLE = (VIEW + 'x').slice(0, 60).replace(/\s+/g, ' ').trim();
const ME = 'pro@example.com';
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';

const state: { sessions: Array<Record<string, unknown>>; messages: Array<Record<string, unknown>>; repairError: boolean; inCalls: unknown[][]; ranges: number[][] } = {
  sessions: [], messages: [], repairError: false, inCalls: [], ranges: [],
};

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));

function builder(table: string) {
  const f: Record<string, unknown> = {};
  let inIds: string[] | null = null;
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (k: string, v: unknown) => { f[k] = v; return q; };
  q.in = (k: string, v: string[]) => { inIds = v; state.inCalls.push([table, k, v]); return q; };
  q.limit = () => q;
  q.order = () => q;
  q.range = (a: number, b: number) => { state.ranges.push([a, b]); f.__range = [a, b]; return q; };
  q.maybeSingle = async () => ({ data: state.sessions.find((s) => s.id === f.id) ?? null, error: null });
  q.then = (res: (v: unknown) => unknown) => {
    if (table === 'mindy_chat_sessions') return Promise.resolve({ data: state.sessions, error: null }).then(res);
    if (inIds) {
      if (state.repairError) return Promise.resolve({ data: null, error: { message: 'down' } }).then(res);
      const all = state.messages.filter((m) => inIds!.includes(String(m.session_id)) && m.role === 'user');
      const [a, b] = (f.__range as number[]) ?? [0, all.length - 1];
      return Promise.resolve({ data: all.slice(a, b + 1), error: null }).then(res);
    }
    const rows = state.messages.filter((m) => m.session_id === f.session_id);
    return Promise.resolve({ data: rows, error: null }).then(res);
  };
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.repairError = false; state.inCalls = []; state.ranges = [];
  state.sessions = [
    { id: S1, user_email: ME, title: OLD_TITLE, message_count: 4, updated_at: '2026-11-17T10:00:00Z' },
    { id: S2, user_email: ME, title: 'What is the 8(a) program?', message_count: 2, updated_at: '2026-11-16T10:00:00Z' },
    { id: S3, user_email: ME, title: OLD_TITLE, message_count: 2, updated_at: '2026-11-15T10:00:00Z' },
  ];
  state.messages = [
    { id: 'a', session_id: S1, role: 'user', content: VIEW + 'Who buys janitorial work here?', created_at: '1' },
    { id: 'b', session_id: S1, role: 'assistant', content: 'The Army.', created_at: '2' },
    { id: 'c', session_id: S1, role: 'user', content: VIEW + 'And in MD?', created_at: '3' },
    { id: 'd', session_id: S3, role: 'user', content: VIEW, created_at: '1' },
  ];
});

async function get(qs: string) {
  vi.resetModules();
  const { GET } = await import('./route');
  const req = { nextUrl: new URL(`https://getmindy.ai/api/app/chat-sessions?${qs}`) };
  const res = await GET(req as never);
  return res.json();
}

describe('chat-sessions: Map view preamble titles', () => {
  it('re-titles old Map conversations from the first typed question; others are untouched', async () => {
    const d = await get(`email=${ME}`);
    const t = Object.fromEntries(d.sessions.map((s: { id: string; title: string | null }) => [s.id, s.title]));
    expect(t[S1]).toBe('Who buys janitorial work here?');
    expect(t[S2]).toBe('What is the 8(a) program?');
    expect(t[S3]).toBeNull();
    expect(JSON.stringify(d.sessions)).not.toContain('Current map view');
    expect(state.inCalls).toEqual([['mindy_chat_messages', 'session_id', [S1, S3]]]);
  });
  it('pages past the 1,000-row cap when an earlier conversation has many user turns', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, session_id: S1, role: 'user', content: VIEW + `q${i}`, created_at: String(i) }));
    state.messages = [...many, { id: 'z', session_id: S3, role: 'user', content: VIEW + 'Late question', created_at: '9999' }];
    const d = await get(`email=${ME}`);
    const t = Object.fromEntries(d.sessions.map((s: { id: string; title: string | null }) => [s.id, s.title]));
    expect(t[S1]).toBe('q0');
    expect(t[S3]).toBe('Late question');
    expect(state.ranges).toEqual([[0, 999], [1000, 1999]]);
  });
  it('makes no extra query when no title needs repair', async () => {
    state.sessions = [state.sessions[1]];
    await get(`email=${ME}`);
    expect(state.inCalls).toEqual([]);
  });
  it('a failed repair lookup shows no title, never the preamble', async () => {
    state.repairError = true;
    const d = await get(`email=${ME}`);
    expect(JSON.stringify(d.sessions)).not.toContain('Current map view');
    expect(d.sessions.find((s: { id: string }) => s.id === S2).title).toBe('What is the 8(a) program?');
  });
  it('loading one conversation repairs its title and returns message content exactly as stored', async () => {
    const d = await get(`email=${ME}&sessionId=${S1}`);
    expect(d.session.title).toBe('Who buys janitorial work here?');
    expect(d.messages[0].content).toBe(VIEW + 'Who buys janitorial work here?');
  });

  it('projects create_document deliverables from trace and never returns the rest of the trace', async () => {
    const files = [
      { format: 'pdf', document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', file_name: 'Brief.pdf', version: 1 },
      { format: 'docx', document_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', file_name: 'Brief.docx', version: 1 },
    ];
    state.messages = [
      { id: 'a', session_id: S1, role: 'user', content: 'Make a PDF', created_at: '1' },
      {
        id: 'b', session_id: S1, role: 'assistant', content: 'Ready.', created_at: '2',
        trace: {
          planner: { provider: 'openai', model: 'gpt-4o' },
          tools_offered: 1,
          tool_executions: [{ tool: 'create_document', status: 'ok' }],
          deliverables: { files, pdf_note: 'Open in Preview' },
        },
      },
    ];
    const d = await get(`email=${ME}&sessionId=${S1}`);
    expect(d.messages[1].deliverables).toEqual({ files, pdf_note: 'Open in Preview' });
    expect(JSON.stringify(d.messages)).not.toContain('tools_offered');
    expect(JSON.stringify(d.messages)).not.toContain('"trace"');
    expect(JSON.stringify(d.messages)).not.toContain('gpt-4o');
  });
});
