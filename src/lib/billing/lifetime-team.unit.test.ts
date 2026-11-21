import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invoiceGrantsLifetimeTeam, invoiceProductIds, TEAM_LIFETIME_TIER } from './lifetime-team';

// Shape of the real Teams Lifetime invoice (billing_reason manual, no subscription).
const realInvoice = {
  status: 'paid',
  amount_paid: 600000,
  lines: { data: [{ price: { product: 'prod_Ui72gVmD5xD4H3' } }] },
};

describe('Teams Lifetime invoice detection', () => {
  it('matches the real Teams Lifetime invoice', () => {
    expect(invoiceGrantsLifetimeTeam(realInvoice)).toBe(true);
  });

  it('reads the product from the newer `pricing` shape and from an expanded product object', () => {
    expect(invoiceProductIds({ lines: { data: [{ pricing: { price_details: { product: 'prod_Ui72gVmD5xD4H3' } } }] } })).toEqual(['prod_Ui72gVmD5xD4H3']);
    expect(invoiceProductIds({ lines: { data: [{ price: { product: { id: 'prod_Ui72gVmD5xD4H3' } } }] } })).toEqual(['prod_Ui72gVmD5xD4H3']);
  });

  it('never matches on the line description (free text) alone', () => {
    expect(invoiceGrantsLifetimeTeam({ status: 'paid', amount_paid: 600000, lines: { data: [{ price: { product: 'prod_other' } }] } })).toBe(false);
  });

  it('grants nothing unless money was collected', () => {
    expect(invoiceGrantsLifetimeTeam({ ...realInvoice, amount_paid: 0 })).toBe(false);
    expect(invoiceGrantsLifetimeTeam({ ...realInvoice, status: 'open' })).toBe(false);
  });
});

// Source-level guards (same pattern as src/lib/mcp/async-payment-invariant.unit.test.ts): the
// fix lives in two files and each half looks harmless to delete on its own.
const root = join(__dirname, '..', '..', '..');
const code = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Teams Lifetime is wired end to end', () => {
  it('updateAccessFlags maps team_lifetime to access_team', () => {
    const src = code('src/lib/supabase/user-profiles.ts');
    expect(TEAM_LIFETIME_TIER).toBe('team_lifetime');
    expect(src).toMatch(/tier === 'team_lifetime'\)\s*\{\s*updates\.access_team = true;/);
  });

  it('the invoice.paid handler grants it, and fails loudly (500) when the grant does not land', () => {
    const webhook = code('src/app/api/stripe-webhook/route.ts');
    const invoicePaid = webhook.slice(webhook.indexOf("event.type === 'invoice.paid'"));
    expect(invoicePaid).toContain('invoiceGrantsLifetimeTeam(invoice)');
    expect(invoicePaid).toContain('updateAccessFlags(email, TEAM_LIFETIME_TIER)');
    expect(invoicePaid).toContain("'team_lifetime_grant_failed'");
    // It must run before the handler's final return, not after it.
    expect(invoicePaid.indexOf('invoiceGrantsLifetimeTeam(invoice)')).toBeLessThan(invoicePaid.indexOf("action: 'invoice_paid'"));
  });
});
