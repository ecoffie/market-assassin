/**
 * The twelve-month ambassador term job (owner, 2026-11-16: "end at 12").
 * Day 335 → one notice email; day 365 → revoke Pro + mark `ended`; a failed revoke retries tomorrow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rows: Array<Record<string, unknown>> = [];
vi.mock('@/lib/ambassadors/store', async () => {
  const real = await vi.importActual<typeof import('@/lib/ambassadors/store')>('@/lib/ambassadors/store');
  return {
    termStatus: real.termStatus,
    listAmbassadors: vi.fn(async () => rows),
    setDecision: vi.fn(async () => ({})),
    markTermNoticeSent: vi.fn(async () => undefined),
  };
});
vi.mock('@/lib/ambassadors/emails', () => ({ sendTermEndingEmail: vi.fn(async () => true) }));
vi.mock('@/lib/admin/member-grants', () => ({ applyMemberGrant: vi.fn(async () => ({ success: true })) }));

process.env.CRON_SECRET = 'secret';
const { GET } = await import('./route');
const store = await import('@/lib/ambassadors/store');
const emails = await import('@/lib/ambassadors/emails');
const grants = await import('@/lib/admin/member-grants');

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000 - 60_000).toISOString();
const row = (email: string, days: number, extra: Record<string, unknown> = {}) => ({ email, name: 'Ann Lee', status: 'approved', decided_at: daysAgo(days), term_notice_sent_at: null, ...extra });
const call = (q = '') => GET(new NextRequest(`https://x.test/api/cron/ambassador-terms${q}`, { headers: { authorization: 'Bearer secret' } }));

beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe('ambassador-terms cron', () => {
  it('refuses an unauthenticated call', async () => {
    const res = await GET(new NextRequest('https://x.test/api/cron/ambassador-terms'));
    expect(res.status).toBe(401);
  });

  it('does nothing before day 335', async () => {
    rows.push(row('a@x.com', 100));
    const res = await call();
    expect(res.status).toBe(200);
    expect(vi.mocked(emails.sendTermEndingEmail)).not.toHaveBeenCalled();
    expect(vi.mocked(grants.applyMemberGrant)).not.toHaveBeenCalled();
  });

  it('sends the notice once at day 335, never twice', async () => {
    rows.push(row('a@x.com', 340), row('b@x.com', 340, { term_notice_sent_at: daysAgo(5) }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(vi.mocked(emails.sendTermEndingEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(store.markTermNoticeSent)).toHaveBeenCalledWith('a@x.com');
  });

  it('at day 365 revokes Pro and marks the row ended', async () => {
    rows.push(row('a@x.com', 366));
    const res = await call();
    expect(res.status).toBe(200);
    expect(vi.mocked(grants.applyMemberGrant).mock.calls[0][0]).toMatchObject({ targetEmail: 'a@x.com', tier: 'pro', action: 'revoke' });
    expect(vi.mocked(store.setDecision)).toHaveBeenCalledWith('a@x.com', 'ended', 'ambassador-term-job', 'Twelve-month term ended');
  });

  it('a failed revoke leaves the row approved (retried tomorrow) and returns 500', async () => {
    rows.push(row('a@x.com', 366));
    vi.mocked(grants.applyMemberGrant).mockResolvedValueOnce({ success: false, error: 'boom' } as never);
    const res = await call();
    expect(res.status).toBe(500);
    expect(vi.mocked(store.setDecision)).not.toHaveBeenCalled();
  });

  it('preview changes nothing', async () => {
    rows.push(row('a@x.com', 340), row('b@x.com', 366));
    const res = await call('?preview=1');
    const body = await res.json();
    expect(body.data).toMatchObject({ preview: true, noticed: ['a@x.com'], ended: ['b@x.com'] });
    expect(vi.mocked(emails.sendTermEndingEmail)).not.toHaveBeenCalled();
    expect(vi.mocked(grants.applyMemberGrant)).not.toHaveBeenCalled();
  });
});
