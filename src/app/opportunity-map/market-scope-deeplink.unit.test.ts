/**
 * "Back to map" from a Market report opened the UNFILTERED map.
 *
 * The Market sub-view emits a scope round-trip — /opportunity-map?q=&naics=&psc=&agency=
 * &setAside=&state= (market/route.ts backHref, commented "so Market <-> Map is a round trip")
 * — plus a browse hub whose every row links ?agency=<name> or ?naics=<code>, commented
 * "Each row deep-links BACK INTO THE MAP so the user stays in the map app". The map read
 * NONE of those params: measured 2026-08-15, baseline / ?agency=DEPT%20OF%20DEFENSE /
 * ?naics=311999 all returned an identical 145,775 results.
 *
 * These are three shipped, user-facing links, so this is emphatically NOT code without a
 * caller — the reason an earlier pass deferred agency/naics was that it only checked /today,
 * where a four-section cut (PR #1122) had removed the emitters.
 *
 * The fix reuses __applySavedSearch — the SAME restorer ?ss= and the in-map picker use — by
 * synthesizing a {mode, filters, bbox} object from the URL. One definition of "apply a set of
 * filters", so URL params and saved-search JSON cannot drift into two vocabularies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const market = readFileSync(join(__dirname, 'market/route.ts'), 'utf8');

describe('the map reads the scope params the Market surface emits', () => {
  it('parses every param backHref() can emit', () => {
    // The handler reads params through one shared P(k) helper rather than six inline regexes,
    // so assert on the extracted NAMES, not on a literal '[?&]q=' that never appears in source.
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    const read = handler.slice(0, handler.indexOf('if(!agency'));
    for (const p of ['q', 'naics', 'psc', 'agency', 'setAside', 'state']) {
      expect(read, `?${p}= must be read at map boot`).toContain(`P('${p}')`);
    }
    // And the reader must be a real URL parse, not a stub.
    expect(read).toContain('location.search');
  });

  it('routes them through __applySavedSearch, not a second filtering path', () => {
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    expect(handler).toContain('__applySavedSearch');
    // A hand-rolled FILT write here would be the lib-duplicate drift bug this repo keeps hitting.
    expect(handler.slice(0, 3000)).not.toMatch(/FILT\.\w+\s*=/);
  });

  it('resolves an agency DISPLAY NAME to its ilike needle', () => {
    // The hub emits "Department of Defense" but FILT.agency holds match needles ('DEFENSE').
    // Passing the display name straight through would filter to zero pins.
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    expect(handler).toContain('__AGENCY_PRESETS');
  });

  it('still has the Market emitters this exists to serve (both ends pinned)', () => {
    expect(market).toContain("'/opportunity-map'+(qs.length?'?'+qs.join('&'):'')");
    expect(market).toContain('/opportunity-map?agency=');
    expect(market).toContain('/opportunity-map?naics=');
  });

  it('retries until the restorer exists, so a cold load does not silently no-op', () => {
    // The worst failure mode: the handler runs before map boot defines __applySavedSearch,
    // does nothing, and only ever fails on a cold load. ?ss= and ?opp= both retry; so must this.
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    expect(handler).toMatch(/setTimeout\(\s*go\s*,/);
  });

  it('ships no regex literal in the handler — a template-literal escaping trap', () => {
    // This cost a wrong verdict. `replace(/\\+/g,' ')` written here is inside a TS template
    // literal, so the escape was consumed and the browser received `/+/g` — "Nothing to
    // repeat", a SyntaxError that killed the whole IIFE at parse time. try/catch cannot save
    // you: a syntax error in emitted script is not catchable at runtime. The unit test passed
    // (the source string was present) while the feature did nothing on a real page.
    // Use split()/join() for literal replacement here rather than a regex.
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    const body = handler.slice(0, handler.indexOf("__applySavedSearch({"));
    expect(body).not.toMatch(/replace\(\s*\//);
    expect(body).toContain("split('+').join(' ')");
  });

  it('applies nothing when no scope param is present (no fabricated filter)', () => {
    const handler = map.slice(map.indexOf('// Deep-link: scope params'));
    expect(handler).toMatch(/if\s*\(\s*!\s*\w+\s*\)\s*return/);
  });
});
