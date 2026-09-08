/**
 * Unit test for the recompete Share → reload round-trip.
 *
 * Durable invariant: every Share URL must pass generate URL → fresh browser → exact entity
 * restored, WITHOUT relying on the recipient's viewport or the 1,000-pin cap.
 *
 * URL params are typed addresses. ?recompete= is an awarded contract_id. It must NEVER pass
 * through the generic SAM opener (openOppDrawer / opportunity-detail).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const CHARLIE = 'CONT_AWD_36C24721F0485_3600_GS07F0168T_4730';
const CHARLIE_URL = `https://getmindy.ai/opportunity-map?recompete=${CHARLIE}`;

function blockAround(needle: string, before = 200, after = 800): string {
  const at = routeSrc.indexOf(needle);
  expect(at, `missing ${needle}`).toBeGreaterThan(-1);
  return routeSrc.slice(Math.max(0, at - before), at + after);
}

describe('recompete Share/deep-link round-trip', () => {
  it('the Share button branches on kind===recompete to emit ?recompete=', () => {
    expect(routeSrc).toMatch(/CUR\.kind==='recompete'\)\?'recompete'/);
  });

  it('a ?recompete= boot deep-link handler exists and isolates Awarded context', () => {
    expect(routeSrc).toContain("(location.search||'').match(/[?&]recompete=([^&]+)/)");
    expect(routeSrc).toMatch(/window\.__isolateHorizon\('recompete'\)/);
    expect(routeSrc).toMatch(/window\.openRecompeteDrawer\(rid\)/);
    // Old single-dataset path is insufficient — fetchView merges __horizons.
    const dedicated = blockAround("match(/[?&]recompete=([^&]+)/)", 200, 700);
    expect(dedicated).not.toContain("setMapMode('recompete')");
  });

  it('?recompete= boot isolates horizons (Open/Forecast off) via the live toggle', () => {
    // Gold master: a human turning off Open/Forecast goes through toggleHorizon.
    // __isolateHorizon is that loop, extracted so share boot and ?mode= cannot drift.
    // Open-only default requires turning the target ON first — last-ON sticky would
    // otherwise refuse to drop Open and the share would land on Open+Recompete.
    expect(routeSrc).toContain('window.__isolateHorizon=function');
    expect(routeSrc).toMatch(/__isolateHorizon=function\(want\)[\s\S]{0,800}toggleHorizon\(want\)[\s\S]{0,400}toggleHorizon\(h\)/);
    // Init-time write so finishBoot's first fetchView is already recompete-only
    // (otherwise the rail paints the mixed Open+Forecast+Recompete universe).
    expect(routeSrc).toContain("if(/[?&]recompete=/.test(qs)) want='recompete'");
    expect(routeSrc).toContain("window.__applyHorizonState({open:want==='open',recompete:want==='recompete',forecast:want==='forecast'})");
    expect(routeSrc).toContain("if(named==='recompete'||named==='forecast'||named==='open') want=named");
  });

  it('the boot regex extracts Charlie Whitfield’s contract_id and ignores ?opp=', () => {
    const re = /[?&]recompete=([^&]+)/;
    const m = CHARLIE_URL.match(re);
    expect(m && decodeURIComponent(m[1])).toBe(CHARLIE);
    expect('/opportunity-map?opp=abc'.match(re)).toBeNull();
    expect('/opportunity-map?opp=fc-abc'.match(re)).toBeNull();
  });

  it('the recompete drawer CUR carries kind:recompete + a live uiLink (gaps 1/2)', () => {
    expect(routeSrc).toMatch(/CUR=\{ kind:'recompete'/);
    expect(routeSrc).toMatch(/uiLink:usaspendingUrlForRecompete\(o\)/);
  });
});

describe('typed boot handlers — do not collapse IDs into openOppDrawer', () => {
  it('the generic SHARED-LINK opener does NOT grab recompete / company / buyer', () => {
    const generic = blockAround("var _fromForecast=!!_sp.get('forecast');", 400, 400);
    expect(generic).toContain("_sp.get('opp')");
    expect(generic).not.toContain("_sp.get('recompete')");
    expect(generic).not.toContain("_sp.get('company')");
    expect(generic).not.toContain("_sp.get('buyer')");
    expect(routeSrc).not.toContain("_sp.get('opp')||_sp.get('recompete')");
  });

  it('generic handler never calls openOppDrawer for a ?recompete= id', () => {
    const start = routeSrc.indexOf('SHARED-LINK OPEN');
    const end = routeSrc.indexOf('window.openOppDrawer=function', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const generic = routeSrc.slice(start, end);
    expect(generic).not.toContain("_sp.get('recompete')");
    // force=true SAM fetch remains for ?opp= only (after the typed-id grab was narrowed).
    expect(generic).toContain('openOppDrawer(_id,true)');
  });

  it('dedicated ?recompete= handler fetches by id when the row is missing', () => {
    expect(routeSrc).toContain("fetch('/api/app/recompete-row?id='");
    expect(routeSrc).toContain('function fetchRecompeteRow(key)');
    expect(routeSrc).toContain('findRecompeteRow(key)');
    // Inject the fetched pin, then paint — identical to a pin click (toRow bridge).
    expect(routeSrc).toContain('window.__toRecompeteRow');
    expect(routeSrc).toContain('paintRecompeteDrawer');
  });

  it('success is valid recompete data for THAT id, not drawer .show', () => {
    const dedicated = blockAround("match(/[?&]recompete=([^&]+)/)", 400, 700);
    expect(dedicated).toContain('window.__recompeteOpenedId===rid');
    expect(dedicated).not.toContain("classList.contains('show')");
    expect(routeSrc).toContain("window.__recompeteOpenedId=String(o.nid||o.sol||'')");
  });
});

describe('typed-handler split — other deep links do not go through recompete', () => {
  it('?opp= still has its own handler that calls openOppDrawer, not openRecompeteDrawer', () => {
    const at = routeSrc.indexOf('window.openOppDrawer(nid)');
    expect(at).toBeGreaterThan(-1);
    const handler = routeSrc.slice(at - 200, at + 200);
    expect(handler).toContain("match(/[?&]opp=([^&]+)/)");
    expect(handler).toContain('openOppDrawer');
    expect(handler).not.toContain('openRecompeteDrawer');
    expect(handler).not.toContain('recompete-row');
  });

  it('?forecast= still routes through the forecast by-id path, not recompete-row', () => {
    expect(routeSrc).toContain("_sp.get('forecast')");
    expect(routeSrc).toContain("fetch('/api/app/forecast-detail?id='");
    expect(routeSrc).toContain('window.openForecastDrawer');
    const fc = blockAround("var _fetchFc=function()", 0, 900);
    expect(fc).not.toContain('recompete-row');
    expect(fc).not.toContain('openRecompeteDrawer');
  });

  it('?company= and ?buyer= still have dedicated handlers, not the recompete path', () => {
    const company = blockAround("match(/[?&]company=([^&]+)/)", 0, 500);
    expect(company).toContain('openCompanyDrawer');
    expect(company).not.toContain('openRecompeteDrawer');
    expect(company).not.toContain('recompete-row');
    const buyer = blockAround("match(/[?&]buyer=([^&]+)/)", 0, 500);
    expect(buyer).toContain('openBuyerDrawer');
    expect(buyer).not.toContain('openRecompeteDrawer');
    expect(buyer).not.toContain('recompete-row');
  });
});
