/**
 * Every endpoint behind the 2026-11-13 Pro gate refuses a signed-in FREE user with 402
 * pro_required (and M-Win answers reason:'pro_required'), BEFORE any data work runs.
 * The gate itself (requirePro / isProEmail) is mocked to "free"; its own logic is
 * covered by require-pro.unit.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/access/require-pro', async () => {
  const { NextResponse } = await import('next/server');
  const body = { success: false, error: 'pro_required', message: 'This is a Mindy Pro feature. Start your 14-day free trial.', upgrade_url: '/pricing' };
  const proRequiredResponse = () => NextResponse.json(body, { status: 402 });
  return {
    PRO_REQUIRED_BODY: body,
    proRequiredResponse,
    isProEmail: async () => false,
    requirePro: async () => ({ ok: false, status: 402, response: proRequiredResponse() }),
  };
});
vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: () => ({ ok: true, session: { valid: true, email: 'free@example.com' } }),
}));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async () => ({ authenticated: true }),
  getStaffRole: () => 'none',
}));
// Any data layer touched AFTER the gate would be a bug: make it loud.
vi.mock('@/lib/smart-profile/service', () => ({ getBriefingProfile: async () => { throw new Error('ran past the gate'); } }));
vi.mock('@/lib/bigquery/recipients', () => ({
  searchRecipients: async () => { throw new Error('ran past the gate'); },
  getSetAsidesForRecipients: async () => { throw new Error('ran past the gate'); },
  SET_ASIDE_BUCKET_LABEL: {},
}));

const URL_BASE = 'https://getmindy.ai';
const get = (path: string) => new NextRequest(URL_BASE + path, { headers: { 'x-mi-auth-token': 't' } });
const post = (path: string, body: unknown) =>
  new NextRequest(URL_BASE + path, { method: 'POST', headers: { 'x-mi-auth-token': 't', 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('Pro-gated endpoints refuse a signed-in free user', () => {
  it('M-Win (/api/app/win-probability) → reason pro_required, no score', async () => {
    const { GET } = await import('@/app/api/app/win-probability/route');
    const res = await GET(get('/api/app/win-probability?naics=541512'));
    const d = await res.json();
    expect(d.grounded).toBe(false);
    expect(d.reason).toBe('pro_required');
    expect(d.score).toBeUndefined();
  });

  it('Players (/api/app/contacts-map) → 402', async () => {
    const { GET } = await import('@/app/api/app/contacts-map/route');
    const res = await GET(get('/api/app/contacts-map?bbox=-90,30,-80,35&type=companies'));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('pro_required');
  });

  it('Players company drawer (/api/app/company-detail) → 402', async () => {
    const { GET } = await import('@/app/api/app/company-detail/route');
    const res = await GET(get('/api/app/company-detail?uei=ABC123DEF456'));
    expect(res.status).toBe(402);
  });

  it('Save to CRM: a company or buyer save → 402; an opportunity save is NOT gated', async () => {
    const { POST } = await import('@/app/api/opportunities/save/route');
    for (const source of ['company_map', 'buyer_map']) {
      const res = await POST(post('/api/opportunities/save', { email: 'free@example.com', noticeId: 'x', source }));
      expect(res.status, source).toBe(402);
    }
    const opp = await POST(post('/api/opportunities/save', { email: 'free@example.com', noticeId: 'x', source: 'recompete_map' }));
    expect(opp.status).not.toBe(402);
  });

  it('Proposal workspace draft (/api/app/proposal/draft) → 402', async () => {
    const { POST } = await import('@/app/api/app/proposal/draft/route');
    const res = await POST(post('/api/app/proposal/draft?email=free@example.com', { sectionType: 'technical_approach', text: 'x' }));
    expect(res.status).toBe(402);
  });
});
