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
  it('M-Estimate has an else placeholder (no median → honest "No M-Estimate")', () => {
    expect(src).toContain('No M-Estimate');
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
