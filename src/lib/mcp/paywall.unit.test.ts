import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

/** Pinned fingerprint of the v1 offer surface. Update ONLY alongside a version bump. */
const OFFER_SURFACE_HASH_V1 = '466d0fd437661b92';
import { paywallMessage, RESUME_BASE, PAYWALL_OFFER_VERSION, __testing } from './paywall';

describe('paywallMessage', () => {
  it('names the specific tool the user reached for, not a generic credit balance', () => {
    const msg = paywallMessage({
      toolName: 'generate_market_report',
      reason: 'insufficient_credits',
      creditsRequired: 100,
      balance: 0,
      attemptId: 'abc-123',
    });
    // The old message led with price and balance. The offer should lead with intent.
    expect(msg).toContain('another market');
    expect(msg).toContain('Market Report');
    expect(msg).toContain('one NAICS code and one geography');
    expect(msg).not.toMatch(/your balance is 0/i);
  });

  it('links to the saved attempt so the request survives checkout', () => {
    const msg = paywallMessage({
      toolName: 'capability_market_match',
      reason: 'insufficient_credits',
      attemptId: 'attempt-7',
    });
    expect(msg).toContain(`${RESUME_BASE}?attempt=attempt-7`);
  });

  it('falls back to plain checkout when the attempt could not be saved', () => {
    // recordPaywallAttempt is best-effort; a null id must still produce a usable offer.
    const msg = paywallMessage({
      toolName: 'generate_market_report',
      reason: 'insufficient_credits',
      attemptId: null,
    });
    expect(msg).toContain(__testing.CHECKOUT_ENTRY);
    expect(msg).not.toContain('attempt=');
  });

  it('handles a premium tool with no bespoke copy without emitting undefined', () => {
    const msg = paywallMessage({
      toolName: 'some_future_tool',
      reason: 'insufficient_credits',
      attemptId: 'x',
    });
    expect(msg).not.toContain('undefined');
    expect(msg.length).toBeGreaterThan(40);
  });

  it('uses upgrade language, not a top-up instruction, for the Pro gate', () => {
    const msg = paywallMessage({
      toolName: 'build_pursuit_dossier',
      reason: 'requires_pro',
      attemptId: 'y',
    });
    expect(msg).toContain('Pursuit Dossier');
    expect(msg).toContain('saved');
  });

  it('covers every 100-credit tool with bespoke copy', () => {
    // These are the three tools that cost the entire free grant, so they are the ones a
    // user is most likely to hit the wall on. A missing entry silently degrades to generic.
    for (const t of ['generate_market_report', 'capability_market_match', 'build_pursuit_dossier']) {
      expect(__testing.TOOL_OFFERS[t], `${t} needs bespoke paywall copy`).toBeTruthy();
      expect(__testing.TOOL_LABEL[t]).toBeTruthy();
    }
  });

  it('stamps a version so a funnel spanning a copy change stays interpretable', () => {
    expect(PAYWALL_OFFER_VERSION).toMatch(/^v\d+$/);
  });

  it('FAILS IF THE OFFER COPY CHANGED WITHOUT BUMPING PAYWALL_OFFER_VERSION', () => {
    // The whole point of the version column is that a row remembers which wall it showed.
    // If the copy drifts while the version stays put, every downstream rate silently mixes
    // two different offers and the answer is unrecoverable.
    //
    // When you intentionally change the offer: bump PAYWALL_OFFER_VERSION, then update
    // this hash. Doing both is the point -- the hash is a speed bump, not busywork.
    const surface = JSON.stringify({
      offers: __testing.TOOL_OFFERS,
      labels: __testing.TOOL_LABEL,
      checkout: __testing.CHECKOUT_ENTRY,
      resume: RESUME_BASE,
      // The assembled message shapes, so a change to sentence structure is caught too.
      credits: paywallMessage({ toolName: 'generate_market_report', reason: 'insufficient_credits', attemptId: 'FIXED' }),
      pro: paywallMessage({ toolName: 'build_pursuit_dossier', reason: 'requires_pro', attemptId: 'FIXED' }),
    });
    const hash = createHash('sha256').update(surface).digest('hex').slice(0, 16);
    expect(
      { version: PAYWALL_OFFER_VERSION, hash },
      'Offer copy/CTA/checkout changed. Bump PAYWALL_OFFER_VERSION and update this hash.',
    ).toEqual({ version: 'v1', hash: OFFER_SURFACE_HASH_V1 });
  });
});
