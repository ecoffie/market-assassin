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
  it('the top-left nav is the two-map split (Explore: Opportunities · Players · Pursuits)', () => {
    // TWO MAPS: the second map is user-facing "Players" (briefly labelled "Network"
    // 2026-08-03 → 08-15; Eric reverted the LABEL only — the product split is unchanged),
    // under an "Explore" eyebrow. The internal data-map value stays "players" (no wiring change).
    expect(route).toContain('<span class="zh-explore">Explore</span>');
    expect(route).toContain('data-map="opportunities"');
    expect(route).toContain('>Opportunities</a>');
    expect(route).toContain('data-map="players"');
    expect(route).toContain('>Players</a>');
    // (Was `not.toContain('>Players</a>')` while the label was "Network", 2026-08-03 → 08-15.
    // Eric reverted the label, so the assertion inverts with it — the line above IS the check.)
    expect(route).not.toContain('>Network</a>');
    // Pursuits is a MAP SUB-VIEW (not the old /app?panel=pipeline in-app panel). The top nav must
    // point at the sub-view route so it matches the left rail.
    expect(route).toContain('href="/opportunity-map/pursuits">Pursuits</a>');
    // Reports was REMOVED from the nav 2026-08-15 (Eric: "it keeps resurfacing"). This assertion
    // used to require its PRESENCE — it guarded a 2026-08-05 regression where the top-nav Reports
    // link had drifted to /opportunity-map/market. That link no longer exists to drift, so the
    // guard flips to absence and keeps this file honest with map-rail-inventory.unit.test.ts.
    expect(route).not.toContain('>Reports</a>');
    expect(route).not.toContain('panel=pipeline">Pursuits</a>');
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
  it('the card CTA is dynamic (draftCTA) and the popup CTA is lifecycle-matched (lcCTA), not hardcoded', () => {
    // The result-list CARD still uses draftCTA(o) (Plan outreach / Plan recompete / Start drafting).
    // The POPUP (Expanded Decision Card, 2026-08-04) uses lcCTA(o) — a lifecycle-matched verb
    // (Track Forecast / Review Opportunity / Analyze Recompete) — so it no longer shares draftCTA.
    const cardCta = (tmpl.match(/\$\{draftCTA\(o\)\}/g) || []).length;
    expect(cardCta).toBeGreaterThanOrEqual(1);
    expect(tmpl).toContain('${lcCTA(o)}');
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
