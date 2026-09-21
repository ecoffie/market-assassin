/**
 * /welcome instrumentation — we are about to FREEZE onboarding and observe.
 *
 * Freezing without instrumentation means waiting blind: we would learn nothing except from
 * users who complain. These three choices are the first thing a new account does, and
 * before this we could not say whether anyone opened the Map, connected MCP, personalized,
 * or left. That is the same "no evidence" state that let the referral bug hide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                              .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
const route = strip(readFileSync('src/app/api/welcome/choice/route.ts', 'utf8'));
const link = strip(readFileSync('src/app/welcome/choice-link.tsx', 'utf8'));
const page = strip(readFileSync('src/app/welcome/page.tsx', 'utf8'));

describe('navigation never waits on telemetry', () => {
  it('uses sendBeacon so the click is not blocked', () => {
    expect(link).toContain('navigator.sendBeacon');
  });

  it('the click handler is not async and does not await', () => {
    // An awaited fetch inside onClick would make a link a gate — the one thing /welcome
    // must never be.
    const handler = link.slice(link.indexOf('const record ='), link.indexOf('return <Link'));
    expect(handler).not.toMatch(/\bawait\b/);
    expect(handler).not.toMatch(/async/);
  });

  it('falls back to keepalive fetch, and swallows failure', () => {
    expect(link).toContain('keepalive: true');
    expect(link).toContain('.catch(() => {})');
  });
});

describe('reuses the existing analytics, adds no second system', () => {
  it('writes through logEngagement into user_engagement', () => {
    expect(route).toContain('logEngagement');
  });

  it('uses the CLOSED EventTypes union rather than a free-text event name', () => {
    // The union is what stops a typo'd name becoming a silently-empty metric.
    expect(route).toContain('EventTypes.ONBOARDING_STEP');
    expect(route).not.toMatch(/eventType:\s*['"]/);
  });
});

describe('the event records what we actually need', () => {
  it('captures which of the three doors was taken', () => {
    for (const c of ['explore_map', 'connect_mcp', 'personalize_company']) {
      expect(route).toContain(c);
      expect(page).toContain(c);
    }
  });

  it('captures the intent the user ARRIVED with', () => {
    // So "chose the map" is distinguishable from "was already headed there".
    expect(route).toContain('arrived_with_intent');
    expect(route).toContain('arrived_with_next');
  });

  it('records NO company data — only which door', () => {
    expect(route).not.toMatch(/description|company_name|naics/i);
  });

  it('rejects an unknown choice rather than storing it', () => {
    expect(route).toContain("CHOICES.includes(choice)");
  });
});

describe('telemetry failure is never the user\'s problem', () => {
  it('an anonymous visitor is a recorded state, not a dropped one', () => {
    // Dropping anonymous events would bias the very measurement we want.
    expect(route).toContain("reason: 'anonymous'");
  });

  it('a logEngagement failure is surfaced in logs, not swallowed silently', () => {
    // logEngagement RESOLVES {success:false} rather than throwing — a .catch() would be
    // dead code and the failure invisible.
    expect(route).toContain('if (!res.success)');
  });

  it('an exception still returns 200 — telemetry is not a user-facing error', () => {
    const c = route.slice(route.indexOf('catch (err)'));
    expect(c).not.toMatch(/status:\s*5\d\d/);
  });
});
