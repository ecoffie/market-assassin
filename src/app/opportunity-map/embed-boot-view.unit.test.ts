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

/**
 * GUARD — the EMBED must ship the pin runtime, not just the map shell.
 *
 * `template.html` calls the PIN_JS helpers behind `typeof` guards:
 *   const _cl = (typeof clusterRows==='function') ? clusterRows(rows,map,64) : {singles:rows};
 *   const m   = (typeof mkPin==='function') ? mkPin(...) : L.circleMarker(...);
 *
 * PIN_JS was concatenated ONLY on the non-embed branch, so in the embed every one of those
 * guards quietly took the fallback: no clustering, no value tags, just raw circle markers. The
 * front page therefore rendered 600 real opportunities as ~35 visible dots — 600 DOM nodes
 * collapsed onto 76 coordinates, 403 of them (67%) stacked on ONE pixel over Columbus OH (DLA
 * parts buys with no place-of-performance, so the depot coordinate is the only honest one).
 *
 * ⚠️ THE LESSON: a `typeof` guard that degrades silently HIDES a missing dependency. Nothing
 * errored, nothing logged, every guard "passed" — the map just quietly rendered the dumb path.
 * These assertions make the dependency explicit so it cannot go missing again unnoticed.
 */
describe('the embed ships the pin runtime', () => {
  const src = SRC;
  // Anchor the end RELATIVE to the branch start — a bare indexOf finds the first
  // occurrence in the whole file, which sits far above and yields an empty slice.
  const _start = src.indexOf('if (embed) {');
  const embedBranch = src.slice(_start, src.indexOf('} else {', _start));

  it('injects PIN_JS (mkPin / clusterRows / pinFace) into the embed', () => {
    // Assert the CONCATENATION, not the bare token — the word PIN_JS also appears in the
    // explanatory comment here, so a substring check passes even with the injection deleted.
    // (Caught by inject-red: removing the injection left this test green.)
    const withComments = embedBranch.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(withComments).toContain("</script>' + PIN_JS)");
  });

  it('injects VTAG_CSS — the divIcons PIN_JS builds need those classes to be visible', () => {
    expect(embedBranch).toContain('VTAG_CSS');
  });

  it('turns clustering on for the embed only, leaving the interactive map alone', () => {
    expect(embedBranch).toContain('window.__EMBED_CLUSTER__=1;');
    // Interactive keeps the Zillow model chosen 2026-08-12 (thresholds fall back to 0/5).
    expect(src).toContain("var CLUSTER_MAX_ZOOM=(_EMBCL?12:0);");
    expect(src).toContain("var PIN_DOT_ZOOM=(_EMBCL?0:5);");
  });

  it('does NOT bubble single opportunities as "1"', () => {
    // REGIONAL_ZOOM must stay 0: above it a 1-member bucket is a single pin; setting it to 12
    // scattered tiny "1" circles nationwide — a bubble labelled 1 is a dot that learned to count.
    expect(src).toContain('var REGIONAL_ZOOM=0;');
  });
});
