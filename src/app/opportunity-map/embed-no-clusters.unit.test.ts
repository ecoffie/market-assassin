/**
 * Eric: "we agreed to remove clusters" — applied to the EMBED too (2026-08-16).
 *
 * The embed clustered because of #1139 six days earlier, which was itself a response to the same
 * "the map looks empty" complaint. That commit measured the cause: the embed's 600 opportunities
 * collapse onto 76 distinct coordinates, with 403 of them (67%) stacked on ONE pixel over
 * Columbus OH — DLA parts buys pinned to the buying depot because SAM publishes no
 * place-of-performance (397 of 400 sampled have pop_state NULL). Clustering made that stack
 * legible; it did not invent density.
 *
 * ⚠️ SO THIS IS A DELIBERATE TRADE, NOT A BUG FIX. Eric's call, made with that measurement in
 * hand. Without clustering those 403 render as a single indistinguishable dot again.
 *
 * ⚠️⚠️ THE TRAP: clustering and the PIN FLOOR are driven by the SAME flag. `PIN_DOT_ZOOM` is 0 in
 * the embed and 5 everywhere else, and the embed boots at CONUS zoom 4.5 — so simply turning
 * __EMBED_CLUSTER__ off would make pinTooFar() true and render ZERO pins behind a "zoom in"
 * prompt (route.ts ~895 documents exactly this). Clusters must go WITHOUT taking the floor with
 * them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('the embed draws pins, not clusters', () => {
  it('disables clustering in the embed', () => {
    // CLUSTER_MAX_ZOOM 0 = never cluster, the same value the interactive map uses.
    expect(map).toMatch(/var CLUSTER_MAX_ZOOM\s*=\s*0\s*;/);
    expect(map).not.toMatch(/CLUSTER_MAX_ZOOM\s*=\s*\(\s*_EMBCL\s*\?\s*12/);
  });

  it('KEEPS the embed pin floor at 0 — the map boots at zoom 4.5', () => {
    // If this becomes 5 in the embed, pinTooFar() is true at 4.5 and the map renders NOTHING
    // behind a "zoom in to see pins" prompt. That is the failure this test exists to prevent.
    expect(map).toMatch(/var PIN_DOT_ZOOM\s*=\s*\(\s*_EMBCL\s*\?\s*0\s*:\s*5\s*\)/);
  });

  it('still ships the pin runtime to the embed (#1139 fix must not regress)', () => {
    // PIN_JS was once concatenated only on the non-embed branch, so every typeof guard silently
    // took a fallback: no mkPin, raw circle markers, nothing logged.
    expect(map).toContain('__EMBED_CLUSTER__');
  });
});
