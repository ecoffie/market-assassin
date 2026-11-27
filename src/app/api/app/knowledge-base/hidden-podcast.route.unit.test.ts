/**
 * Knowledge Base: podcast insights are hidden from customers (Eric, 2026-11-27: "hide it"). Hidden, not deleted:
 * no list row, no filter pill, no type filter, and the single-document route answers 404 for one, even by id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { HIDDEN_KB_DOC_TYPES, isHiddenKbDoc } from '@/lib/knowledge-base/hidden-types';

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  doc: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));
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

describe('Knowledge Base hides podcast insights', () => {
  it('the list and the filter pills exclude the podcast type', async () => {
    const { GET } = await import('./route');
    await GET(new NextRequest('https://getmindy.ai/api/app/knowledge-base?email=pat@example.com'));
    const nots = h.calls.filter(([m]) => m === 'not').map(([, a]) => a);
    expect(nots.length).toBeGreaterThanOrEqual(2); // list query and facet query
    for (const a of nots) expect(String(a[2])).toContain('podcast_interview');
  });

  it('asking for the podcast type directly does not filter to it (it stays excluded)', async () => {
    const { GET } = await import('./route');
    await GET(new NextRequest('https://getmindy.ai/api/app/knowledge-base?email=pat@example.com&docType=podcast_interview'));
    expect(h.calls.some(([m, a]) => m === 'eq' && a[0] === 'doc_type' && a[1] === 'podcast_interview')).toBe(false);
  });

  it('no "Podcast Insights" label or podcast intro copy reaches the app', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/knowledge-base/route.ts'), 'utf8');
    expect(route).not.toContain("'Podcast Insights'");
    const panel = readFileSync(join(process.cwd(), 'src/components/app/panels/KnowledgeBasePanel.tsx'), 'utf8');
    expect(panel).not.toMatch(/podcast insights\. The documents/i);
    expect(panel).not.toMatch(/training, and podcast/i);
  });

  it('a podcast document cannot be opened by id (404), while other documents still open', async () => {
    const { GET } = await import('../rag-doc/route');
    const req = () => new NextRequest('https://getmindy.ai/api/app/rag-doc?email=pat@example.com&id=0b0b0b0b-1111-4222-8333-555555555555');
    h.doc = { id: '0b0b0b0b-1111-4222-8333-555555555555', title: 'Ep 900', doc_type: 'podcast_interview', source_path: 'libsyn:x.libsyn.com/ep-900', full_text: 'guest said', word_count: 2, one_line_summary: '' };
    expect((await GET(req())).status).toBe(404);
    h.doc = { ...h.doc, doc_type: 'misc' }; // a libsyn source is hidden whatever its type
    expect((await GET(req())).status).toBe(404);
    h.doc = { id: '0b0b0b0b-1111-4222-8333-555555555555', title: 'Proposal', doc_type: 'proposal_template', source_path: null, full_text: 'text', word_count: 1, one_line_summary: '' };
    expect((await GET(req())).status).toBe(200);
  });

  it('hidden, not deleted: the rule is a filter, and only podcast insights are hidden', () => {
    expect(HIDDEN_KB_DOC_TYPES).toEqual(['podcast_interview']);
    expect(isHiddenKbDoc({ doc_type: 'proposal_template' })).toBe(false);
    expect(isHiddenKbDoc({ doc_type: 'podcast_interview' })).toBe(true);
  });
});
