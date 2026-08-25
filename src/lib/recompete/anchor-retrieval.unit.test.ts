/**
 * NS-2 — a company's own contract vehicles must be REACHABLE.
 *
 * Fixture: NORTH STAR GOVERNMENT SERVICES, NAICS 236220, 18-month window.
 * MEASURED 2026-08-25: 6,864 contracts qualify, the tool returns 50 ordered by soonest
 * expiry, and North Star's OWN SABER task order FA461025F0190 ranks ~568 of 6,864 — cut.
 * The 50th row expired the NEXT DAY; the window is so crowded the cut lands one day out.
 *
 * Nothing about the COMPANY entered retrieval, so its own vehicle could not surface and
 * the decision layer never got to reason about it. Same class as DEFECT-9B.
 *
 * ⚠️ Anchoring changes what is RETRIEVABLE, never what is ELIGIBLE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/recompete/query.ts', 'utf8');
/** Strip comments — a fix that QUOTES the pattern while explaining it must not self-satisfy. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('NS-2 — anchored retrieval', () => {
  it('exposes anchorPiidPrefixes on the query contract', () => {
    expect(code).toMatch(/anchorPiidPrefixes\?\s*:\s*string\[\]/);
  });

  it('runs a SECOND scoped query rather than widening the first', () => {
    // The anchor must be its own query. Loosening the primary filter would change
    // eligibility for every caller, which is the opposite of the intent.
    expect(code).toMatch(/like\('piid',\s*`\$\{prefix\}%`\)/);
  });

  it('applies the SAME window bounds to anchored rows', () => {
    const anchorBlock = code.slice(code.indexOf('anchors.length'));
    expect(anchorBlock).toContain('todayStr');
    expect(anchorBlock).toContain('maxStr');
  });

  it('applies the SAME naics narrowing to anchored rows', () => {
    const anchorBlock = code.slice(code.indexOf('anchors.length'));
    expect(anchorBlock).toMatch(/naics_code/);
  });

  it('validates prefixes rather than interpolating raw input', () => {
    expect(code).toMatch(/\/\^\[A-Z0-9\]\{4,10\}\$\//);
  });

  it('bounds how many anchors one call may run', () => {
    expect(code).toMatch(/anchors\.slice\(0,\s*\d+\)/);
  });

  it('dedupes against the primary result set', () => {
    const anchorBlock = code.slice(code.indexOf('anchors.length'));
    expect(anchorBlock).toMatch(/seen\.has\(row\.contract_id\)/);
  });

  it('a FAILED anchor lookup is logged, never silently dropped', () => {
    const anchorBlock = code.slice(code.indexOf('anchors.length'));
    expect(anchorBlock).toMatch(/anchor lookup failed/);
  });

  it('does not hardcode FA4610 or any specific vehicle', () => {
    const anchorBlock = code.slice(code.indexOf('anchors.length'), code.indexOf('anchors.length') + 2000);
    expect(anchorBlock).not.toMatch(/FA4610/);
  });
});
