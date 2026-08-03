import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A FAILED viewport fetch (network blip / mid-deploy chunk mismatch) must NOT render as a genuine
// "No opportunities match" / "0 results". Before this fix, every horizon's per-source .catch
// resolved to {pins:[],total:0} and the outer .catch silently cleared busy — so an all-failed
// fetch blanked the map to a fake empty-state (Eric hit it 3× mid-deploy, 2026-08-03).
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const mapRoute = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('Fetch failure is not a fake empty result', () => {
  it('a failed per-source fetch is TAGGED failed:true (distinct from a real empty result)', () => {
    // both the !success branch and the .catch on the opp fetch must stamp failed:true
    const oppBlock = mapRoute.slice(mapRoute.indexOf('_enabled.map(function(m)'));
    const failedTags = (oppBlock.match(/failed:true/g) || []).length;
    expect(failedTags).toBeGreaterThanOrEqual(2); // !success return + .catch return
  });

  it('when EVERY enabled horizon failed, the map does NOT blank — it shows the error, keeps last-good', () => {
    // the all-failed guard runs BEFORE OPPS is reassigned, and short-circuits (return)
    expect(mapRoute).toMatch(/_allFailed\s*=\s*parts\.length>0\s*&&\s*parts\.every\(function\(p\)\{return p&&p\.failed;\}\)/);
    const guardIdx = mapRoute.indexOf('if(_allFailed){');
    const mergeIdx = mapRoute.indexOf('var merged=[],tot=0,cap=false,inv=0;', guardIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(guardIdx); // the guard precedes the merge/blank
    expect(mapRoute).toMatch(/if\(_allFailed\)\{ if\(typeof _showFetchError==='function'\)_showFetchError\(\); return; \}/);
  });

  it('a genuine empty result (fetch OK, 0 rows) still falls through and renders 0 — no failed flag', () => {
    // the successful mapping return must NOT carry failed:true (only the error paths do)
    expect(mapRoute).toMatch(/pins:\(d\.pins\|\|\[\]\)\.map\(function\(p\)\{return toRow\(p,m\);\}\),total:d\.totalForFilters\|\|0,capped:!!d\.capped[^}]*\}/);
    const successReturn = mapRoute.slice(
      mapRoute.indexOf('pins:(d.pins||[]).map(function(p){return toRow(p,m);})'),
    ).slice(0, 200);
    expect(successReturn).not.toContain('failed:true');
  });

  it('the outer promise .catch surfaces the error too (never a silent blank)', () => {
    expect(mapRoute).toMatch(/\}\)\.catch\(function\(\)\{busy=false; afterFetch\(\); if\(typeof _showFetchError==='function'\)_showFetchError\(\);\}\);/);
  });

  it('the banner helpers exist in template.html and paint an honest retry, not "No opportunities match"', () => {
    expect(tmpl).toContain('function _showFetchError()');
    expect(tmpl).toContain('function _clearFetchError()');
    // it inserts a banner rather than replacing the feed (keeps already-rendered cards)
    expect(tmpl).toMatch(/feed\.insertBefore\(b, feed\.firstChild\)/);
    // and offers a retry wired to the live refetch
    expect(tmpl).toContain('window.__mapRefetch');
    // it must NOT reuse the misleading empty-state copy
    const showFn = tmpl.slice(tmpl.indexOf('function _showFetchError()'), tmpl.indexOf('function _clearFetchError()'));
    expect(showFn).not.toContain('No opportunities match');
  });
});
