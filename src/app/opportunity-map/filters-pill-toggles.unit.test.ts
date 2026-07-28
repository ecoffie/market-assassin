/**
 * Filters panel — Zillow redesign PR2: multi-select rows render as tappable PILL toggles.
 * (Eric 2026-07-28: "it is really the design I want to get correct.") The set-aside / notice-type /
 * only-show checkboxes are restyled into Zillow's rounded pills — native checkbox hidden, the whole
 * label is the control, blue-tinted with a leading ✓ when selected. PURE CSS: the .mf-set / .mf-notice
 * checkboxes stay in the DOM (the JS reads them via :checked), so no wiring changed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('multi-select filter rows are Zillow pill toggles', () => {
  it('the pill (.mf-chk) is rounded-full and hides the native checkbox', () => {
    // rounded-full pill shape (999px), not the old 10px chip.
    expect(routeSrc).toContain("'.mf-chk{display:inline-flex;align-items:center;gap:8px;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);border:1.5px solid var(--line);border-radius:999px");
    // native checkbox hidden — the pill itself is the control.
    expect(routeSrc).toContain("'.mf-chk input{position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none}'");
  });
  it('a selected pill is blue-tinted with a leading checkmark', () => {
    expect(routeSrc).toContain('.mf-chk:has(input:checked){border-color:var(--jan);background:#eff5ff;color:var(--jan)}');
    expect(routeSrc).toContain('.mf-chk:has(input:checked)::before{content:"\\\\u2713"');
  });
  it('the underlying checkbox classes are UNCHANGED (wiring intact)', () => {
    // The JS still reads these — the redesign must not rename them.
    expect(routeSrc).toContain('class="mf-set"');
    expect(routeSrc).toContain('class="mf-notice"');
    expect(routeSrc).toContain('id="mfHasDocs"');
    expect(routeSrc).toContain('id="mfHasContact"');
  });
});
