import { describe, it, expect } from 'vitest';
import { paywallMessage, RESUME_BASE, __testing } from './paywall';

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
});
