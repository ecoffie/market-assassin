/**
 * GUARD — the /today → map handoff. `?opp=<notice_id>` must keep opening that notice's drawer.
 *
 * This is THE demo path (Eric, demo 2026-08-23): headline → Featured card → the real listing on
 * the map. It already worked when measured on prod 2026-08-15 — it was built for the Share link
 * and the Favorites page, and `/today` inherited it. Nothing asserted it, so a future edit to the
 * boot sequence could remove it and every Featured card would silently land on an unfiltered map.
 *
 * Source-level, no network: the handler is a self-invoking function inside the emitted JS string,
 * so the assertions pin its EXISTENCE and SHAPE. The behavioural proof is recorded in
 * tasks/demo-today-then-map-2026-08-15.md (drawer visibility + on-screen position, with vs
 * without the param) — that's a live-browser check, not something a unit test can do.
 *
 * ⚠️ If you verify this by hand, two traps that already cost a wrong diagnosis:
 *   1. `#mDrawer` is the MOBILE NAV drawer (display:none on desktop BY DESIGN) — not the listing
 *      drawer. The listing drawer is `#oppDrawer`.
 *   2. `#oppDrawer` is `display:flex` even when CLOSED; it hides via `visibility` + an off-screen
 *      `left`. Asserting on `display` passes in both states and proves nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

describe('map deep link — ?opp= opens the listing drawer', () => {
  it('read the real route (a vacuous pass would hide every assertion below)', () => {
    expect(SRC.length).toBeGreaterThan(50_000);
    expect(SRC).toContain('openOppDrawer');
  });

  it('parses ?opp= from location.search at boot', () => {
    // Client-side, NOT searchParams.get — that server parser only reads `embed`, and grepping it
    // is what produced the false "the map ignores every param" conclusion.
    expect(SRC).toMatch(/\[\?&\]opp=/);
  });

  it('calls openOppDrawer with the parsed notice id', () => {
    // Anchor on the HANDLER, not on a bare '[?&]opp=' substring: that string also appears in
    // the entry-point classifier (route.ts ~2728, which labels how a session arrived), so an
    // indexOf() slice silently grabbed the wrong block and reported this handler as broken
    // when it was untouched. Anchor on something only the handler has.
    const at = SRC.indexOf("match(/[?&]opp=([^&]+)/)");
    const handler = SRC.slice(at, at + 400);
    expect(handler).toContain('decodeURIComponent');
    expect(handler).toContain('openOppDrawer');
  });

  it('RETRIES until openOppDrawer exists — the drawer JS defines it asynchronously', () => {
    // Without the retry the handler races the map boot and silently no-ops on a cold load,
    // which would look like "the deep link is broken" only sometimes — the worst failure mode.
    // Anchor on the HANDLER, not on a bare '[?&]opp=' substring: that string also appears in
    // the entry-point classifier (route.ts ~2728, which labels how a session arrived), so an
    // indexOf() slice silently grabbed the wrong block and reported this handler as broken
    // when it was untouched. Anchor on something only the handler has.
    const at = SRC.indexOf("match(/[?&]opp=([^&]+)/)");
    const handler = SRC.slice(at, at + 400);
    expect(handler).toMatch(/tries\+\+|setTimeout/);
  });

  it('/today Featured cards emit the param this handler consumes (both ends agree)', () => {
    const intel = readFileSync(join(process.cwd(), 'src/lib/today/intel.ts'), 'utf8');
    expect(intel).toContain('/opportunity-map?opp=');
    expect(intel).toContain('encodeURIComponent');
  });
});
