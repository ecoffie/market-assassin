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
  it('Recompete is a HORIZON toggle chip on the Opportunities map (horizons coexist)', () => {
    // 2026-07-31 (map1_two_axis_pin_system): the opportunity horizons no longer SWITCH via the
    // dropdown — they COEXIST on one Opportunities map, each a show/hide toggle chip colored by its
    // horizon. So Recompete is a `data-hz="recompete"` chip, not a dropdown <option>. The dropdown
    // now switches between the three MAPS (Opportunities / Players / DLA).
    // Grants was REMOVED from the horizon set (Eric 2026-08-01) — Open · Recompete · Forecast only.
    expect(route).toContain('data-hz="recompete"');
    expect(route).toContain('data-hz="forecast"');
    expect(route).not.toContain('data-hz="grants"');
    expect(route).toContain('data-hz="open"');
    // The dropdown's Opportunities entry is a single "Opportunities" option (not per-horizon).
    expect(route).toContain('<option value="open" selected>Opportunities</option>');
    // The old per-horizon dropdown options are gone.
    expect(route).not.toContain('<option value="recompete">Recompetes</option>');
  });
  it('the top-left nav is the two-map split (Opportunities · Players · Pursuits)', () => {
    expect(route).toContain('data-map="opportunities"');
    expect(route).toContain('>Opportunities</a>');
    expect(route).toContain('data-map="players"');
    expect(route).toContain('>Players</a>');
    expect(route).toContain('panel=pursuits">Pursuits</a>');
    // the old flat dataset nav links are gone
    expect(route).not.toContain('onclick="setMapMode(\'recompete\')">Recompetes</a>');
    expect(route).not.toContain('>Contacts</a>');
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

describe('the recompete status pill does NOT echo the "Recompetes" dataset name', () => {
  it('the pill is time-based ("Expired"/"Expiring soon"), never "Recompete now/window"', () => {
    // The tab is already named "Recompetes" — the pill carries TIMING, not a repeat of the frame
    // (Eric 2026-07-27: "the cards still say recompetes at the top"). Past-expiry now reads "Expired"
    // (the honest NRWA fix), upcoming reads "Expiring soon" — neither echoes the tab.
    expect(tmpl).toContain("{t:'Expiring soon',c:'warm'}");
    expect(tmpl).toContain("{t:'Expired',c:'cool'}");
    expect(tmpl).not.toContain("{t:'Recompete now',c:'warm'}");
    expect(tmpl).not.toContain("{t:'Recompete window',c:'warm'}");
    expect(tmpl).not.toContain("{t:'Expiring now',c:'warm'}"); // past≠"expiring"; it EXPIRED
  });
});
