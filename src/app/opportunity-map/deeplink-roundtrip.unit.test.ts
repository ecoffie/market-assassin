import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A LINK THE PRODUCT EMITS MUST RESTORE THE STATE IT CLAIMS.
 *
 * Report links flattened a saved search's filter object into query params, while the map parses
 * an allow-list with its own names. Two independent definitions of one contract, so they drifted.
 *
 * MEASURED ON PRODUCTION 2026-08-23, by driving real URLs in a browser and watching which
 * params reached /api/app/opportunity-map:
 *
 *   naics=541512      -> naics          reached the API
 *   posted=7          -> postedDays     reached the API
 *   q=cyber           -> q              reached the API
 *   postedDays=7      -> (none)         DROPPED — and this is what the emitter actually sent
 *   horizons=...      -> (none)         DROPPED — and stringified to [object Object] first
 *   valueRange=...    -> (none)         DROPPED
 *   setAsideMulti=... -> (none)         DROPPED
 *   scope=profile     -> (none)         DROPPED
 *
 * 37 of 42 live saved searches carry `horizons`, so most report links shipped garbage in them
 * and lost the user's date window on top.
 *
 * That is ONE architectural bug, not six: the emitter and receiver each defined the contract.
 * The fix makes the saved search itself the contract — ?ss=<id>, resolved through the same
 * __applySavedSearch normalization the Saved panel uses.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const REPORTS = read('src/app/opportunity-map/reports/route.ts');
const MAP = read('src/app/opportunity-map/route.ts');

describe('report links reference the saved search, not a flattened copy', () => {
  it('emits ?ss=<id>', () => {
    expect(REPORTS).toMatch(/'\/opportunity-map\?ss='\s*\+\s*encodeURIComponent\(String\(r\.id\)\)/);
  });

  it('no longer serialises every key of the stored filter object', () => {
    // The line that caused all six symptoms: Object.keys(f).forEach(... String(v) ...).
    // String() on the horizons object is where [object Object] came from.
    expect(REPORTS).not.toMatch(/Object\.keys\(f\)\.forEach/);
    expect(REPORTS).not.toMatch(/encodeURIComponent\(String\(v\)\)/);
  });

  it('still carries mode, which selects the dataset and is not part of the filter set', () => {
    expect(REPORTS).toMatch(/mode=recompete/);
  });

  it('falls back to a plain map rather than a link that pretends to be filtered', () => {
    // No id → '/opportunity-map'. Never a half-applied filter.
    expect(REPORTS).toMatch(/return '\/opportunity-map';/);
  });
});

describe('the ?ss= receiver is the single normalization point', () => {
  it('resolves the id against the user\'s own saved searches', () => {
    expect(MAP).toMatch(/\[\?&\]ss=\(\[\^&\]\+\)/);
    expect(MAP).toContain('/api/app/saved-searches?email=');
  });

  it('routes through __applySavedSearch — the same path the Saved panel uses', () => {
    // This is what makes ?ss= drift-proof: one function defines what a saved filter MEANS.
    expect(MAP).toContain('window.__applySavedSearch(ss)');
  });

  it('never fabricates a filter for a deleted or foreign id', () => {
    expect(MAP).toMatch(/if\(!ss\)return;/);
  });

  it('leaves the map on its default when signed out', () => {
    // A signed-out visitor cannot resolve the id, and a silently-unfiltered map claiming to be
    // filtered is the failure this whole PR is about.
    expect(MAP).toMatch(/if\(!em\|\|!tk\)return;/);
  });
});

describe('legacy parameterised links stay readable', () => {
  // Links already in the wild must not break. But no NEW code emits this shape — extending it
  // would preserve the architecture that caused the drift.
  it('the map still parses the scope params it always understood', () => {
    expect(MAP).toMatch(/Deep-link: scope params/);
  });

  it('posted= remains the parsed name — do NOT rename to postedDays to "match" the old emitter', () => {
    // The emitter was wrong, not the receiver. Renaming here would break every legacy link
    // that currently works.
    expect(MAP).toContain('FILT.postedDays');
  });
});
