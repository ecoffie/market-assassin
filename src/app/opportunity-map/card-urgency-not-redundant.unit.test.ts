/**
 * The urgency pill ('N days left') is REDUNDANT with the DUE date cell on a non-urgent Open opp
 * (Eric 2026-07-27: "7 days left + Due Jul 28 = same info said differently, no value"). So the pill
 * renders ONLY when it adds value: genuinely urgent (f.c==='hot') OR a recompete (strategic status).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const ts = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

describe('card urgency pill is not redundant with the DUE date', () => {
  it('the OPEN urgency moved to the HEADER; the floating card pill is now RECOMPETE-only', () => {
    // OPEN deadline urgency now rides the header's right side ("OPEN NOW … 3 DAYS LEFT", Eric
    // 2026-08-04) via lcHeader, so the floating "N days left" pill under the estimate is dropped for
    // OPEN. It survives ONLY for a RECOMPETE in its actionable window (warm) — its status isn't in
    // the OPEN-only header line. The "Active — subcontract" (cool) majority still drops the pill.
    expect(tmpl).toContain("const showDl = (o.src==='RECOMPETE' && f.c==='warm')");
    // the pill (recompete-only now) still rides the `crow` const under the estimate, gated on showDl
    expect(tmpl).toContain('(showDl?`<span class="dl ${f.c}"><i></i>${f.t}</span>`:\'\')');
    // the header now emits the OPEN "N DAYS LEFT" flag
    expect(tmpl).toMatch(/DAYS LEFT/);
  });
  it('the DUE date cell still shows the date (the info the pill used to duplicate)', () => {
    expect(tmpl).toContain('<div class="k">Due</div>');
  });
  it('the change is in the SERVED template too (not just source)', () => {
    expect(ts).toContain("f.c==='hot'");
  });
});
