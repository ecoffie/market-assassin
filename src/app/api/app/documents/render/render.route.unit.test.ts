/**
 * /api/app/documents/render — the real handler with auth, entitlement and the browser mocked.
 * Proves: auth and Pro gates, server-side validation, real DOCX bytes, PDF bytes, the explicit
 * (never silent) degrade, size limits, and that the route is write-free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_REPORT } from '@/lib/documents/__fixtures__/sample-report';

const state = vi.hoisted(() => ({
  authOk: true,
  pro: true,
  pdf: { pdf: Buffer.from('%PDF-1.7 rendered') as Buffer | null, error: null as string | null },
  proChecked: [] as string[],
}));

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: (_r: unknown, email: string) => state.authOk
    ? { ok: true, session: { email } }
    : { ok: false, response: new Response(JSON.stringify({ error: 'auth' }), { status: 401 }) },
}));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async (e: string) => { state.proChecked.push(e); return state.pro; } }));
vi.mock('@/lib/pdf/launch-browser', () => ({ htmlToPdf: async () => state.pdf }));

import { POST } from './route';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://getmindy.ai/api/app/documents/render', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const ok = (format: string, model: unknown = SAMPLE_REPORT) => req({ email: 'User@Example.com', format, model });

beforeEach(() => {
  state.authOk = true; state.pro = true; state.proChecked = [];
  state.pdf = { pdf: Buffer.from('%PDF-1.7 rendered'), error: null };
});

describe('POST /api/app/documents/render', () => {
  it('requires a signed session for the email', async () => {
    state.authOk = false;
    expect((await POST(ok('pdf'))).status).toBe(401);
  });

  it('requires Pro (same gate as Ask Mindy), checked for the session email', async () => {
    state.pro = false;
    const res = await POST(ok('docx'));
    expect(res.status).toBe(403);
    expect(state.proChecked).toEqual(['user@example.com']);
  });

  it('rejects an unknown format and bad JSON', async () => {
    expect((await POST(ok('exe'))).status).toBe(400);
    expect((await POST(req('{not json'))).status).toBe(400);
    expect((await POST(req({ format: 'pdf', model: SAMPLE_REPORT }))).status).toBe(400);
  });

  it('validates the model server-side (facts must cite) → 422 with issues', async () => {
    const bad = JSON.parse(JSON.stringify(SAMPLE_REPORT));
    bad.sections[0].blocks[0].cites = [];
    const res = await POST(ok('pdf', bad));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe('invalid_document');
    expect(JSON.stringify(j.issues)).toMatch(/a fact must cite/);
  });

  it('returns a real DOCX attachment', async () => {
    const res = await POST(ok('docx'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Federal-Janitorial-Services-Market-Research-Report-Fixture.docx"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });

  it('returns application/pdf when the browser renders', async () => {
    const res = await POST(ok('pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-export-degraded')).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('never silent: no browser → printable HTML with X-Export-Degraded headers', async () => {
    state.pdf = { pdf: null, error: 'Error: Could not find Chrome\n(ver. 1)' };
    const res = await POST(ok('pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('x-export-degraded')).toBe('pdf-unavailable');
    expect(res.headers.get('x-export-degraded-reason')).toBe('Error: Could not find Chrome (ver. 1)');
    expect(await res.text()).toContain('<!doctype html>');
  });

  it('refuses oversized bodies', async () => {
    expect((await POST(req({ email: 'a@b.c', format: 'pdf', model: { pad: 'x'.repeat(1_600_000) } }))).status).toBe(413);
    expect((await POST(req({ email: 'a@b.c', format: 'pdf', model: SAMPLE_REPORT }, { 'content-length': '9999999' }))).status).toBe(413);
  });

  it('is write-free: the route imports no database, storage or logging client', () => {
    const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
    expect(src).not.toMatch(/supabase|@vercel\/kv|logEngagement|recordLlmUsage|\.insert\(|\.upsert\(|\.storage\./);
  });

  it('is listed in next.config.ts outputFileTracingIncludes for the Chromium binary', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(cfg).toContain("'/api/app/documents/render/**/*': ['./node_modules/@sparticuz/chromium/bin/**/*']");
  });
});
