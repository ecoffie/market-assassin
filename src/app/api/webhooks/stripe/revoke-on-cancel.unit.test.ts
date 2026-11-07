import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { appTierOfSubscription, revokeBlockReason, HOLD_REVOKE_STATUSES, type RevokeGuardFacts } from '@/lib/billing/revoke-app-tier-on-cancel';

// The revoke runs inside a webhook that needs a signed Stripe event, so the store
// writes are asserted on the source; the guard decision is asserted directly.
const ROOT = path.join(__dirname, '../../../../..');
const lib = fs.readFileSync(path.join(ROOT, 'src/lib/billing/revoke-app-tier-on-cancel.ts'), 'utf8');
const body = lib.slice(lib.indexOf('export async function applyRevoke'));
const liveWebhook = fs.readFileSync(path.join(ROOT, 'src/app/api/stripe-webhook/route.ts'), 'utf8');
const legacyWebhook = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');

describe('subscription.deleted revokes entitlement', () => {
  it('clears KV — the gate hasBriefingsAccess checks FIRST', () => {
    expect(body).toContain('revokeBriefingsAccess');
  });

  it('clears every store that can independently grant access', () => {
    for (const table of ['user_profiles', 'user_notification_settings', 'customer_classifications']) {
      expect(body).toContain(table);
    }
  });

  it('clears customer_classifications — the BRIEFING CRON audience', () => {
    expect(body).toMatch(/customer_classifications[\s\S]*briefings_access/);
  });

  it('revokes KV BEFORE the Supabase writes', () => {
    expect(body.indexOf('revokeBriefingsAccess')).toBeLessThan(body.indexOf("from('user_profiles')"));
  });

  it('clears the stale paid_status flag', () => {
    expect(body).toMatch(/paid_status:\s*false/);
  });

  it('clears access_team for a Team subscription', () => {
    expect(body).toMatch(/tier === 'team'[\s\S]{0,40}access_team = false/);
  });

  it('fails soft — one store failing never aborts the others', () => {
    const tries = (body.match(/try\s*\{/g) || []).length;
    expect(tries).toBeGreaterThanOrEqual(5); // email resolve + 4 revoke steps
    expect(body).not.toMatch(/catch[\s\S]{0,80}throw/);
  });

  it('logs loudly when the email cannot be resolved (silent no-op is the risk)', () => {
    expect(body).toMatch(/NO EMAIL[\s\S]*revoke by hand/);
  });
});

describe('the LIVE webhook actually calls it (the 2026-11 bug)', () => {
  // Stripe sends subscription events ONLY to /api/stripe-webhook. The August fix lived in
  // the disabled /api/webhooks/stripe handler and never ran; cancelled MI Pro kept Pro.
  it('/api/stripe-webhook revokes on customer.subscription.deleted', () => {
    expect(liveWebhook).toMatch(/customer\.subscription\.deleted'[\s\S]{0,40}\n[\s\S]{0,200}revokeAppTierOnCancel/);
  });

  it('runs BEFORE the non-FHC/AlertPro "ignored" early return', () => {
    expect(liveWebhook.indexOf('revokeAppTierOnCancel')).toBeGreaterThan(-1);
    expect(liveWebhook.indexOf('revokeAppTierOnCancel')).toBeLessThan(
      liveWebhook.indexOf('Non-FHC/AlertPro subscription event, ignoring'),
    );
  });

  it('a guard it could not establish returns 503 so Stripe retries (never a silent 200)', () => {
    expect(liveWebhook).toMatch(/reason\.startsWith\('guard_unknown'\)[\s\S]{0,200}status: retry \? 503 : 200/);
  });

  it('the legacy handler uses the same shared path', () => {
    expect(legacyWebhook).toContain('revokeAppTierOnCancel(');
  });
});

const sub = (amount: number) => ({ items: { data: [{ price: { unit_amount: amount } }] } }) as never;

describe('other-subscription check', () => {
  it('recovering / pending subscriptions HOLD a revoke (a safeguard, not a Pro grant)', () => {
    for (const st of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) expect(HOLD_REVOKE_STATUSES.has(st)).toBe(true);
    for (const st of ['canceled', 'incomplete_expired']) expect(HOLD_REVOKE_STATUSES.has(st)).toBe(false);
  });

  it('unions the consistent exact-email list with the case-insensitive search', () => {
    expect(lib).toMatch(/customers\.list\(\{ email[\s\S]{0,200}customers\.search\(/);
  });

  it('a truncated customer or subscription page is unknown, not "none"', () => {
    expect(lib).toMatch(/listed\.has_more \|\| searched\.has_more\) return null/);
    expect(lib).toMatch(/subs\.has_more\) return null/);
  });
});

describe('appTierOfSubscription', () => {
  it('maps Pro and Team prices', () => {
    expect(appTierOfSubscription(sub(14900))).toBe('pro');
    expect(appTierOfSubscription(sub(149000))).toBe('pro');
    expect(appTierOfSubscription(sub(4900))).toBe('pro');
    expect(appTierOfSubscription(sub(49900))).toBe('team');
  });

  it('ignores FHC ($99) and MCP plans — not app-tier', () => {
    expect(appTierOfSubscription(sub(9900))).toBeNull();
    expect(appTierOfSubscription(sub(5900))).toBeNull();
  });
});

const base: RevokeGuardFacts = {
  email: 'buyer@example.com',
  otherLiveAppSub: false,
  prepaidLive: false,
  purchases: [{ product_name: 'Mindy Ai', amount_paid: 14900 }],
  classificationAccess: 'subscription',
};

describe('revokeBlockReason — never cut off someone who holds Pro another way', () => {
  it('proceeds for a plain cancelled Mindy Ai subscriber', () => {
    expect(revokeBlockReason(base)).toBeNull();
  });

  it('blocks when another Pro/Team subscription is live', () => {
    expect(revokeBlockReason({ ...base, otherLiveAppSub: true })).toBe('other_live_app_subscription');
  });

  it('blocks on a live prepaid entitlement', () => {
    expect(revokeBlockReason({ ...base, prepaidLive: true })).toBe('live_prepaid_entitlement');
  });

  it('blocks a lifetime purchase and a lifetime classification', () => {
    expect(revokeBlockReason({ ...base, purchases: [...base.purchases!, { product_name: 'Mindy Teams', amount_paid: 499000 }] }))
      .toBe('lifetime_purchase');
    expect(revokeBlockReason({ ...base, classificationAccess: 'lifetime' })).toBe('lifetime_classification');
  });

  it('blocks a legacy bundle buyer (grandfathered)', () => {
    expect(revokeBlockReason({ ...base, purchases: [{ product_name: 'Ultimate GovCon Bundle', amount_paid: 100000 }] }))
      .toBe('legacy_bundle_grandfathered');
  });

  it('blocks staff and advocates', () => {
    expect(revokeBlockReason({ ...base, email: 'someone@getmindy.ai' })).toBe('staff_account');
    expect(revokeBlockReason({ ...base, email: 'louis.reed@reedasolutions.com' })).toBe('advocate_account');
  });

  it('blocks when a guard cannot be established — unknown is not "no"', () => {
    expect(revokeBlockReason({ ...base, otherLiveAppSub: null })).toMatch(/^guard_unknown/);
    expect(revokeBlockReason({ ...base, prepaidLive: null })).toMatch(/^guard_unknown/);
    expect(revokeBlockReason({ ...base, purchases: null })).toMatch(/^guard_unknown/);
    expect(revokeBlockReason({ ...base, classificationAccess: undefined })).toMatch(/^guard_unknown/);
  });
});
