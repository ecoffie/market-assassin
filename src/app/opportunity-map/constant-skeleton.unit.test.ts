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
  it('Contract history, Buyer intelligence, and Market pricing each have an else placeholder', () => {
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

describe('Zillow price-placement — M-Estimate leads the drawer, methodology lower, NO duplicate', () => {
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
  it('the DUPLICATE M-Estimate is gone — the big number renders ONCE (top slot only)', () => {
    // Eric 2026-08-02: "Remove the duplicate M-Estimate… keep ONLY the top one." The lower
    // methodology section must NOT re-print the big median number (vr-sec-big) — it opens with the
    // RANGE + chart + how-we-calculate instead. vr-sec-big must appear nowhere in the source.
    expect(src).not.toContain('vr-sec-big');
    // The lower section still carries the range (vr-band), chart, and methodology, together, at 'mest'.
    expect(src).toMatch(/vr-band[\s\S]*vrChart\(vr\.distribution,vr\.median\)[\s\S]*How we calculate this[\s\S]*'mest'\)/);
    // The TOP header is the single headline number ALONE — NO band, NO chart.
    const topFn = src.slice(src.indexOf('function mEstTopHTML(vr)'), src.indexOf('function mEstMethodologyHTML(vr)'));
    expect(topFn).not.toContain('vrChart');
    expect(topFn).not.toContain('vr-band');
    expect(topFn).toContain('vr-big'); // the single headline number lives here
  });
  it('the top price header is ALWAYS filled after the intel fetch (success AND failure)', () => {
    expect(src).toMatch(/fillMEstTop\(intel\.valueRange\)/);   // success path
    expect(src).toMatch(/catch\(function\(\)\{ fillMEstTop\(null\)/); // failure path
  });
  it('the "Value" tab targets the top price and the lower Estimated-value tab exists', () => {
    expect(src).toMatch(/\['value','Value'\]/);
    expect(src).toMatch(/\['mest','Est\. value'\]/);
  });
});

describe('The LISTING decision-flow order (Eric 2026-08-02)', () => {
  // Slice the whole render() body (it opens with a long flow-doc comment, so the return's calls sit
  // ~2.5k chars in) up to the next function definition, so indexOf compares real emit order.
  const rStart = src.indexOf('function render(o,extra)');
  const body = src.slice(rStart, src.indexOf('\n  function ', rStart + 20));
  const at = (s: string) => body.indexOf(s);
  it('Should-I-pursue (ai) comes BEFORE the opportunity-intel facts', () => {
    // The decision is promoted to the top of the flow, above the detail.
    expect(at('aiSec(o)')).toBeGreaterThan(-1);
    expect(at('aiSec(o)')).toBeLessThan(at('bidFactsSec(extra.bidFacts,o)'));
  });
  it('Related opportunities (similar) comes BEFORE the action bar (above the paperwork)', () => {
    expect(at('similarSec(extra.similar)')).toBeLessThan(at('actions(o)'));
  });
  it('the section RENAMES are in place (no old labels)', () => {
    // The drawer JS is a template-literal emitted to the browser, so its unicode escapes are
    // DOUBLE-backslashed in source (\\uXXXX). Assert on the plain-text portions of each heading.
    expect(src).toContain('Should I pursue this?');   // was "AI analysis · Go / No-Go"
    expect(src).toContain("sec('Opportunity intelligence'"); // was "Bid facts"
    expect(src).toContain("sec('Opportunity summary'");      // was "Description"
    expect(src).toContain('Market pricing');          // was "Pricing intel"
    expect(src).toContain('Buyer intelligence');      // was "Know your buyer · agency intel"
    expect(src).toContain('Decision makers');         // was "Other contacts at this agency"
    expect(src).toContain("sec('Related opportunities'"); // was "Similar opportunities"
    expect(src).toContain("var head='Teaming opportunities'"); // was "Subcontract targets nearby"
    expect(src).toContain('>Start pursuit<');         // was "Save to pursuits"
    expect(src).toContain('Win this contract');       // was "Draft proposal"
    // The retired OPEN-opp labels must be gone. (The DLA/DIBBS quote drawer is a separate variant —
    // a priced NSN quote, not a SAM listing — and is intentionally out of this reorder's scope, so
    // its own 'Bid facts'/'Save to pursuits' strings are not asserted against here.)
    expect(src).not.toContain("sec('Description'");
    expect(src).not.toContain("sec('Similar opportunities'");
    expect(src).not.toContain('Subcontract targets nearby');
  });
});

describe('GOS #10 — content sections that can have data always render', () => {
  it('Scope of work + Related opportunities render a placeholder when empty', () => {
    expect(src).toContain('No scope-of-work text has been extracted');
    expect(src).toContain('No related open opportunities found');
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
