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
  it('the urgency pill is gated on urgency (hot) or recompete, not shown on every card', () => {
    expect(tmpl).toContain("const showDl = f.c==='hot' || o.src==='RECOMPETE'");
    expect(tmpl).toContain('${showDl?`<span class="dl ${f.c}">');
  });
  it('the DUE date cell still shows the date (the info the pill used to duplicate)', () => {
    expect(tmpl).toContain('<div class="k">Due</div>');
  });
  it('the change is in the SERVED template too (not just source)', () => {
    expect(ts).toContain("f.c==='hot'");
  });
});
