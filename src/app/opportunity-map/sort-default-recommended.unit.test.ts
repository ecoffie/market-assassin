/**
 * Sort default = "Recommended" (Zillow parity, Eric 2026-07-27).
 * The sidebar must NOT present a specific dimension ("Deadline (soonest)") as if the user chose it —
 * that reads as an active filter the user never set (and "Deadline" is meaningless for Awarded
 * contracts). Zillow's default is a NAMED recommended order ("Homes for You"); ours is "Recommended".
 * Picking a real dimension swaps the label; Clear-all resets back to "Recommended".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmplSrc = readFileSync(join(__dirname, 'template.html'), 'utf8');
const tmplTs = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

describe('sort default is the neutral "Recommended", not a dimension', () => {
  it('the sort trigger label defaults to "Recommended"', () => {
    expect(routeSrc).toContain('<span id="sortBtnLabel">Recommended</span>');
    expect(routeSrc).not.toContain('<span id="sortBtnLabel">Deadline (soonest)</span>');
  });
  it('both sort menus lead with a "Recommended" default option (value "")', () => {
    // The first SORT_OPTIONS / COMPANY_SORT_OPTIONS entry must be the empty-value Recommended default.
    expect(routeSrc).toContain("['', 'Recommended']");
  });
  it('the map F.sort initializes empty (server default order), NOT "deadline" — in BOTH template files', () => {
    // The template default drove the silent deadline sort. Must be '' in the source AND the served ts.
    expect(tmplSrc).toContain("soon:false,sort:''");
    expect(tmplSrc).not.toContain("soon:false,sort:'deadline'");
    expect(tmplTs).toContain("soon:false,sort:''");
    expect(tmplTs).not.toContain("soon:false,sort:'deadline'");
  });
  it('Clear-all resets the sort to the default (__resetSort → "Recommended")', () => {
    expect(routeSrc).toContain('window.__resetSort=function()');
    expect(routeSrc).toContain("if(window.__resetSort)window.__resetSort()");
    // __resetSort restores the "Recommended" label.
    const idx = routeSrc.indexOf('window.__resetSort=function()');
    expect(routeSrc.slice(idx, idx + 500)).toContain("lbl.textContent='Recommended'");
  });
});
