/**
 * Unit test for the recompete Share → reload round-trip (gap 1).
 *
 * The Share button must emit ?recompete=<id> for a recompete (not ?opp=<piid>, which 404s through
 * the open-opp fetch), and a ?recompete= boot deep-link handler must switch to the Awarded dataset
 * and open that recompete's drawer — mirroring the ?company= / ?buyer= handlers. These live as
 * inline JS inside route.ts's injected script strings (not extractable as pure functions), so this
 * asserts the SHIPPED wiring is present + that the regex the boot handler uses actually matches a
 * ?recompete= URL (the round-trip both directions).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('recompete Share/deep-link round-trip (gap 1)', () => {
  it('the Share button branches on kind===recompete to emit ?recompete=', () => {
    // The _share handler's _pk ternary must include the recompete case.
    expect(routeSrc).toMatch(/CUR\.kind==='recompete'\)\?'recompete'/);
  });

  it('a ?recompete= boot deep-link handler exists and switches the dataset', () => {
    expect(routeSrc).toContain("(location.search||'').match(/[?&]recompete=([^&]+)/)");
    // It must switch to the recompete mode and call openRecompeteDrawer.
    expect(routeSrc).toMatch(/window\.setMapMode\('recompete'\)/);
    expect(routeSrc).toMatch(/window\.openRecompeteDrawer\(rid\)/);
  });

  it('the boot regex actually matches a ?recompete= URL (extracts the id)', () => {
    const re = /[?&]recompete=([^&]+)/;
    const m = '/opportunity-map?recompete=W912PL21C0001'.match(re);
    expect(m && decodeURIComponent(m[1])).toBe('W912PL21C0001');
    // and does NOT fire on a plain ?opp= URL
    expect('/opportunity-map?opp=abc'.match(re)).toBeNull();
  });

  it('the recompete drawer CUR carries kind:recompete + a live uiLink (gaps 1/2)', () => {
    expect(routeSrc).toMatch(/CUR=\{ kind:'recompete'/);
    expect(routeSrc).toMatch(/uiLink:usaspendingUrlForRecompete\(o\)/);
  });
});
