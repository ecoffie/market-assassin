/**
 * /api/app/billing/trial-upgrade — the route never acts on a claimed email: it requires a
 * verified session for that email, and passes only the VERIFIED identity's linked emails on.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';

const verifyUserOwnsEmail = vi.fn();
vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: (...a: unknown[]) => verifyUserOwnsEmail(...a) }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('@/lib/mindy/linked-emails', () => ({ getLinkedEmails: vi.fn(async (e: string) => [e, 'linked@x.com']) }));
const upgradeTrialNow = vi.fn();
const listTrialUpgradeOffers = vi.fn();
vi.mock('@/lib/billing/trial-upgrade', () => ({
  upgradeTrialNow: (...a: unknown[]) => upgradeTrialNow(...a),
  listTrialUpgradeOffers: (...a: unknown[]) => listTrialUpgradeOffers(...a),
}));

const { POST, GET } = await import('./route');

const post = (body: unknown) =>
  POST(new NextRequest('https://getmindy.ai/api/app/billing/trial-upgrade', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

beforeEach(() => vi.clearAllMocks());

describe('POST /api/app/billing/trial-upgrade', () => {
  it('401 without a verified session, and never touches Stripe', async () => {
    verifyUserOwnsEmail.mockResolvedValue({ authenticated: false, email: null, error: 'Unauthorized' });
    const res = await post({ email: 'me@x.com', subscriptionId: 'sub_1' });
    expect(res.status).toBe(401);
    expect(upgradeTrialNow).not.toHaveBeenCalled();
  });

  it('400 without an email', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(verifyUserOwnsEmail).not.toHaveBeenCalled();
  });

  it('upgrades for the VERIFIED email and its linked emails', async () => {
    verifyUserOwnsEmail.mockResolvedValue({ authenticated: true, email: 'me@x.com' });
    upgradeTrialNow.mockResolvedValue({ ok: true, status: 'upgraded', subscriptionId: 'sub_1', amountCharged: 149, bonusCredits: 500 });
    const res = await post({ email: 'ME@x.com', subscriptionId: 'sub_1' });
    expect(res.status).toBe(200);
    expect(upgradeTrialNow).toHaveBeenCalledWith({}, ['me@x.com', 'linked@x.com'], 'sub_1');
    expect(await res.json()).toMatchObject({ success: true, status: 'upgraded', bonusCredits: 500 });
  });

  it('passes refusals through with their status and plain message', async () => {
    verifyUserOwnsEmail.mockResolvedValue({ authenticated: true, email: 'me@x.com' });
    upgradeTrialNow.mockResolvedValue({ ok: false, httpStatus: 409, code: 'not_trialing', message: 'This plan is not in a free trial, so there is nothing to upgrade.' });
    const res = await post({ email: 'me@x.com', subscriptionId: 'sub_1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'not_trialing', error: expect.stringMatching(/not in a free trial/) });
  });
});

describe('GET /api/app/billing/trial-upgrade', () => {
  it('401 without a verified session', async () => {
    verifyUserOwnsEmail.mockResolvedValue({ authenticated: false, email: null });
    const res = await GET(new NextRequest('https://getmindy.ai/api/app/billing/trial-upgrade?email=me@x.com'));
    expect(res.status).toBe(401);
    expect(listTrialUpgradeOffers).not.toHaveBeenCalled();
  });

  it('a Stripe failure is 502 (unknown), never an empty offer list', async () => {
    verifyUserOwnsEmail.mockResolvedValue({ authenticated: true, email: 'me@x.com' });
    listTrialUpgradeOffers.mockRejectedValue(new Error('down'));
    const res = await GET(new NextRequest('https://getmindy.ai/api/app/billing/trial-upgrade?email=me@x.com'));
    expect(res.status).toBe(502);
  });
});
