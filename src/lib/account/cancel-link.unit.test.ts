/**
 * Cancelling must be easy (Eric, 2026-11-27): a "Manage or cancel subscription" row in the shared account menu
 * (/app and every Map page), and one stable address, getmindy.ai/account/cancel, that support and Ask Mindy can
 * quote. Signed in: Settings, Billing. Signed out or expired: sign in, then back to Billing.
 */
import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BILLING_PATH, CANCEL_PATH, SIGN_IN_THEN_BILLING, CANCEL_REDIRECT_JS } from './cancel-link';
import { signInReturnPath } from '@/lib/mindy/sign-in-return';
import { ACCOUNT_MENU_HTML, accountMenuHtml } from '@/app/opportunity-map/account-menu';
import { tabForSection, anchorForSection } from '@/lib/app/settings-tabs';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (exp: number) => `${b64url({ email: 'pat@example.com', exp })}.sig`;

/** Run the page script with a given stored token; return where it sends the browser. */
function destinationFor(stored: string | null, opts: { storageThrows?: boolean } = {}): string {
  let replaced = '';
  runInNewContext(CANCEL_REDIRECT_JS, {
    localStorage: { getItem: () => { if (opts.storageThrows) throw new Error('blocked'); return stored; } },
    location: { replace: (u: string) => { replaced = u; } },
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    JSON, Date, Number,
  });
  return replaced;
}

describe('/account/cancel', () => {
  it('signed in (unexpired token): straight to Settings, Billing', () => {
    expect(destinationFor(token(Date.now() + 86_400_000))).toBe(BILLING_PATH);
    expect(BILLING_PATH).toBe('/app?panel=settings&section=billing');
  });

  it('signed out, expired, or storage blocked: sign in first, then back here', () => {
    expect(destinationFor(null)).toBe(SIGN_IN_THEN_BILLING);
    expect(destinationFor(token(Date.now() - 1000))).toBe(SIGN_IN_THEN_BILLING);
    expect(destinationFor('x', { storageThrows: true })).toBe(SIGN_IN_THEN_BILLING);
  });

  it('after sign-in, /app returns to /account/cancel (an allowed next), which then opens Billing', () => {
    expect(SIGN_IN_THEN_BILLING).toBe('/app?next=%2Faccount%2Fcancel');
    expect(signInReturnPath(CANCEL_PATH)).toBe(CANCEL_PATH);
  });

  it('section=billing opens the Billing & credits tab at the Billing card (Manage / cancel)', () => {
    expect(tabForSection('billing')).toBe('billing');
    expect(anchorForSection('billing')).toBe('settings-billing');
  });

  it('the route serves the page with the redirect script and plain fallback links', async () => {
    const { GET } = await import('@/app/account/cancel/route');
    const res = GET();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(CANCEL_REDIRECT_JS);
    expect(html).toContain('href="/app?panel=settings&amp;section=billing"');
    expect(html).toContain('noindex');
  });
});

describe('account menu: Manage or cancel subscription', () => {
  const rows = (html: string) => Array.from(html.matchAll(/<a href="([^"]+)"[^>]*role="menuitem"[^>]*>([\s\S]*?)<\/a>/g))
    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }));

  for (const [name, html] of [['Map menu', ACCOUNT_MENU_HTML], ['signed-in /app menu', accountMenuHtml({ email: 'pat@example.com' })]] as const) {
    it(`${name} has one plain row straight to Settings, Billing, always visible`, () => {
      const r = rows(html).filter((x) => x.text === 'Manage or cancel subscription');
      expect(r).toEqual([{ href: '/app?panel=settings&section=billing', text: 'Manage or cancel subscription' }]);
      expect(html).toMatch(/id="mindyAcctCancel" role="menuitem" style="box-sizing:border-box">/); // never display:none
    });
  }

  it('/app renders the shared menu (call site)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/app/page.tsx'), 'utf8');
    expect(src).toMatch(/html=\{accountMenuHtml\(\{ email \}\)\}/);
  });
});
