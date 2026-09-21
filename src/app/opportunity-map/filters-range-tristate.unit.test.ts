/**
 * Filters panel — Zillow redesign PR3: value min–max range + segmented Refine + buyer-behavior pills.
 * (Eric 2026-07-28.) Three structural upgrades, all keeping the existing FILT wiring:
 *   • Contract value → a min–max PAIR (mfValueMin / mfValueMax); readDeep composes FILT.valueRange="min-max".
 *   • Refine (docs/contact) → 2-way Any|Only segmented controls (NOT a 3-way — the endpoint has no
 *     exclude, so no dead "Hide"); the hidden checkboxes stay the state.
 *   • How this buyer buys → single-select PILLS driving the hidden #mfSapBuyer select.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('value is a min–max range pair', () => {
  it('renders mfValueMin + mfValueMax selects', () => {
    expect(routeSrc).toContain('id="mfValueMin"');
    expect(routeSrc).toContain('id="mfValueMax"');
    expect(routeSrc).toContain('class="mf-range');
  });
  it('readDeep composes FILT.valueRange from the pair (either bound alone valid)', () => {
    expect(routeSrc).toContain("FILT.valueRange=(_vmin||_vmax)?(_vmin+'-'+_vmax):''");
  });
  it('fetchView still splits valueRange into minValue/maxValue (downstream unchanged)', () => {
    expect(routeSrc).toContain("var _vr=FILT.valueRange.split('-')");
    expect(routeSrc).toContain("url+='&minValue='");
    expect(routeSrc).toContain("url+='&maxValue='");
  });
});

describe('Refine = 2-way Any|Only segmented (no dead Hide)', () => {
  it('segmented controls drive the hidden docs/contact checkboxes', () => {
    expect(routeSrc).toContain('data-seg="mfHasDocs"');
    expect(routeSrc).toContain('data-seg="mfHasContact"');
    expect(routeSrc).toContain("cb.checked=(b.getAttribute('data-v')==='1')");
  });
  it('readDeep still reads the hidden checkboxes (wiring intact)', () => {
    expect(routeSrc).toContain("FILT.hasDocs=(document.getElementById('mfHasDocs')||{}).checked?'1':''");
    expect(routeSrc).toContain("FILT.hasContact=(document.getElementById('mfHasContact')||{}).checked?'1':''");
  });
});

describe('How this buyer buys = single-select pills', () => {
  it('the pill group drives the hidden #mfSapBuyer select', () => {
    expect(routeSrc).toContain('data-sel="mfSapBuyer"');
    expect(routeSrc).toContain("sel.value=b.getAttribute('data-v')||''");
  });
  it('readDeep still reads #mfSapBuyer (wiring intact)', () => {
    expect(routeSrc).toContain("FILT.sapBuyer=(document.getElementById('mfSapBuyer')||{}).value||''");
  });
  it('syncSegPillUI reflects state onto the buttons (and runs on reset)', () => {
    expect(routeSrc).toContain('function syncSegPillUI()');
    expect(routeSrc).toContain('syncSegPillUI(); // reflect the cleared hidden inputs');
  });
});
