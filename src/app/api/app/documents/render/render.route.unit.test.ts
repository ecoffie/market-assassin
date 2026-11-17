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
  rl: { allowed: true, resetAt: 0 },
  rlKeys: [] as Array<{ key: string; limit: number; window: number }>,
}));

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: (_r: unknown, email: string) => state.authOk
    ? { ok: true, session: { email } }
    : { ok: false, response: new Response(JSON.stringify({ error: 'auth' }), { status: 401 }) },
}));
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: async (e: string) => { state.proChecked.push(e); return state.pro; } }));
vi.mock('@/lib/pdf/launch-browser', () => ({ htmlToPdf: async () => state.pdf }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, window: number) => {
    state.rlKeys.push({ key, limit, window });
    return { allowed: state.rl.allowed, remaining: 0, limit, resetAt: state.rl.resetAt };
  },
}));

import { POST, __resetLocalRenderLimit } from './route';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://getmindy.ai/api/app/documents/render', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const ok = (format: string, model: unknown = SAMPLE_REPORT) => req({ email: 'User@Example.com', format, model });

beforeEach(() => {
  state.authOk = true; state.pro = true; state.proChecked = [];
  state.rl = { allowed: true, resetAt: Math.floor(Date.now() / 1000) + 300 }; state.rlKeys = [];
  __resetLocalRenderLimit();
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

  it('the inline degraded HTML carries a no-script, no-network CSP and nosniff', async () => {
    state.pdf = { pdf: null, error: 'no browser' };
    const res = await POST(ok('pdf'));
    expect(res.headers.get('x-export-degraded')).toBe('pdf-unavailable');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses oversized bodies', async () => {
    expect((await POST(req({ email: 'a@b.c', format: 'pdf', model: { pad: 'x'.repeat(1_600_000) } }))).status).toBe(413);
    expect((await POST(req({ email: 'a@b.c', format: 'pdf', model: SAMPLE_REPORT }, { 'content-length': '9999999' }))).status).toBe(413);
  });

  it('rate-limits per verified account and format: PDF 10 / DOCX 30 per 10 minutes', async () => {
    await POST(ok('pdf'));
    await POST(ok('docx'));
    expect(state.rlKeys).toEqual([
      { key: 'docrender:pdf:user@example.com', limit: 10, window: 600 },
      { key: 'docrender:docx:user@example.com', limit: 30, window: 600 },
    ]);
  });

  it('over the limit: 429 with Retry-After, and Chromium is never started', async () => {
    state.rl = { allowed: false, resetAt: Math.floor(Date.now() / 1000) + 120 };
    let rendered = false;
    state.pdf = { get pdf() { rendered = true; return Buffer.from('%PDF'); }, error: null } as never;
    const res = await POST(ok('pdf'));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe('rate_limited');
    expect(rendered).toBe(false);
  });

  it('KV down (limiter allows) → the per-instance backstop still caps PDFs at 10 per window', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await POST(ok('pdf'))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('auth and Pro are checked BEFORE the limiter (an anonymous caller cannot burn a user\'s quota)', async () => {
    state.authOk = false;
    await POST(ok('pdf'));
    expect(state.rlKeys).toEqual([]);
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
