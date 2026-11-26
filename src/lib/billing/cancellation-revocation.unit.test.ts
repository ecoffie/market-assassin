import { describe, it, expect } from 'vitest';
import { planCancellationRevocation, type RevocationInput } from './cancellation-revocation';

const NOW = Date.UTC(2026, 9, 1);
const base = (over: Partial<RevocationInput> = {}): RevocationInput => ({
  cancelled: 'alert_pro', status: 'canceled', deleted: true, otherLiveSubscriptions: [],
  kvValues: { alertpro: 'true', ospro: 'true' }, purchaseTexts: [], isComp: false,
  paidThroughMs: NOW - 1000, nowMs: NOW, ...over,
});

describe('Alert Pro cancellation', () => {
  it('⚠️ THE BUG: removes ospro: + access_hunter_pro too (Pro no longer survives cancellation)', () => {
    const p = planCancellationRevocation(base());
    expect(p.deleteKv.sort()).toEqual(['alertpro', 'ospro']);
    expect(p.clearFlags).toEqual(['access_hunter_pro']);
  });
  it('keeps ospro: when the customer also bought Opportunity Hunter Pro', () => {
    const p = planCancellationRevocation(base({ purchaseTexts: ['opportunity-hunter-pro'] }));
    expect(p.deleteKv).toEqual(['alertpro']);
    expect(p.keep.map((k) => k.key)).toEqual(expect.arrayContaining(['ospro', 'access_hunter_pro']));
  });
  it('keeps ospro: when its KV value was written by a purchase/admin grant (an object)', () => {
    const p = planCancellationRevocation(base({ kvValues: { alertpro: 'true', ospro: { email: 'x', tier: 'pro' } } }));
    expect(p.deleteKv).toEqual(['alertpro']);
  });
  it('keeps ospro: while an FHC membership is still live', () => {
    const p = planCancellationRevocation(base({ otherLiveSubscriptions: ['fhc'] }));
    expect(p.deleteKv).toEqual([]);
    expect(p.action).toBe('none');
  });
});

describe('FHC cancellation — no longer wipes other purchases', () => {
  const fhc = (over: Partial<RevocationInput> = {}) => base({ cancelled: 'fhc', kvValues: { ma: 'true', alertpro: 'true', ospro: 'true' }, ...over });
  it('with no other source: removes all three + both flags', () => {
    const p = planCancellationRevocation(fhc());
    expect(p.deleteKv.sort()).toEqual(['alertpro', 'ma', 'ospro']);
    expect(p.clearFlags.sort()).toEqual(['access_assassin_standard', 'access_hunter_pro']);
  });
  it('keeps ma: for a Market Assassin / bundle buyer', () => {
    for (const t of ['market-assassin-premium', 'Ultimate GovCon Bundle', 'pro-giant-bundle']) {
      const p = planCancellationRevocation(fhc({ purchaseTexts: [t] }));
      expect(p.deleteKv).not.toContain('ma');
    }
  });
  it('keeps alertpro:/ospro: while an Alert Pro subscription is still live', () => {
    const p = planCancellationRevocation(fhc({ otherLiveSubscriptions: ['alert_pro'] }));
    expect(p.deleteKv).toEqual(['ma']);
  });
});

describe('comp, paid-through, and non-terminal statuses', () => {
  it('a comp/staff/advocate account keeps everything', () => {
    const p = planCancellationRevocation(base({ cancelled: 'fhc', isComp: true, kvValues: { ma: 'true', alertpro: 'true', ospro: 'true' } }));
    expect(p.action).toBe('none');
    expect(p.deleteKv).toEqual([]);
  });
  it('paid through a future date → keys EXPIRE at that date, nothing deleted now, flags kept', () => {
    const end = NOW + 10 * 86400000;
    const p = planCancellationRevocation(base({ paidThroughMs: end }));
    expect(p.deleteKv).toEqual([]);
    expect(p.expireKvAt).toEqual(expect.arrayContaining([{ key: 'alertpro', atMs: end }, { key: 'ospro', atMs: end }]));
    expect(p.clearFlags).toEqual([]);
  });
  it.each(['past_due', 'unpaid', 'active', 'trialing'])('%s update revokes nothing (still billing/retrying)', (status) => {
    const p = planCancellationRevocation(base({ deleted: false, status }));
    expect(p.action).toBe('none');
    expect(p.setSubscriptionStatusCanceled).toBe(false);
  });
  it('never touches the alert-frequency preference', () => {
    expect(Object.keys(planCancellationRevocation(base()))).not.toContain('alertFrequency');
  });
  it('absent keys are not "revoked"', () => {
    const p = planCancellationRevocation(base({ kvValues: {} }));
    expect(p.deleteKv).toEqual([]);
  });
});

describe('wiring — the webhook applies the plan and nothing else', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const src = readFileSync(require('node:path').join(__dirname, '../../app/api/stripe-webhook/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const cancel = src.slice(src.indexOf("event.type === 'customer.subscription.deleted'"));
  it('uses planCancellationRevocation', () => {
    expect(cancel).toContain('planCancellationRevocation(');
  });
  it('no unconditional grant deletes remain in the cancellation path', () => {
    expect(cancel).not.toMatch(/kv\.del\(`(ma|alertpro|ospro):\$\{email\}`\)/);
  });
  it('does not reset the alert-frequency preference on cancellation', () => {
    expect(cancel).not.toMatch(/alert_frequency:\s*'weekly'/);
  });
  it('uncertain attribution keeps access', () => {
    expect(cancel).toContain("action: 'kept_uncertain_attribution'");
  });
});
