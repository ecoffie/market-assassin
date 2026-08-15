/**
 * GUARD — the ?embed=1 map must ship the LOCATION BOOT logic, with its data substituted.
 *
 * Eric 2026-08-15, on the /today hero showing an empty national map: *"I thought zoom uses geo
 * location to find the people location to track better."* It does — and I was wrong twice before
 * measuring. The map has a four-tier cascade (last view → IP state → CONUS → navigator.geolocation,
 * plus /api/app/map-home for signed-in users). The bug was that the EMBED never received it.
 *
 * TWO defects, and fixing only the first proves nothing:
 *   1. BOOT_VIEW_JS lived in `bodyInject`, which the `if (embed)` branch never runs.
 *   2. Shipping the script alone is WORSE than not shipping it: it carries five `__PLACEHOLDER__`
 *      tokens the non-embed branch substitutes, so the embed emitted
 *      `window.__STATE_CENTROIDS=__STATE_CENTROIDS__` — a SyntaxError that kills the whole boot
 *      script silently. Measured: all five placeholders shipped literally.
 *
 * Why it matters beyond looks: a national frame of ~145,775 opportunities draws ~50 lonely dots and
 * reads as "they don't have much data" — the opposite of true. The same map on one metro shows 734
 * with dollar values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
/** The `if (embed) { … }` branch only. */
const EMBED_BRANCH = SRC.slice(SRC.indexOf('if (embed) {'), SRC.indexOf('  } else {', SRC.indexOf('if (embed) {')));

describe('?embed=1 ships the location boot cascade', () => {
  it('read the real route (a vacuous pass would hide every assertion below)', () => {
    expect(SRC.length).toBeGreaterThan(50_000);
    expect(EMBED_BRANCH.length).toBeGreaterThan(200);
  });

  it('injects BOOT_VIEW_JS into the BODY — without it the embed can only ever show CONUS', () => {
    // ⚠️ Assert the actual INJECTION LINE, not merely that the identifier appears somewhere in the
    // branch. A first version of this test checked `EMBED_BRANCH.toContain('BOOT_VIEW_JS')` and
    // PASSED when the injection was deleted — the surrounding explanatory comment still mentioned
    // the name. inject→red→revert→green is the only way that showed up.
    expect(EMBED_BRANCH).toMatch(/repl\(html,\s*'<\/body>',\s*BOOT_VIEW_JS\s*\+/);
  });

  it('substitutes EVERY placeholder BOOT_VIEW_JS carries', () => {
    // Each unsubstituted token is a SyntaxError that silently disables the whole cascade.
    for (const token of ['__STATE_CENTROIDS__', '__IP_STATE__', '__INDUSTRY_PRESETS__', '__AGENCY_PRESETS__', '__FSC_PRESETS__']) {
      expect(EMBED_BRANCH, `embed never substitutes ${token}`).toContain(token);
    }
    expect(EMBED_BRANCH).toContain('JSON.stringify(STATE_CENTROIDS)');
  });

  it('derives the IP state from the edge header, clamped to two letters', () => {
    // Never interpolate a raw header into a JS string literal.
    expect(EMBED_BRANCH).toContain('x-vercel-ip-country-region');
    expect(EMBED_BRANCH).toMatch(/\/\^\[A-Z\]\{2\}\$\//);
    expect(EMBED_BRANCH).toContain('STATE_CENTROIDS[ipRegionE]');
  });

  it('the cascade itself still exists in BOOT_VIEW_JS (all four tiers)', () => {
    for (const tier of ['lastView', '__IP_STATE', 'conus', 'navigator.geolocation']) {
      expect(SRC, `boot cascade lost its ${tier} tier`).toContain(tier);
    }
  });
});
