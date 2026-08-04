/**
 * The M-Estimate PREDECESSOR sanity gate (Eric 2026-08-03, variance C). The matcher can find the
 * right WORK on a program that dwarfs a small buy — "Sole Source Teal Drones" matched Raytheon's
 * $1.06B drone program; "Drug Field Test Kits" a $1.35B award vs a $0.5M market. So a predecessor
 * anchors the M-Estimate ONLY when it's trustworthy: confidence not 'low' AND value within 10× the
 * comparable-award median; otherwise the estimate uses the comparable band (the honest market answer).
 * Source-assert (buildOppIntel makes live calls — the LOGIC is verified live in the session sweep).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'opp-intel.ts'), 'utf8');

describe('M-Estimate — predecessor sanity gate (variance C)', () => {
  it('requires the predecessor NOT be low-confidence', () => {
    expect(src).toContain("conf !== 'low'");
  });
  it('requires the predecessor be within 10× the comparable-award median (else use the band)', () => {
    expect(src).toContain('predVal <= cmpMed * 10');
    // when there is no comparable to check against, the predecessor is still allowed (only signal)
    expect(src).toContain('cmpMed == null || predVal <= cmpMed * 10');
  });
  it('falls through to the comparable band when the predecessor fails the gate', () => {
    expect(src).toContain('const predPlausible =');
    expect(src).toContain('if (predPlausible) {');
    // the comparable branch is still the fallback right after
    const gateIdx = src.indexOf('if (predPlausible)');
    const cmpIdx = src.indexOf("source: 'comparable_awards'", gateIdx);
    expect(cmpIdx).toBeGreaterThan(gateIdx);
  });
});
