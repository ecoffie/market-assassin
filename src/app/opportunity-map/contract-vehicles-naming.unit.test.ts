/**
 * The recompete dataset is named "Recompetes" across nav + dropdown + header (Eric 2026-07-27).
 * Journey of the name: "Awarded" (sounded finished) → "Contract Vehicles" (jargon) → "Recompetes".
 * These contracts are ACTIVE/in-performance — you learn about them from the award record, but the
 * play is live: get ahead of the recompete (expiring prime) OR subcontract to the incumbent (running
 * task order). The tab names the ACTION, not the data's lifecycle state.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('recompete dataset is named "Recompetes"', () => {
  it('the MODES header title is "Recompetes"', () => {
    expect(route).toContain("recompete:{ ep:'/api/app/recompete-map', title:'Recompetes'");
  });
  it('no superseded label survives (Awarded Contracts / Contract Vehicles)', () => {
    expect(route).not.toContain("title:'Awarded Contracts'");
    expect(route).not.toContain("title:'Contract Vehicles'");
    expect(route).not.toContain('<option value="recompete">Awarded</option>');
    expect(route).not.toContain('<option value="recompete">Vehicles</option>');
  });
  it('the dropdown option + top nav both read "Recompetes"', () => {
    expect(route).toContain('<option value="recompete">Recompetes</option>');
    expect(route).toContain(">Recompetes</a>");
  });
});

describe('a RECOMPETE row is two plays — subcontract (running task order) vs recompete (expiring prime)', () => {
  it('recompetePlay classifies by fmtDays bucket (cool = subcontract, warm/hot = recompete)', () => {
    expect(tmpl).toContain("function recompetePlay(o)");
    expect(tmpl).toContain("f.c==='cool'?'subcontract':'recompete'");
  });
  it('the CTA label matches the play (Plan outreach / Plan recompete / Start drafting)', () => {
    expect(tmpl).toContain("function draftCTA(o)");
    expect(tmpl).toContain("'Plan outreach'");   // subcontract to the incumbent
    expect(tmpl).toContain("'Plan recompete'");  // get ahead of the rebid
    expect(tmpl).toContain("'Start drafting'");  // open opp
  });
  it('the card + popup CTAs are dynamic (draftCTA), not a hardcoded "Start drafting"', () => {
    // both action buttons render draftCTA(o); no lingering hardcoded label on the recompete path
    const cta = (tmpl.match(/\$\{draftCTA\(o\)\}/g) || []).length;
    expect(cta).toBeGreaterThanOrEqual(2);
  });
  it('the subcontract prompt targets the incumbent/prime, not a recompete bid', () => {
    expect(tmpl).toContain('win subcontract work on an active federal contract');
    expect(tmpl).toContain("small-business liaison");
  });
});
