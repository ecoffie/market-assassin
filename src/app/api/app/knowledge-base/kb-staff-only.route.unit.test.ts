/**
 * Knowledge Base is staff only (Eric, 2026-11-27: "hide knowledge base"). Customers get 404 from both corpus routes
 * (the same answer as a route that does not exist) and see no panel, no "Browse sources" button and no clickable
 * corpus citation. Staff still browse it. Mindy's internal retrieval does not use these routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  doc: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: (_r: unknown, email?: string | null) => ({ ok: true, session: { valid: true, email } }) }));
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/access/chat-access', () => ({ canUseAskMindy: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements/shadow', () => ({ shadowEntitlement: vi.fn() }));
vi.mock('@/lib/supabase/paged-read', () => ({ fetchAllPaged: vi.fn(async (fn: () => unknown) => { await fn(); return [{ doc_type: 'proposal_template' }]; }) }));
vi.mock('@supabase/supabase-js', () => {
  const make = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'in', 'or', 'order', 'range', 'ilike']) q[m] = (...a: unknown[]) => { h.calls.push([m, a]); return q; };
    q.maybeSingle = async () => ({ data: h.doc, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
    return q;
  };
  return { createClient: () => ({ from: () => make() }) };
});

beforeEach(() => {
  h.calls.length = 0; h.doc = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
});


const DOC = { id: '0b0b0b0b-1111-4222-8333-555555555555', title: 'Volume I Technical', doc_type: 'technical_volume', source_path: null, full_text: 'proposal text', word_count: 2, one_line_summary: '', has_pii: false };
const kbReq = (email: string) => new NextRequest(`https://getmindy.ai/api/app/knowledge-base?email=${encodeURIComponent(email)}`);
const docReq = (email: string) => new NextRequest(`https://getmindy.ai/api/app/rag-doc?email=${encodeURIComponent(email)}&id=${DOC.id}`);

describe('Knowledge Base corpus routes are staff only', () => {
  it('a customer gets 404 from /api/app/knowledge-base, before any corpus query', async () => {
    const { GET } = await import('./route');
    const r = await GET(kbReq('customer@example.com'));
    expect(r.status).toBe(404);
    expect(h.calls.length).toBe(0);
  });

  it('a customer (even a paying one) gets 404 from /api/app/rag-doc, and no document text', async () => {
    h.doc = DOC;
    const { GET } = await import('../rag-doc/route');
    const r = await GET(docReq('customer@example.com'));
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain('proposal text');
  });

  it('staff still list and open corpus documents', async () => {
    const kb = await (await import('./route')).GET(kbReq('staff@govcongiants.com'));
    expect(kb.status).toBe(200);
    h.doc = DOC;
    const doc = await (await import('../rag-doc/route')).GET(docReq('staff@govcongiants.com'));
    expect(doc.status).toBe(200);
  });

  it('staff identity comes from the signed session only: a customer session with ?email=<staff> gets 404', async () => {
    const tfs = await import('@/lib/two-factor-session');
    const spy = vi.spyOn(tfs, 'requireMIAuthSession').mockReturnValue({ ok: true, session: { valid: true, email: 'customer@example.com' } } as never);
    const r = await (await import('./route')).GET(kbReq('staff@govcongiants.com'));
    expect(r.status).toBe(404);
    expect(h.calls.length).toBe(0);
    spy.mockReturnValue({ ok: true, session: { valid: true } } as never);
    expect((await (await import('./route')).GET(kbReq('staff@govcongiants.com'))).status).toBe(404);
    spy.mockRestore();
  });

  it('a has_pii document is never served, even to staff', async () => {
    h.doc = { ...DOC, has_pii: true };
    const r = await (await import('../rag-doc/route')).GET(docReq('staff@govcongiants.com'));
    expect(r.status).toBe(404);
  });

  it('the UI hides every entry point for customers: the panel falls back to chat; the Browse sources button and corpus citation links are staff-gated', async () => {
    const { canBrowseKnowledgeBase } = await import('@/lib/knowledge-base/access');
    expect(canBrowseKnowledgeBase('customer@example.com')).toBe(false);
    expect(canBrowseKnowledgeBase(null)).toBe(false);
    expect(canBrowseKnowledgeBase('staff@govcongiants.com')).toBe(true);
    const panels = readFileSync(join(process.cwd(), 'src/components/app/panels/index.tsx'), 'utf8');
    expect(panels).toMatch(/case 'knowledge-base':[\s\S]{0,200}canBrowseKnowledgeBase\(email\)[\s\S]{0,250}<MindyChatPanel/);
    const chat = readFileSync(join(process.cwd(), 'src/components/app/panels/MindyChatPanel.tsx'), 'utf8');
    expect(chat).toMatch(/onPanelChange && canBrowseKnowledgeBase\(email\) && \(\s*<button\s+onClick=\{\(\) => onPanelChange\('knowledge-base'\)\}/);
    expect(chat).toMatch(/target === 'kb' && c\.document_id && !canBrowseKnowledgeBase\(email\)/);
  });
});
