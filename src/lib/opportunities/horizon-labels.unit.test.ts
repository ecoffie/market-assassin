/**
 * Horizon vocabulary (Mindy Learn decision 2, 2026-10-08): the Map's three horizons are shown as
 * Open Now · Coming Back · Coming Soon. LABELS ONLY — the keys (open / recompete / forecast) are the
 * URL, saved-search and API vocabulary and must not move.
 *
 * The Map carries the labels as literals (its client script is executed as text by other tests), so this
 * pins every user-facing site to HORIZON_LABELS, and pins the keys that must NOT change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HORIZON_LABELS } from './horizon-labels';
import { MF_HORIZON_LABEL } from '@/app/opportunity-map/market-feedback';

const dir = join(process.cwd(), 'src/app/opportunity-map');
const ROUTE = readFileSync(join(dir, 'route.ts'), 'utf8');
const TMPL = readFileSync(join(dir, 'template.html'), 'utf8');
const L = HORIZON_LABELS;

describe('the three labels', () => {
  it('are exactly the approved names', () => {
    expect(L).toEqual({ open: 'Open Now', recompete: 'Coming Back', forecast: 'Coming Soon' });
  });
  it('the Updating panel uses the same table', () => {
    expect(MF_HORIZON_LABEL).toEqual(L);
  });
});

describe('every Map surface that names a horizon uses the label', () => {
  for (const k of ['open', 'recompete', 'forecast'] as const) {
    it(`${k}: Filters chip, Horizons dropdown and legend`, () => {
      expect(ROUTE).toContain(`onclick="toggleHorizon(\\'${k}\\')">${L[k]}</button>`);
      expect(ROUTE).toMatch(new RegExp(`data-hz="${k}"[^>]*>[^]*?<span class="hznlbl">${L[k]}</span>`));
    });
  }
  it('legend (template.html)', () => {
    expect(TMPL).toContain(`var(--grnd)"></i>${L.open}</span>`);
    expect(TMPL).toContain(`var(--recomp)"></i>${L.recompete}</span>`);
    expect(TMPL).toContain(`var(--forecast)"></i>${L.forecast}</span>`);
  });
  it('card category header (template.html)', () => {
    expect(TMPL).toContain(`{c:'recomp',t:'${L.recompete}'`);
    expect(TMPL).toContain(`{c:'fore',t:'${L.forecast}'`);
    expect(TMPL).toContain(`{c:'open',t:'${L.open}'`);
  });
  it('header coverage note', () => {
    expect(ROUTE).toContain(`var name=h==='forecast'?'${L.forecast}':(h==='recompete'?'${L.recompete}':'${L.open}');`);
  });
  it('drawer fallback signals, saved-search "Showing" row and the Coming Soon empty state (follow-up)', () => {
    expect(ROUTE).toContain(`s.push({t:'${L.recompete}',d:'An existing contract coming up for rebid`);
    expect(ROUTE).toContain(`s.push({t:'${L.forecast}',d:'Planned work, not yet on SAM`);
    expect(ROUTE).toContain(`hz.push('${L.open}'); if(h.recompete)hz.push('${L.recompete}'); if(h.forecast)hz.push('${L.forecast}');`);
    expect(TMPL).toContain(`<h4>${L.forecast} coverage unavailable</h4>`);
  });
  it('no old horizon label survives on a chip, dropdown row, legend or card header', () => {
    expect(ROUTE).not.toMatch(/>(Recompete|Forecast|Open)<\/button>'/);
    expect(ROUTE).not.toMatch(/class="hznlbl">(Recompete|Forecast|Open)</);
    expect(TMPL).not.toMatch(/var\(--(grnd|recomp|forecast)\)"><\/i>(Open|Recompete|Forecast)</);
    expect(TMPL).not.toMatch(/t:'(Recompete|Forecast|Open now)'/);
  });
});

describe('the KEYS are unchanged — URLs, saved searches and APIs keep working', () => {
  it('chips and rows still toggle the same keys', () => {
    for (const k of ['open', 'recompete', 'forecast']) {
      expect(ROUTE).toContain(`data-hz="${k}"`);
      expect(ROUTE).toContain(`toggleHorizon(\\'${k}\\')`);
    }
  });
  it('the horizons state object and saved payload keep open/recompete/forecast', () => {
    expect(ROUTE).toContain('window.__horizons={open:true,recompete:true,forecast:true};');
    expect(ROUTE).toContain('filters.horizons={open:_h.open!==false,recompete:!!_h.recompete,forecast:!!_h.forecast}');
  });
  it('the ?horizon= param is still written with the keys', () => {
    expect(ROUTE).toContain("keep.push('horizon='+encodeURIComponent(want.horizon)");
  });
  it('search still understands the old words, and now the new ones', () => {
    expect(ROUTE).toContain("{hz:'recompete', syns:['coming back','recompete','recompetes'");
    expect(ROUTE).toContain("{hz:'forecast', syns:['coming soon','forecast','forecasts'");
  });
});
