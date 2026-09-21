import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
const map = src.slice(src.indexOf('const SET_ASIDE_LABELS'), src.indexOf('};', src.indexOf('const SET_ASIDE_LABELS')));
const codes = [...map.matchAll(/'([A-Za-z0-9]+)':/g)].map(m => m[1]);

describe('set-aside filter codes match what SAM actually stores', () => {
  it("uses HZC, not 'HUBZone' — the bug the customer hit", () => {
    // The API filters .eq('set_aside_code', value). 'HUBZone' matched 0 rows while
    // the feed plainly showed HUBZone work. Verified live: HUBZone=0, HZC=1.
    expect(codes).toContain('HZC');
    expect(codes).not.toContain('HUBZone');
  });

  it("uses NONE, not 'None' — the data is uppercase", () => {
    expect(codes).toContain('NONE');
    expect(codes).not.toContain('None');
  });

  it('covers every code with meaningful volume in the 30-day window', () => {
    // Counts sampled 2026-08-03 from sam_opportunities.
    for (const c of ['SBA', 'SDVOSBC', 'WOSB', '8A', 'ISBEE', 'HZC', '8AN', 'SDVOSBS', 'SBP', 'EDWOSB', 'WOSBSS', 'VSA', 'IEE']) {
      expect(codes).toContain(c);
    }
  });

  it('drives the dropdown from the map so the two cannot drift', () => {
    // The hardcoded <option> list is what let value="HUBZone" survive.
    expect(src).toMatch(/Object\.entries\(SET_ASIDE_LABELS\)/);
  });

  it('excludes NONE from the dropdown — absence of a set-aside is not one to filter for', () => {
    expect(src).toMatch(/filter\(\(\[code\]\) => code !== 'NONE'\)/);
  });
});
