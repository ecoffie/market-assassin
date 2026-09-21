/**
 * Industry dropdown — Eric's review, 2026-08-13.
 *
 * The list and its one-line descriptions were kept as-is. Three things changed:
 *
 * 1. DEFAULT STATE. Every industry arrived CHECKED under a "Deselect all" header, which reads as
 *    "I chose these twelve" when the truth is "no industry filter applied". Different statements,
 *    and only one is honest. Default is now nothing checked, with an explicit "All industries" row.
 *    This REVERSES the 2026-08-01 call ("when you start off ALL industries should be selected
 *    because it's the whole map"). The filter OUTCOME is identical — none-checked and all-checked
 *    both apply no naics filter — so this changed what the control SAYS, not what the map returns.
 *
 * 2. NO APPLY. "This is a map. The whole magic is immediate exploration." Live, debounced.
 *
 * 3. LABEL. "Industry · 1", not the lone preset's name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('default state says "no filter", not "twelve chosen"', () => {
  it('initialises with nothing checked', () => {
    expect(src).toContain('function ensureInit(){ if(initialized)return; if(!allNames().length)return; window.__indSel={}; initialized=true; }');
  });

  it('offers "All industries" as an explicit first option', () => {
    expect(src).toContain("an.textContent='All industries'");
    expect(src).toContain('allRow.onclick=function(){ working={}; reflectWorking(); commitLive(); }');
    // ...and it reflects the real state rather than being a decorative row.
    expect(src).toContain('a.classList.toggle(\'on\', Object.keys(working).length===0)');
  });

  it('clear-all returns to the same empty default', () => {
    expect(src).toContain("window.__naicsReset=function(){ ensureInit(); window.__indSel={}; working={}; FILT.naics=''; FILT.psc='';");
  });

  it('still applies NO filter at either extreme', () => {
    // The honesty rule predates this change and must survive it: all-checked cannot narrow, because
    // some real NAICS live in none of these buckets.
    expect(src).toContain("function filterCodes(names){ var total=allNames().length; return (names.length===0 || (total>0 && names.length===total)) ? '' :");
  });
});

describe('filtering is live', () => {
  it('has no Apply button and no stale handler', () => {
    expect(src).not.toContain('id="indApply"');
    expect(src).not.toContain("getElementById('indApply')");
  });

  it('commits on every toggle, debounced to one fetch per burst', () => {
    expect(src).toContain('function commitLive(){ clearTimeout(_liveT); _liveT=setTimeout(commit, 300); }');
    expect(src).toContain('syncHdr(); reflectAllRow(); commitLive();');
  });

  it('keeps the popover open so you can keep exploring', () => {
    // Closing on commit was an Apply-era habit; with live filtering you watch the pins change and
    // then add another industry without reopening the menu.
    expect(src).toContain('setLabel(); fetchView();\n    }\n    btn.onclick=function(e){ e.stopPropagation(); if(pop.hidden)open(); else setOpen(false); };');
  });

  it('drops "Deselect all" — the All row replaces it', () => {
    expect(src).not.toContain('id="indDeselect"');
    expect(src).toContain('<div class="indhdr"><span class="indhdr-t">Industry</span></div>');
  });
});

describe('the label reports the count', () => {
  it('shows "Industry · N", never a lone preset name', () => {
    expect(src).toContain("lbl.textContent = (names.length===0 || isAll) ? 'Industry' : ('Industry \\\\u00b7 '+names.length);");
  });
});

describe('the Filters hand-off survives', () => {
  it('keeps the hint that separates browsing from precision', () => {
    // Industry = human-friendly browsing, Filters = exact NAICS/PSC. That hierarchy is the point.
    expect(src).toContain('Exact NAICS/PSC? Use <b>Filters</b>.');
  });
});
