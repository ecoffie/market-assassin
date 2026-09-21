import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Basemap keyless default (2026-08-27). CARTO's keyless cartocdn raster endpoint started
// returning HTTP 200 PNGs with a burned-in "API KEY REQUIRED" watermark. Leaflet treats
// those loads as success (tileload), so the tileerror failover to OpenTopo/OSM never ran
// and production stayed on watermarked tiles indefinitely. Guard: every PROVIDERS entry
// must declare keyless:true, the default (index 0) must not be a keyed host, attribution
// must match the selected host, and no credential literals may appear in the template.

const dir = __dirname;
const tmpl = readFileSync(join(dir, 'template.html'), 'utf8');
const served = readFileSync(join(dir, 'template-html.ts'), 'utf8');

const KEYED_HOST_RE = /basemaps\.cartocdn\.com|api\.mapbox\.com|tile\.maptiler\.com|tiles\.stadiamaps\.com/i;
const SECRET_LITERAL_RE =
  /(?:api[_-]?key|access[_-]?token|mapbox|carto)[\s"'`:=]+[A-Za-z0-9_\-]{16,}/i;

function parseProviders(src: string): Array<{ name: string; url: string; attr: string; keyless: boolean }> {
  const block = src.match(/const PROVIDERS=\[([\s\S]*?)\];/);
  expect(block, 'PROVIDERS array missing').toBeTruthy();
  const entries = [...block![1].matchAll(/\{name:'([^']+)',\s*url:'([^']+)',[\s\S]*?attr:'([^']+)',\s*keyless:(true|false)\}/g)];
  expect(entries.length, 'expected at least one PROVIDERS entry').toBeGreaterThan(0);
  return entries.map((m) => ({
    name: m[1],
    url: m[2],
    attr: m[3],
    keyless: m[4] === 'true',
  }));
}

describe('opportunity-map basemap defaults to a keyless provider (no silent watermarked 200)', () => {
  it('boots on a keyless primary and never includes a keyed host without keyless:false skip', () => {
    const providers = parseProviders(tmpl);
    expect(providers[0].keyless).toBe(true);
    expect(providers[0].url).not.toMatch(KEYED_HOST_RE);
    for (const p of providers) {
      expect(p.keyless, `${p.name} must set keyless`).toBe(true);
      expect(p.url, `${p.name} must not use a keyed basemap host`).not.toMatch(KEYED_HOST_RE);
    }
    expect(tmpl).toMatch(/while\(idx<PROVIDERS\.length && !PROVIDERS\[idx\]\.keyless\)/);
  });

  it('attribution matches the selected primary tile host', () => {
    const primary = parseProviders(tmpl)[0];
    if (primary.url.includes('openstreetmap.org')) {
      expect(primary.attr).toMatch(/OpenStreetMap/);
      expect(primary.attr).not.toMatch(/CARTO/i);
    } else if (primary.url.includes('opentopomap.org')) {
      expect(primary.attr).toMatch(/OpenTopoMap/);
      expect(primary.attr).toMatch(/OpenStreetMap/);
    } else {
      throw new Error(`unexpected primary host in ${primary.url}`);
    }
  });

  it('contains no credential literals in source or served template bundle', () => {
    expect(tmpl).not.toMatch(SECRET_LITERAL_RE);
    expect(served).not.toMatch(SECRET_LITERAL_RE);
    expect(tmpl).not.toMatch(/\?key=/i);
    expect(tmpl).not.toMatch(/access_token=/i);
  });

  it('refuses to silently keep a non-keyless provider when a keyless fallback exists', () => {
    // mountTiles must skip !keyless entries before attaching a layer. A watermarked keyed
    // provider that still returns HTTP 200 can never become the active boot layer.
    expect(tmpl).toMatch(/while\(idx<PROVIDERS\.length && !PROVIDERS\[idx\]\.keyless\) idx\+\+/);
    expect(tmpl).toMatch(/if\(idx>=PROVIDERS\.length\)/);
    const providers = parseProviders(tmpl);
    expect(providers.some((p) => p.keyless)).toBe(true);
  });
});
