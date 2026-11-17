/**
 * /api/app/proposal/doc-download — ownership check for the stored copy.
 * The real handler with auth, workspace, pursuit access and Supabase mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'me@firm.com';
const DOC_ID = '11111111-2222-4333-8444-555555555555';
const PID = '99999999-2222-4333-8444-555555555555';

const state = vi.hoisted(() => ({
  doc: null as Record<string, unknown> | null,
  pursuitOk: false,
  pursuitCalls: [] as string[],
  signedFor: [] as string[],
  asClient: false,
}));

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true, session: { email: ME } }) }));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => (state.asClient ? { workspaceId: 'ws1', asClient: true } : { workspaceId: 'own', asClient: false }),
  clientNotificationEmail: (ws: string) => `${ws}@clients.getmindy.ai`,
}));
vi.mock('@/lib/proposal/pursuit-access', () => ({
  authorizePursuitRead: async (_sb: unknown, _r: unknown, _e: string, pid: string) => { state.pursuitCalls.push(pid); return state.pursuitOk ? { ok: true } : { ok: false, reason: 'not_found' }; },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: state.doc, error: null });
      return q;
    },
    storage: { from: () => ({ createSignedUrl: async (path: string) => { state.signedFor.push(path); return { data: { signedUrl: `https://signed/${path}` } }; } }) },
  }),
}));

import { NextRequest } from 'next/server';
import { GET } from './route';

const call = () => GET(new NextRequest(`https://getmindy.ai/api/app/proposal/doc-download?email=${ME}&doc_id=${DOC_ID}`));
const row = (over: Record<string, unknown>) => ({ id: DOC_ID, pipeline_id: PID, user_email: 'other@x.com', filename: 'f.pdf', storage_path: 'p/f.pdf', sam_url: null, doc_source: 'user_upload', ...over });

beforeEach(() => { state.doc = null; state.pursuitOk = false; state.pursuitCalls = []; state.signedFor = []; state.asClient = false; });

describe('doc-download ownership', () => {
  it('a row with an empty owner is never treated as owned: no signed URL', async () => {
    state.doc = row({ user_email: '' });
    const res = await call();
    expect(state.signedFor).toEqual([]);
    expect(res.status).toBe(404);
  });

  it('a caller without access gets only the public source URL, never the stored copy', async () => {
    state.doc = row({ sam_url: 'https://sam.gov/x', doc_source: 'sam_public' });
    const res = await call();
    expect(state.signedFor).toEqual([]);
    expect(await res.json()).toMatchObject({ success: true, url: 'https://sam.gov/x', source: 'sam' });
  });

  it('a private document the caller cannot read answers exactly like a missing one', async () => {
    state.doc = row({ sam_url: null });
    const denied = await call();
    state.doc = null;
    const missing = await call();
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.json()).toEqual(await missing.json());
  });

  it('a private document with a non-public URL is not exposed to a caller without access', async () => {
    state.doc = row({ sam_url: 'https://example.com/private', doc_source: 'user_upload' });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('the owner gets the signed stored copy', async () => {
    state.doc = row({ user_email: ME.toUpperCase() });
    const res = await call();
    expect(await res.json()).toMatchObject({ success: true, url: 'https://signed/p/f.pdf' });
  });

  it('Coach Mode: the active client owns its documents', async () => {
    state.asClient = true;
    state.doc = row({ user_email: 'ws1@clients.getmindy.ai' });
    expect((await (await call()).json()).url).toBe('https://signed/p/f.pdf');
  });

  it('a reader allowed by the shared pursuit rule (e.g. a workspace member) gets the stored copy', async () => {
    state.pursuitOk = true;
    state.doc = row({});
    const res = await call();
    expect(state.pursuitCalls).toEqual([PID]);
    expect((await res.json()).url).toBe('https://signed/p/f.pdf');
  });
});
