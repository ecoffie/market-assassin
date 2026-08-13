/**
 * State filter showed "215 results" over an empty "No opportunities match" sidebar (Eric 2026-08-13).
 * Header used totalForFilters (ignores bbox); the list used pins clipped to the camera. PoP-state=MO
 * often geocodes to an office outside Missouri, so camera ∩ state returned 0 pins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('empty feed copy is honest when matches exist', () => {
  it('drawFeed does not say "No opportunities match" when OPPS already loaded', () => {
    const fn = tmpl.slice(tmpl.indexOf('function drawFeed(){'), tmpl.indexOf('function _showFetchError()'));
    expect(fn).toContain('(OPPS||[]).length');
    expect(fn).toContain('None of these match the list filters');
    const genuineEmpty = fn.slice(fn.indexOf('if((OPPS||[]).length)'));
    // the genuine-empty copy still exists, but only after the loaded-OPPS branch
    expect(genuineEmpty).toContain('No opportunities match');
  });
  it('wrapped render replaces an empty feed when TOTAL>0 (bbox miss, not "no match")', () => {
    expect(route).toContain("id=\"zoomOutMatches\"");
    expect(route).toContain('match your filters');
    expect(route).toContain('None of them are in this map view');
  });
  it('pass() does not reject a row with no service-line cat', () => {
    expect(tmpl).toContain('if(o.cat && !F.cat.has(o.cat))return false;');
    expect(tmpl).not.toMatch(/^\s*if\(!F\.cat\.has\(o\.cat\)\)return false;/m);
  });
});
