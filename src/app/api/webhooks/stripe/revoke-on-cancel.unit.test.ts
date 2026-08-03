import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The handler is inside a webhook that needs a signed Stripe event to invoke, so
// assert on the source: which entitlement stores it clears, and in what order.
const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
const handler = src.slice(src.indexOf('async function handleSubscriptionDeleted'));
const body = handler.slice(0, handler.indexOf('\n}\n') + 3);

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
    // Miss this and a cancelled user keeps receiving briefings even with every
    // other flag off, because fetchBriefingEntitlements reads only this table.
    expect(body).toMatch(/customer_classifications[\s\S]*briefings_access/);
  });

  it('revokes KV BEFORE the Supabase writes', () => {
    // If Supabase fails we must still have cut off entry, not left a live KV key
    // behind a "revoked" profile.
    expect(body.indexOf('revokeBriefingsAccess')).toBeLessThan(body.indexOf("from('user_profiles')"));
  });

  it('clears the stale paid_status flag', () => {
    // 10 of 12 audited accounts had paid_status=true with a long-cancelled sub.
    expect(body).toMatch(/paid_status:\s*false/);
  });

  it('fails soft — one store failing never aborts the others', () => {
    const tries = (body.match(/try\s*\{/g) || []).length;
    expect(tries).toBeGreaterThanOrEqual(4); // email resolve + 4 revoke steps
    expect(body).not.toMatch(/catch[\s\S]{0,80}throw/);
  });

  it('logs loudly when the email cannot be resolved (silent no-op is the risk)', () => {
    expect(body).toMatch(/NO EMAIL[\s\S]*revoke by hand/);
  });
});
