import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Zero" must never be how a failure looks.
 *
 * A failed query and a genuinely empty result render identically, so a user cannot tell them
 * apart — and every one of these had a real consequence:
 *
 *  - market-scanner rendered "Total Market $0/year" and then SNAPSHOTTED it as last-good,
 *    replayed for hours under an "as of {time}" banner. A transient 429 became durable data.
 *  - profile-stats rendered "0 opportunities match your profile" on a query error.
 *  - send-email treated a failed suppression lookup as "not suppressed" and mailed someone
 *    who had unsubscribed.
 *
 * Source-level guards: reaching these needs a live upstream failure.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('market-scanner never snapshots a fabricated scan', () => {
  const SRC = strip(read('src/app/api/market-scanner/route.ts'));

  it('gates saveSnapshot on a clean scan', () => {
    // The bug: the inner catch swallowed, so the outer isUpstreamOutage() guard never fired
    // and line 773 persisted the all-zero payload as last-good.
    expect(SRC).toMatch(/if \(!scanDegraded\) \{[\s\S]{0,120}saveSnapshot\(/);
  });

  it('marks the scan degraded from every catch, not just one', () => {
    // Seven catch blocks can each fabricate. Missing one leaves the hole open.
    const marks = SRC.match(/markScanDegraded\(/g) || [];
    expect(marks.length).toBeGreaterThanOrEqual(8); // 7 call sites + the definition
  });

  it('resets the flag per request — a warm lambda serves many scans', () => {
    expect(SRC).toMatch(/scanDegraded = false;/);
  });

  it('tells the caller, so a UI can label rather than assert', () => {
    expect(SRC).toMatch(/scanDegraded \? \{ degraded: true \}/);
  });
});

describe('profile-stats binds the error on every count', () => {
  const SRC = strip(read('src/app/api/briefings/profile-stats/route.ts'));

  it('has no bare `count || 0` left', () => {
    // Five of them rendered "0 opportunities match your profile" on failure.
    const bare = SRC.match(/const \{ count \} = await query;/g) || [];
    expect(bare).toEqual([]);
  });

  it('binds countErr at every call site', () => {
    const bound = SRC.match(/if \(countErr\) statsDegraded = true;/g) || [];
    expect(bound.length).toBe(5);
  });
});

describe('email suppression fails CLOSED', () => {
  const SRC = strip(read('src/lib/send-email.ts'));

  it('refuses to send when the suppression lookup fails', () => {
    // Asymmetric risk: skipping one email to someone who was probably fine costs almost
    // nothing; mailing someone who asked us to stop costs the sender reputation.
    expect(SRC).toContain("if (suppErr) return 'suppression_check_failed'");
  });

  it('keeps the daily CAP failing open — blocking a real alert is the worse error', () => {
    // Deliberately NOT symmetric with suppression. The cap is a courtesy; suppression is a
    // promise. Logged so a silent counting outage cannot look like "nobody hit the cap".
    expect(SRC).toMatch(/capErr[\s\S]{0,120}allowing send/);
    expect(SRC).not.toMatch(/if \(capErr\) return/);
  });
});
