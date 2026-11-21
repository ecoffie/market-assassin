import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LEAFLET_BASE, LEAFLET_CSS_TAG, LEAFLET_JS_TAG, LEAFLET_VERSION } from './leaflet-assets';
import { OPPORTUNITY_MAP_TEMPLATE } from './template-html';

// Leaflet self-hosted (2026-11-21). The Map loaded leaflet.js/css from unpkg.com. When that
// host was blocked (corporate/agency proxy, script blocker, CDN outage) `L` was undefined,
// the template's main script died on `L.map(...)`, and the page stayed on "Building your
// market" forever: no pins, no list, no error, no retry. Reproduced locally with unpkg
// unreachable: "PAGEERR L is not defined" then "map is not defined" ×3.
//
// Guards:
//  1. The served template loads Leaflet only from our origin, exactly once each.
//  2. route.ts injects PIN_JS / EARLY_INJECT after LEAFLET_JS_TAG via a replace that is a
//     silent no-op when the anchor is missing — so the anchor must exist verbatim, and the
//     route must use the shared constant rather than a hand-typed URL.
//  3. Every file the page and leaflet.css reference is committed under public/.

const dir = __dirname;
const root = join(dir, '..', '..', '..');
const tmpl = readFileSync(join(dir, 'template.html'), 'utf8');
const route = readFileSync(join(dir, 'route.ts'), 'utf8');
const publicDir = join(root, 'public', ...LEAFLET_BASE.split('/').filter(Boolean));

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('Map loads Leaflet from its own origin', () => {
  it('references no third-party host for Leaflet', () => {
    for (const src of [tmpl, OPPORTUNITY_MAP_TEMPLATE, route]) {
      expect(src).not.toMatch(/unpkg\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet|cdn\.jsdelivr\.net\/npm\/leaflet/);
    }
  });

  it('serves exactly one Leaflet script and stylesheet, at the versioned self-hosted path', () => {
    for (const src of [tmpl, OPPORTUNITY_MAP_TEMPLATE]) {
      expect(count(src, LEAFLET_JS_TAG)).toBe(1);
      expect(count(src, LEAFLET_CSS_TAG)).toBe(1);
      expect(count(src, 'leaflet.js')).toBe(1);
    }
  });

  it('route.ts anchors its pin-script injections on the shared tag (both embed and full page)', () => {
    expect(route).toMatch(/import \{ LEAFLET_JS_TAG \} from '\.\/leaflet-assets'/);
    expect(route).toMatch(/repl\(html, LEAFLET_JS_TAG,\s*LEAFLET_JS_TAG \+ PIN_JS\)/);
    expect(route).toMatch(/repl\(html, LEAFLET_JS_TAG,\s*LEAFLET_JS_TAG \+ EARLY_INJECT \+ PIN_JS\)/);
    expect(route).not.toMatch(/<script src="[^"]*leaflet\.js"/);
  });

  it('commits the Leaflet files, images and license under public/', () => {
    expect(LEAFLET_BASE).toBe(`/vendor/leaflet/${LEAFLET_VERSION}`);
    for (const f of ['leaflet.js', 'leaflet.css', 'LICENSE']) {
      expect(existsSync(join(publicDir, f)), f).toBe(true);
    }
    const js = readFileSync(join(publicDir, 'leaflet.js'), 'utf8');
    expect(js).toContain(`Leaflet ${LEAFLET_VERSION}`);
    const css = readFileSync(join(publicDir, 'leaflet.css'), 'utf8');
    const urls = [...css.matchAll(/url\((?!#)([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(existsSync(join(publicDir, u)), u).toBe(true);
    // Leaflet's default marker images (resolved from the script's path at runtime).
    for (const f of ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']) {
      expect(existsSync(join(publicDir, 'images', f)), f).toBe(true);
    }
  });

  it('gives the versioned folder a long immutable cache', () => {
    const cfg = readFileSync(join(root, 'next.config.ts'), 'utf8');
    expect(cfg).toMatch(/source: '\/vendor\/leaflet\/:version\/:file\*',\s*headers: \[\{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' \}\]/);
  });
});
