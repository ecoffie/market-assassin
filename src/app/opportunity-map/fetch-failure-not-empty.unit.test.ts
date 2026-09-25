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
    // Maps P0: _loadHorizon resolves {failed:true} on !success AND on a network error (an ABORT is
    // {aborted:true} — superseded, never painted, never an error); the round turns it into a part.
    const loader = mapRoute.slice(mapRoute.indexOf('function _loadHorizon('), mapRoute.indexOf('function fetchView(){'));
    expect((loader.match(/failed:true/g) || []).length).toBeGreaterThanOrEqual(2); // !success + network error
    expect(loader).toContain("(err&&err.name==='AbortError')?{aborted:true}:{failed:true}");
    const round = mapRoute.slice(mapRoute.indexOf('function _fetchViewNow('), mapRoute.indexOf('function _paintRound('));
    expect(round).toContain('failed:true');
  });

  it('when EVERY enabled horizon failed, the map does NOT blank — it shows the error, keeps last-good', () => {
    // the all-failed guard runs BEFORE OPPS is reassigned, and short-circuits (return)
    expect(mapRoute).toMatch(/_allFailed\s*=\s*parts\.length>0\s*&&\s*parts\.every\(function\(p\)\{return p&&p\.failed;\}\)/);
    const guardIdx = mapRoute.indexOf('if(_allFailed){');
    const mergeIdx = mapRoute.indexOf('var merged=[],tot=0,cap=false,inv=0;', guardIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(guardIdx); // the guard precedes the merge/blank
    expect(mapRoute).toMatch(/if\(_allFailed\)\{ if\(!_haveRender && typeof _showFetchError==='function'\)_showFetchError\(\); return; \}/);
  });

  it('a superseded/failed re-fetch does NOT cover an already-rendered map — banner is gated on empty', () => {
    // the auto-fit re-fetch races the initial load; if it resolves failed AFTER 600 cards rendered,
    // the banner must NOT show. Gate: only show when nothing is currently on screen.
    expect(mapRoute).toMatch(/_haveRender\s*=\s*\(typeof OPPS!=='undefined' && OPPS && OPPS\.length>0\)/);
    // and a NEW attempt clears any stale banner up front, so a later good load self-heals
    // (Maps P0: the attempt starts in _fetchViewNow — the scheduled body of fetchView.)
    const fvIdx = mapRoute.indexOf('function _fetchViewNow(');
    const genIdx = mapRoute.indexOf('var gen=++_fetchGen;', fvIdx);
    const clearIdx = mapRoute.indexOf("if(typeof _clearFetchError==='function')_clearFetchError();", fvIdx);
    expect(clearIdx).toBeGreaterThan(fvIdx);   // the clear is inside the attempt
    expect(clearIdx).toBeLessThan(genIdx);     // BEFORE the round starts, so every attempt clears
  });

  it('a genuine empty result (fetch OK, 0 rows) still falls through and renders 0 — no failed flag', () => {
    // the successful mapping return must NOT carry failed:true (only the error paths do)
    // total comes from horizonCount (a real 0 stays 0; null/unavailable stays null — see
    // forecast-unavailable-not-zero.unit.test.ts). Still no failed flag on the success path.
    expect(mapRoute).toMatch(/pins:\(d\.pins\|\|\[\]\)\.map\(function\(p\)\{return toRow\(p,m\);\}\),total:hc\.total,count:hc,capped:!!d\.capped[^}]*\}/);
    const successReturn = mapRoute.slice(
      mapRoute.indexOf('pins:(d.pins||[]).map(function(p){return toRow(p,m);})'),
    ).slice(0, 200);
    expect(successReturn).not.toContain('failed:true');
  });

  it('an all-failed round surfaces the error only once nothing else can still succeed (never a silent blank)', () => {
    // Progressive horizons: while another horizon is still loading, an early failure is not judged.
    expect(mapRoute).toContain('if(_allFailed&&loading.length)return;');
    // the Players (contacts) path still surfaces a thrown fetch — for the CURRENT round only
    expect(mapRoute).toContain("}).catch(function(){ if(cgen!==_fetchGen)return; if(typeof _showFetchError==='function')_showFetchError(); });");
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
