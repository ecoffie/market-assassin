/**
 * GOS invariant #10 — the drawer skeleton is CONSTANT: the intel/content sections that CAN carry
 * data always render (header + a muted placeholder when empty), never collapse. This guards the
 * wiring in route.ts's injected drawer JS so a future edit can't silently reintroduce a vanishing
 * section (which reads as a bug + makes buildTabs non-deterministic).
 *
 * It asserts on the SHIPPED source: every "always-render" section must have an else-branch that
 * emits sec(<header>, empty(...)/placeholder, <anchor>), and the on-demand intel fetches must call
 * renderIntel/renderRecompeteIntel with {} (not '') on a miss so the skeleton survives a failed fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('GOS #10 — open-opp drawer intel sections always render', () => {
  it('renderIntel takes {} (never returns "" on missing intel)', () => {
    expect(src).toMatch(/function renderIntel\(intel\)\{\s*intel=intel\|\|\{\};/);
  });
  it('M-Estimate top price header handles no-median honestly (never hidden)', () => {
    expect(src).toContain('No estimate');
    expect(src).toContain('too few comparable federal awards for this NAICS');
  });
  it('Contract history, Know your buyer, and Pricing each have an else placeholder', () => {
    expect(src).toContain('No incumbent identified for this requirement');
    expect(src).toContain('Agency intel not available');
    expect(src).toContain('Pricing data not available for this NAICS');
  });
  it('the BD roster always renders a placeholder (no agency / not signed in / empty)', () => {
    expect(src).toContain('Sign in to see other contacts at this agency');
    expect(src).toContain('No additional contacts found');
    expect(src).toMatch(/function rosterPlaceholder\(box,msg\)/);
  });
  it('the intel fetch renders renderIntel({}) on a miss, not an empty string', () => {
    // success → x.intel, else {} — the skeleton survives an empty/failed fetch.
    expect(src).toMatch(/var intel=\(x&&x\.success\)\?x\.intel:\{\};/);
    expect(src).toMatch(/box\.innerHTML=renderIntel\(\{\}\); buildTabs\(\); loadRoster/);
  });
});

describe('Zillow price-placement — M-Estimate leads the drawer, methodology lower', () => {
  it('a #mEstTop price slot leads the drawer body (right after overview)', () => {
    // The slot is rendered in render() before bidFactsSec, and carries the osec-value anchor.
    expect(src).toMatch(/id="mEstTop">.*vrange vrange-top.*id="osec-value"/s);
    // render() emits the slot before the bid-facts section (price is the FIRST prominent thing).
    const body = src.slice(src.indexOf('function render(o,extra)'));
    const topIdx = body.indexOf("id=\"mEstTop\"");
    const factsIdx = body.indexOf('bidFactsSec(extra.bidFacts,o)');
    expect(topIdx).toBeGreaterThan(-1);
    expect(topIdx).toBeLessThan(factsIdx);
  });
  it('the top header is the big number + band (mEstTopHTML); methodology is a separate lower helper', () => {
    expect(src).toMatch(/function mEstTopHTML\(vr\)/);
    expect(src).toMatch(/function mEstMethodologyHTML\(vr\)/);
    // The chart + how-we-calculate live in the LOWER methodology section (anchor 'mest'), NOT the top.
    expect(src).toMatch(/vrChart\(vr\.distribution,vr\.median\)[\s\S]*How we calculate this[\s\S]*'mest'\)/);
    // The top header does NOT include the chart (price only + band).
    const topFn = src.slice(src.indexOf('function mEstTopHTML(vr)'), src.indexOf('function mEstMethodologyHTML(vr)'));
    expect(topFn).not.toContain('vrChart');
  });
  it('the top price header is ALWAYS filled after the intel fetch (success AND failure)', () => {
    expect(src).toMatch(/fillMEstTop\(intel\.valueRange\)/);   // success path
    expect(src).toMatch(/catch\(function\(\)\{ fillMEstTop\(null\)/); // failure path
  });
  it('the "Value" tab targets the top price and a separate "How we estimate" tab exists', () => {
    expect(src).toMatch(/\['value','Value'\]/);
    expect(src).toMatch(/\['mest','How we estimate'\]/);
  });
});

describe('GOS #10 — content sections that can have data always render', () => {
  it('Scope of work + Similar opportunities render a placeholder when empty', () => {
    expect(src).toContain('No scope-of-work text has been extracted');
    expect(src).toContain('No similar open opportunities found');
  });
});

describe('GOS #10 — Awarded / Company / Buyer drawers apply the same rule', () => {
  it('renderRecompeteIntel takes {} and always renders agency intel + pricing', () => {
    expect(src).toMatch(/function renderRecompeteIntel\(intel\)\{\s*intel=intel\|\|\{\};/);
  });
  it('company sections render placeholders when empty', () => {
    expect(src).toContain('No agency award breakdown on file');
    expect(src).toContain('No NAICS breakdown on file');
    expect(src).toContain('No similar firms found for this NAICS');
  });
  it('buyer similar + roster render placeholders when empty', () => {
    expect(src).toContain('No other decision-makers found at');
  });
});
