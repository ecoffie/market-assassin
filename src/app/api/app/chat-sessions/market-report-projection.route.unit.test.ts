/**
 * Reopening a saved conversation brings back its packaged market report (Claude Local, 2026-11-22: after
 * History → reopen, the Map had no report card, preview or Export, so the PDF download could not be reached).
 *
 * The chat route already stores { report_id, url, title, html: '' } in the turn trace. The sessions API now
 * projects ONLY the id and a bounded title, so the Map can re-open the hosted report. It never returns the url,
 * the html or any other part of the trace, and ignores a malformed id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'pro@example.com';
const S1 = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = 'Ej6xTestReportId0000a';

const state: { messages: Array<Record<string, unknown>> } = { messages: [] };

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: async (_r: unknown, email: string) => ({ authenticated: true, email }) }));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async () => true }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: () => {} }));

function builder(table: string) {
  const f: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (k: string, v: unknown) => { f[k] = v; return q; };
  q.in = () => q;
  q.limit = () => q;
  q.order = () => q;
  q.range = () => q;
  q.maybeSingle = async () => ({ data: table === 'mindy_chat_sessions' && f.id === S1 ? { id: S1, user_email: ME, title: 'Facilities' } : null, error: null });
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.messages.filter((m) => m.session_id === f.session_id), error: null }).then(res);
  return q;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function open() {
  vi.resetModules();
  const { GET } = await import('./route');
  const res = await GET({ nextUrl: new URL(`https://getmindy.ai/api/app/chat-sessions?email=${ME}&sessionId=${S1}`) } as never);
  return res.json();
}

const msg = (id: string, trace: unknown) => ({ id, session_id: S1, role: 'assistant', content: 'Here is your report.', created_at: id, trace });

describe('chat-sessions: a reopened conversation carries its market report id and title only', () => {
  it('projects { report_id, title } and nothing else from the trace', async () => {
    state.messages = [
      { id: '1', session_id: S1, role: 'user', content: 'Market report for facilities', created_at: '1', trace: null },
      msg('2', { market_report: { report_id: REPORT_ID, url: 'https://getmindy.ai/reports/x', title: 'Facilities maintenance', html: '<p>SECRET HTML</p>' }, tool_executions: [{ name: 'generate_market_report' }] }),
    ];
    const d = await open();
    expect(d.success).toBe(true);
    expect(d.messages[0].market_report).toBeUndefined();
    expect(d.messages[1].market_report).toEqual({ report_id: REPORT_ID, title: 'Facilities maintenance' });
    const raw = JSON.stringify(d);
    expect(raw).not.toContain('SECRET HTML');
    expect(raw).not.toContain('reports/x'); // the stored url is never returned; the Map builds /reports/<id>
    expect(raw).not.toContain('tool_executions');
    expect(raw).not.toContain('"trace"');
  });

  it('a malformed or missing id projects nothing; a long title is bounded', async () => {
    state.messages = [
      msg('1', { market_report: { report_id: '../admin', title: 'x' } }),
      msg('2', { market_report: { report_id: 42, title: 'x' } }),
      msg('3', { market_report: { report_id: null, url: null, title: 'not saved', html: '' } }),
      msg('4', { market_report: { report_id: REPORT_ID, title: 'T'.repeat(500) } }),
      msg('5', { market_report: { report_id: REPORT_ID } }),
    ];
    const d = await open();
    expect(d.messages.slice(0, 3).map((m: Record<string, unknown>) => m.market_report)).toEqual([undefined, undefined, undefined]);
    expect(d.messages[3].market_report.title).toHaveLength(160);
    expect(d.messages[4].market_report).toEqual({ report_id: REPORT_ID, title: '' });
  });

  it('Vault deliverables are projected exactly as before, alongside a report', async () => {
    const DOC = '33333333-3333-4333-8333-333333333333';
    state.messages = [msg('1', { deliverables: { files: [{ format: 'pdf', document_id: DOC, file_name: 'R.pdf', version: 1 }] }, market_report: { report_id: REPORT_ID, title: 'R' } })];
    const d = await open();
    expect(d.messages[0].deliverables).toEqual({ files: [{ format: 'pdf', document_id: DOC, file_name: 'R.pdf', version: 1 }] });
    expect(d.messages[0].market_report).toEqual({ report_id: REPORT_ID, title: 'R' });
  });

  it('a research-mode beta answer carries its tag label only; standard answers and user rows carry none', async () => {
    state.messages = [
      { id: '1', session_id: S1, role: 'user', content: 'Assess Ridgeline', created_at: '1', trace: { engine: 'research_mode', beta: true, label: 'Research · Beta' } },
      msg('2', { engine: 'research_mode', beta: true, label: 'Research · Beta', model: 'secret-model', calls: [{ tool: 'find_opportunities', args: { q: 'SECRET ARGS' } }] }),
      msg('3', { engine: 'standard' }),
      msg('4', null),
    ];
    const d = await open();
    expect(d.messages.map((m: Record<string, unknown>) => m.research_mode)).toEqual([undefined, { label: 'Research · Beta' }, undefined, undefined]);
    const raw = JSON.stringify(d);
    expect(raw).not.toContain('secret-model');
    expect(raw).not.toContain('SECRET ARGS');
  });
});
