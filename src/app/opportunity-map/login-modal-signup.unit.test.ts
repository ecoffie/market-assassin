/**
 * In-modal signup (Homepage Readiness #56). A first-time visitor who clicks "Create a free account"
 * must NOT leave the map — the account is created in-modal (email-first, honest verify-email step),
 * the pending intent is queued BEFORE the email round-trip so it isn't lost, and the success state
 * promises the OUTCOME ("your work is safe / waiting"), not a chore. OAuth/setup/forgot legitimately
 * still redirect to /app (provider round-trip / token step). This locks that contract so a future
 * edit can't silently send "Create account" back to a page-leave, or drop the queue-before-email.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The modal moved OUT of route.ts into login-modal.ts (2026-08-23) so all eight Maps
// sub-routes could share ONE copy instead of hard-dumping visitors into /app. Read both
// and concatenate: these assertions are about the modal's CONTRACT, which is unchanged by
// where the source lives, and this keeps the test valid if part of it ever moves back.
const route = [
  readFileSync(join(__dirname, 'login-modal.ts'), 'utf8'),
  readFileSync(join(__dirname, 'route.ts'), 'utf8'),
].join('\n');

describe('login modal — in-modal signup keeps the visitor on the map', () => {
  it('renders all four steps (email → password → create-account → success)', () => {
    for (const id of ['lgmStep1', 'lgmStep2', 'lgmStep3', 'lgmStep4']) {
      expect(route).toContain(`id="${id}"`);
    }
  });

  it('"Create a free account" opens the in-modal signup step, NOT a page redirect', () => {
    // The old behavior was toApp('&signup=1') (page leave). It must be gone.
    expect(route).not.toContain("toApp('&signup=1')");
    // The create link now switches to step 3 in-modal.
    expect(route).toMatch(/lgmCreate.*addEventListener[\s\S]*?step\(3\)/);
  });

  it('signup posts to the real endpoint (mindy-signup), reusing the app contract', () => {
    expect(route).toContain("fetch('/api/auth/mindy-signup'");
  });

  it('queues the pending intent to localStorage BEFORE the email round-trip (intent never lost)', () => {
    // queueIntent must be defined and CALLED inside the signup success path.
    expect(route).toContain('function queueIntent(');
    expect(route).toContain("localStorage.setItem('mindy_pending_intents'");
    // It is invoked in doSignup on success.
    expect(route).toMatch(/if\(!d\|\|!d\.success\)[\s\S]*?queueIntent\(em\)/);
  });

  it('success state is outcome-first (promises the saved work), not a bare "check your email"', () => {
    expect(route).toContain('Your account has been created');
    expect(route).toMatch(/waiting for you here/i);
  });

  it('lets the user keep browsing (Continue browsing) + Resend, does not lock the session', () => {
    expect(route).toContain('Continue browsing');
    expect(route).toContain('id="lgmResend"');
  });

  it('OAuth still redirects by design (provider round-trip) — sign-in in-modal, social off-map', () => {
    expect(route).toContain("toApp('&oauth=google')");
    expect(route).toContain("toApp('&oauth=microsoft')");
  });

  it('drains queued intents on return (welcome-back), gated on being signed in', () => {
    expect(route).toContain('function drainPendingIntents(');
    expect(route).toMatch(/drainPendingIntents[\s\S]*?isSignedIn\(\)/);
  });
});
