/**
 * Filters panel — Zillow parity, PR1: active-filter COUNT badge + live "Show N results" on Apply.
 * (Eric 2026-07-28: "the filters section is still lacking compared to Zillow… it is really the design.")
 * The two signature Zillow moves: a numeric badge on the Filters button showing how many filter GROUPS
 * are active, and the Apply button reading "Show N results" (Zillow's "See 1,482 homes"), not a bare "Apply".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Filters panel markup + wiring lives entirely in route.ts (the served route HTML), NOT in
// template.html — so there is no template-html.ts sync to guard here.
const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('active-filter count badge on the Filters button', () => {
  it('the Filters button renders a #mfBadge span (hidden by default)', () => {
    expect(routeSrc).toContain('id="mfBadge"');
    expect(routeSrc).toContain('class="fbadge"');
    expect(routeSrc).toContain('.fbadge{'); // styled
  });
  it('readDeep counts active filter GROUPS and shows/hides the badge', () => {
    // The badge shows the number of active filter groups, hidden at 0.
    expect(routeSrc).toContain('var count=0;');
    expect(routeSrc).toContain("var badge=document.getElementById('mfBadge')");
    expect(routeSrc).toContain('badge.textContent=String(count)');
    expect(routeSrc).toContain('badge.hidden=true');
    // A multi-select group counts ONCE (set-aside/notice are single entries in the groups[] array).
    expect(routeSrc).toContain('FILT.setAsideMulti');
    expect(routeSrc).toContain('FILT.noticeMulti');
  });
});

describe('live "Show N results" on the Apply button', () => {
  it('the Apply button is not a bare "Apply" and updateApplyCount wires the count', () => {
    expect(routeSrc).toContain('function updateApplyCount(n)');
    expect(routeSrc).toContain("ap.textContent='Show '+n.toLocaleString()+' result'");
    // called from updateHeader (fires on every fetch/render) so the number stays live
    expect(routeSrc).toContain("updateApplyCount((TOTAL||0)>0?TOTAL:n);");
    // the initial button label is no longer a bare "Apply"
    expect(routeSrc).toContain('id="mfApply">Show results<');
    expect(routeSrc).not.toContain('id="mfApply">Apply<');
  });
  it('chip/input changes live-preview the count (do not wait for Apply)', () => {
    expect(routeSrc).toContain('function previewFilters()');
    expect(routeSrc).toContain("_mfp.addEventListener('change',previewFilters)");
    expect(routeSrc).toContain("_mfp.addEventListener('input',previewFilters)");
    expect(routeSrc).toContain('syncSegPillUI(); previewFilters();');
  });
});

describe('State filter pans the map to that state', () => {
  it('Apply flies to __STATE_CENTROIDS[ST] at zoom 6 (same jump as search-bar intent)', () => {
    expect(routeSrc).toContain('function flyToStateFilter()');
    expect(routeSrc).toContain('map.setView(c,6,{animate:true})');
    expect(routeSrc).toContain('flyToStateFilter(); fetchView();');
  });
});

describe('State filter does not empty the list (camera ∩ PoP-state)', () => {
  it('bbox() uses a world box when FILT.state is a 2-letter code; Draw still uses the rectangle', () => {
    expect(routeSrc).toContain("if(FILT.state && /^[A-Z]{2}$/.test(FILT.state))");
    expect(routeSrc).toContain("return '-180.0000,-90.0000,180.0000,90.0000'");
    const bboxFn = routeSrc.slice(routeSrc.indexOf('function bbox(){'), routeSrc.indexOf('window.__mapRefetch'));
    expect(bboxFn.indexOf('window.__drawBounds')).toBeLessThan(bboxFn.indexOf("FILT.state && /^[A-Z]{2}$/"));
  });
  it('maybeAutoFit does not yank the camera off a state filter', () => {
    expect(routeSrc).toContain("if(FILT.state && /^[A-Z]{2}$/.test(FILT.state) && !window.__drawBounds)return;");
  });
  it('updateHeader never papers an empty list with TOTAL', () => {
    expect(routeSrc).toContain('if(shown>0 && (TOTAL||0)>shown) n=TOTAL;');
    expect(routeSrc).not.toContain('var n=Math.max(TOTAL||0, (INVIEW && INVIEW>0)?INVIEW:shown);');
    expect(routeSrc).toContain("in this view · '+TOTAL.toLocaleString()+' match — zoom out");
  });
});
