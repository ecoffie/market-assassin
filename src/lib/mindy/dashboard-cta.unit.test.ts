/**
 * Guards the "Open Mindy" email CTA carrying the recipient's identity.
 *
 * THE BUG (reported with screenshots 2026-08-04): the flagship "Open Mindy v1.0" button
 * in a saved-search alert linked to a bare https://getmindy.ai/briefings — no email, no
 * token. /briefings cannot identify a visitor client-side, so it ran its "no
 * authenticated user" branch and redirected to /alerts/signup.
 *
 * An existing subscriber clicked the main CTA in an alert they were already receiving
 * and landed on "Get SAM.gov Opportunities Delivered — configure your profile once."
 *
 * WHY IT SURVIVED: the email rendered perfectly and the send metrics stayed green.
 * Nothing errors, nothing logs. The failure was entirely in the landing.
 *
 * Every sibling link in the same template already carried ?email= — preferencesUrl,
 * unsubscribeUrl, add-to-pipeline. Only the dashboard CTA did not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BRANDING = read('src/lib/mindy/email-branding.ts');
const DAILY = read('src/app/api/cron/daily-alerts/route.ts');
const WEEKLY = read('src/app/api/cron/weekly-alerts/route.ts');

// Mirrors mindyDashboardUrlFor().
const base = 'https://getmindy.ai/opportunity-map';
function urlFor(email: string, appUrl = base): string {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return appUrl;
  return `${appUrl}${appUrl.includes('?') ? '&' : '?'}email=${encodeURIComponent(clean)}`;
}

describe('the CTA carries identity', () => {
  it('attaches the recipient email', () => {
    expect(urlFor('user@example.com')).toBe('https://getmindy.ai/opportunity-map?email=user%40example.com');
  });

  it('normalises case and whitespace so the lookup matches', () => {
    expect(urlFor('  User@Example.COM ')).toContain('email=user%40example.com');
  });

  it('encodes addresses that would otherwise break the query string', () => {
    // A + in an address is a real, common alias form and must not become a space.
    expect(urlFor('a+tag@example.com')).toContain('email=a%2Btag%40example.com');
    expect(urlFor('a+tag@example.com')).not.toContain('a+tag@');
  });

  it('appends with & when the base already has a query', () => {
    expect(urlFor('u@x.com', 'https://getmindy.ai/briefings?utm_source=alert'))
      .toBe('https://getmindy.ai/briefings?utm_source=alert&email=u%40x.com');
  });

  it('falls back to the plain URL rather than emitting a malformed one', () => {
    // A generic link is recoverable; "?email=" with nothing after it is not.
    expect(urlFor('')).toBe(base);
    expect(urlFor('   ')).toBe(base);
    expect(urlFor('')).not.toContain('email=');
  });
});

describe('both senders of this CTA use it', () => {
  it('daily-alerts passes the recipient email', () => {
    // This is the sender in the reported screenshot.
    expect(DAILY).toContain('mindyDashboardUrlFor(email)');
    expect(DAILY, 'a bare MINDY_APP_URL is the bug').not.toMatch(/const mindyDashboardUrl = MINDY_APP_URL;/);
  });

  it('weekly-alerts passes the recipient email', () => {
    expect(WEEKLY).toContain('mindyDashboardUrlFor(email)');
    expect(WEEKLY).not.toMatch(/const mindyDashboardUrl = MINDY_APP_URL;/);
  });

  it('the helper lives in one place, so a seventh sender inherits the fix', () => {
    expect(BRANDING).toContain('export function mindyDashboardUrlFor');
  });

  it('does NOT use the 15-minute access-link token for this CTA', () => {
    // createSecureAccessUrl tokens expire in 15 minutes. An alert email is routinely
    // opened hours later — that trades a broken link for an expired one.
    const fn = BRANDING.slice(BRANDING.indexOf('export function mindyDashboardUrlFor'));
    expect(fn).not.toContain('createSecureAccessUrl');
  });
});

describe('the destination still honours the beta routing rule', () => {
  it('points at a MAP-NATIVE surface, never a legacy one', () => {
    // ⚠️ SUPERSEDED 2026-08-25, deliberately. This asserted `/briefings` because beta
    // alert users never set a password, so the OAuth-gated `/app` locked them out — a
    // real constraint AT THE TIME.
    //
    // That constraint is gone: `/opportunity-map` serves HTTP 200 with no auth and no
    // redirect, and honours `?email=` (both measured on production). So the reason to
    // sit on a legacy surface expired, while THIS FILE'S ACTUAL SUBJECT — that the CTA
    // carries the recipient's identity — is unchanged and still asserted above.
    //
    // What must never regress: an email CTA landing on /app or /briefings.
    expect(BRANDING).toContain('/opportunity-map');
    expect(BRANDING).not.toMatch(/return `\$\{MINDY_SITE_URL\}\/briefings`/);
    // The env-override guard is KEPT and WIDENED — an override at either legacy surface
    // is rejected, which is the regression that stranded beta users once.
    expect(BRANDING).toMatch(/\(app\|briefings\)/);
  });
});
