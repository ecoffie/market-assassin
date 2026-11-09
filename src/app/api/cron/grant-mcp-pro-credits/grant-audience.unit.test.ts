import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GRANT-AUDIENCE POLICY PIN (GOS Decision #019, 2026-07-20).
 *
 * Recurring MCP credits require a recurring payment (or a named comp/sponsor/prepaid
 * entitlement). App ACCESS alone — the KV `briefings:` gate a beta-preview or legacy
 * grant sets — never puts an account in the monthly audience.
 *
 * Why this is pinned: on 2026-07-15 the audience WAS the KV gate, and ~713 accounts got
 * 1,000 credits they had no entitlement to. On 2026-11-09 one of them (Pro via a bare
 * beta-preview flag) reported his "monthly" credits had stopped. They never were monthly.
 * The tempting fix is to put KV-access holders back in this audience; this test fails
 * if anyone does.
 */

const ACTIVE_PRO_SUB = 'paying.pro@example.com';
const BETA_PREVIEW_PRO = 'beta.preview@example.com'; // KV briefings:true, nothing else

const kvGet = vi.fn(async (key: string) => (key === `briefings:${BETA_PREVIEW_PRO}` ? true : null));
const kvScan = vi.fn(async () => ['0', [`briefings:${BETA_PREVIEW_PRO}`]]);
vi.mock('@vercel/kv', () => ({ kv: { get: kvGet, scan: kvScan } }));

vi.mock('stripe', () => {
  const subs = [
    { id: 'sub_pro', items: { data: [{ price: { unit_amount: 14900 } }] }, customer: { email: ACTIVE_PRO_SUB, deleted: false } },
  ];
  class StripeMock {
    subscriptions = {
      list: () => ({
        async *[Symbol.asyncIterator]() { for (const s of subs) yield s; },
      }),
    };
  }
  return { default: StripeMock };
});

vi.mock('@/lib/api-auth', () => ({ INTERNAL_TEAM_EMAILS: [] }));
vi.mock('@/lib/mindy/advocate-accounts', () => ({ ADVOCATE_ACCOUNTS: [] }));
vi.mock('@/lib/mcp/sponsor-entitlements', () => ({
  activeSponsorEntitlements: vi.fn(async () => ({ entitlements: [], error: null })),
  topUpToCeiling: vi.fn(),
}));
vi.mock('@/lib/mcp/prepaid-entitlements', () => ({
  listActivePrepaidEntitlements: vi.fn(async () => ({ entitlements: [], error: null })),
  catchUpPrepaidMonths: vi.fn(async () => ({ released: [], errors: [] })),
  dueMonths: vi.fn(() => []),
  monthlyGrantKey: (email: string, month: string) => `pro:${email}:${month}`,
  accessDate: () => '2026-11-09',
  accessIsLive: () => true,
}));
vi.mock('@/lib/mcp/team-pools', () => ({
  listPooledOrgsBySubscription: vi.fn(async () => new Map()),
  replenishPool: vi.fn(),
  routeSubscriptionGrants: (c: unknown[]) => ({ personal: c, pools: [] }),
  isPoolSchemaMissing: () => false,
}));
vi.mock('@/lib/mcp/pro-allowance', () => ({ proAllowanceDecision: vi.fn(async () => ({ grant: true })) }));
const applyCreditOnce = vi.fn(async () => ({ applied: true, newBalance: 0 }));
vi.mock('@/lib/mcp/credits', () => ({ applyCreditOnce }));
vi.mock('@/lib/mcp/credit-health', () => ({ collectCreditHealth: vi.fn(async () => ({})), claimAlertOnce: vi.fn(async () => false) }));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn(async () => ({ ok: true })) }));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.ADMIN_PASSWORD = 'pw';
  kvGet.mockClear();
  kvScan.mockClear();
  applyCreditOnce.mockClear();
});

async function preview() {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest('http://localhost/api/cron/grant-mcp-pro-credits?preview=1&password=pw'));
  expect(res.status).toBe(200);
  return (await res.json()) as { targets: Array<{ email: string; group: string; amount: number }> };
}

describe('grant-mcp-pro-credits audience', () => {
  it('an active $149 Pro subscriber is in the monthly audience', async () => {
    const { targets } = await preview();
    expect(targets.find((t) => t.email === ACTIVE_PRO_SUB)).toMatchObject({ group: 'pro-sub' });
  });

  it('a beta-preview Pro account (KV access only) is NOT in the monthly audience', async () => {
    const { targets } = await preview();
    expect(targets.map((t) => t.email)).not.toContain(BETA_PREVIEW_PRO);
    // The route always adds two hard-coded staff accounts (group 'internal'); every
    // other target must come from a paid or named entitlement.
    expect(targets.filter((t) => t.group !== 'internal').map((t) => t.email)).toEqual([ACTIVE_PRO_SUB]);
  });

  it('the audience is never derived from the KV access gate', async () => {
    await preview();
    expect(kvGet).not.toHaveBeenCalled();
    expect(kvScan).not.toHaveBeenCalled();
  });

  it('preview grants nothing', async () => {
    await preview();
    expect(applyCreditOnce).not.toHaveBeenCalled();
  });
});
