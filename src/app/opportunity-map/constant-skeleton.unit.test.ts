/**
 * GOS invariant #10 — the drawer skeleton is CONSTANT: the intel/content sections that CAN carry
 * data always render (header + a muted placeholder when empty), never collapse. This guards the
 * wiring in route.ts's injected drawer JS so a future edit can't silently reintroduce a vanishing
 * section (which reads as a bug + makes buildTabs non-deterministic).
 *
 * It asserts on the SHIPPED source: every "always-render" section must have an else-branch that
 * emits sec(<header>, empty(...)/placeholder, <anchor>), and the on-demand intel fetches must call
 * renderIntel/renderRecompeteIntel with {} (not '') on a miss so the skeleton survives a failed fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('GOS #10 — open-opp drawer intel sections always render', () => {
  it('renderIntel takes {} (never returns "" on missing intel)', () => {
    expect(src).toMatch(/function renderIntel\(intel\)\{\s*intel=intel\|\|\{\};/);
  });
  it('M-Estimate top price header handles no-median honestly (never hidden)', () => {
    expect(src).toContain('No estimate');
    expect(src).toContain('too few comparable federal awards for this NAICS');
  });
  it('Contract history, Buyer intelligence, and Market pricing each have an else placeholder', () => {
    expect(src).toContain('No incumbent identified for this requirement');
    expect(src).toContain('Agency intel not available');
    expect(src).toContain('Pricing data not available for this NAICS');
  });
  it('the BD roster always renders a placeholder (no agency / not signed in / empty)', () => {
    expect(src).toContain('Sign in to see other contacts at this agency');
    expect(src).toContain('No additional contacts found');
    expect(src).toMatch(/function rosterPlaceholder\(box,msg\)/);
  });
  it('the intel fetch renders renderIntel({}) on a miss, not an empty string', () => {
    // success → x.intel, else {} — the skeleton survives an empty/failed fetch.
    expect(src).toMatch(/var intel=\(x&&x\.success\)\?x\.intel:\{\};/);
    expect(src).toMatch(/box\.innerHTML=renderIntel\(\{\}\); buildTabs\(\); loadRoster/);
  });
});

describe('Zillow price-placement — M-Estimate leads the drawer, methodology lower, NO duplicate', () => {
  it('a #mEstTop price slot leads the drawer body (right after overview)', () => {
    // The slot is rendered in render() before bidFactsSec, and carries the osec-value anchor.
    expect(src).toMatch(/id="mEstTop">.*vrange vrange-top.*id="osec-value"/s);
    // render() emits the slot before the bid-facts section (price is the FIRST prominent thing).
    const body = src.slice(src.indexOf('function render(o,extra)'));
    const topIdx = body.indexOf("id=\"mEstTop\"");
    const factsIdx = body.indexOf('bidFactsSec(extra.bidFacts,o)');
    expect(topIdx).toBeGreaterThan(-1);
    expect(topIdx).toBeLessThan(factsIdx);
  });
  it('the DUPLICATE M-Estimate is gone — the big number renders ONCE (top slot only)', () => {
    // Eric 2026-08-02: "Remove the duplicate M-Estimate… keep ONLY the top one." The lower
    // methodology section must NOT re-print the big median number (vr-sec-big) — it opens with the
    // RANGE + chart + how-we-calculate instead. vr-sec-big must appear nowhere in the source.
    expect(src).not.toContain('vr-sec-big');
    // The lower section still carries the range (vr-band), chart, and methodology, together, at 'mest'.
    expect(src).toMatch(/vr-band[\s\S]*vrChart\(vr\.distribution,vr\.median\)[\s\S]*How we calculate this[\s\S]*'mest'\)/);
    // The TOP header = the headline number + the likely band + comparable basis (Eric 2026-08-04,
    // artifact hero: "Likely $6.9M–$9.4M · 24 comparable federal awards"). The band is REAL data
    // (vr.low/vr.high + mEstBasis) — but the CHART stays in the lower section (hero is a card, not a
    // chart) and the big NUMBER still renders ONCE here (never re-printed below as vr-sec-big).
    const topFn = src.slice(src.indexOf('function mEstTopHTML(vr)'), src.indexOf('function mEstMethodologyHTML(vr)'));
    expect(topFn).not.toContain('vrChart');           // no distribution chart in the hero
    expect(topFn).toContain('vr-band');               // the likely-band subtext now rides the hero
    expect(topFn).toContain('mEstBasis(vr)');          // "N comparable federal awards" — real, not faked
    expect(topFn).toContain('vr-big');                 // the single headline number lives here
  });
  it('the top price header is ALWAYS filled after the intel fetch (success AND failure)', () => {
    expect(src).toMatch(/fillMEstTop\(intel\.valueRange\)/);   // success path
    expect(src).toMatch(/catch\(function\(\)\{ fillMEstTop\(null\)/); // failure path
  });
  it('the tab bar is the FINAL decision-workspace flow — one tab per question (Eric 2026-08-04)', () => {
    // the old fragmented tabs are GONE: no standalone "Value"/"Est. value"/"Contacts"/"SOW facts"/
    // "Contract history"/"Market pricing"/"Buyer intel" tabs — those are headings inside a group now.
    expect(src).not.toMatch(/\['value','Value'\]/);
    expect(src).not.toMatch(/\['mest','Est\. value'\]/);
    expect(src).not.toMatch(/\['incumbent','Contract history'\]/);
    expect(src).not.toMatch(/\['contacts','Contacts'\]/);
    expect(src).not.toMatch(/\['sowfacts','SOW facts'\]/);
    // the FINAL 8 question-groups, in order. Renames (Eric 2026-08-04): Overview→Snapshot,
    // Teaming→"Win this contract" (execution). "Win this contract" now sits ABOVE "Related"
    // (execution beats retention). "Next Actions" is the STICKY bottom bar (osec-actions), NOT a
    // tab — so there is deliberately NO [['actions'],...] group any more.
    expect(src).toContain("[['overview','value'],'Snapshot']");
    expect(src).toContain("[['ai'],'Should I pursue?']");
    expect(src).toContain("[['facts','description','sow','sowfacts'],'Opportunity']");
    expect(src).toContain("[['mest','incumbent','pricing','taskorders'],'Market']");
    expect(src).toContain("[['agencyintel'],'Buyer']");
    expect(src).toContain("[['contacts','roster'],'Decision makers']");
    expect(src).toContain("[['subtargets','openbids'],'Win this contract']");
    expect(src).toContain("[['similar'],'Related']");
    // Win (subtargets) is declared BEFORE Related (similar) — execution above retention.
    expect(src.indexOf("'Win this contract']")).toBeLessThan(src.indexOf("[['similar'],'Related']"));
    // 'actions' is no longer a tab group — Next Actions is the sticky bar.
    expect(src).not.toContain("[['actions'],'Win this contract']");
    // the group→first-present-anchor resolver builds the actual tab list
    expect(src).toContain("groups.forEach(function(g){ var ids=g[0];");
  });
});

describe('The LISTING decision-flow order (Eric 2026-08-02)', () => {
  // Slice the whole render() body (it opens with a long flow-doc comment, so the return's calls sit
  // ~2.5k chars in) up to the next function definition, so indexOf compares real emit order.
  const rStart = src.indexOf('function render(o,extra)');
  const body = src.slice(rStart, src.indexOf('\n  function ', rStart + 20));
  const at = (s: string) => body.indexOf(s);
  it('M-Win rides the hero beside M-Estimate — grounded or an honest locked card, never a fake %', () => {
    // The two branded numbers sit in a .herotwo grid: #mEstTop (M-Estimate) + #mWinTop (M-Win).
    expect(src).toContain('class="herotwo"');
    expect(src).toContain('id="mWinTop"');
    // M-Win fills from its OWN async fetch (loadMWin) → the M-Estimate never waits on it.
    expect(src).toContain('loadMWin(d.opp,intel.valueRange)');
    expect(src).toContain("fetch('/api/app/win-probability?");
    // GROUNDED contract: a real % ONLY when res.grounded; otherwise the honest locked card —
    // never a fabricated number. (Eric 2026-08-04, ground-in-real-data.)
    expect(src).toContain('res&&res.grounded&&typeof res.score');
    expect(src).toContain('Complete your profile to unlock M-Win');
  });
  it('HERO order: TITLE → M-Estimate → the key-facts box (Eric 2026-08-04)', () => {
    // The old snapshot() fused title + the 6-field fact grid into one block, so the box rendered
    // ABOVE the M-Estimate. Split into snapshotHead (badges+title) → #mEstTop (the estimate) →
    // snapshotFacts (the grid). This guards that the estimate leads, right under the title.
    expect(at('snapshotHead(o)')).toBeGreaterThan(-1);
    expect(at('snapshotHead(o)')).toBeLessThan(at('id="mEstTop"'));        // title before estimate
    expect(at('id="mEstTop"')).toBeLessThan(at('snapshotFacts(o)'));       // estimate before facts
  });
  it('Should-I-pursue (ai) comes BEFORE the opportunity-intel facts', () => {
    // The decision is promoted to the top of the flow, above the detail.
    expect(at('aiSec(o)')).toBeGreaterThan(-1);
    expect(at('aiSec(o)')).toBeLessThan(at('bidFactsSec(extra.bidFacts,o)'));
  });
  it('Related opportunities (similar) comes BEFORE the action bar (above the paperwork)', () => {
    expect(at('similarSec(extra.similar)')).toBeLessThan(at('actions(o)'));
  });
  it('Decision Makers (#6) — the notice POC sits AFTER Market/Buyer intel, not mid-drawer (Eric 2026-08-03)', () => {
    // people belong together at #6: solContactsSec (notice POC) now renders AFTER the #intelBox
    // (Market + Buyer + roster stream in there), and BEFORE Teaming/Related/Win.
    expect(at("id=\"intelBox\"")).toBeLessThan(at('solContactsSec(o)'));      // after Market/Buyer
    expect(at('solContactsSec(o)')).toBeLessThan(at("id=\"xsellSub\""));      // before Teaming
    expect(at('solContactsSec(o)')).toBeLessThan(at('similarSec(extra.similar)')); // before Related
    // and the POC header reads as the decision-flow question, not the table name
    expect(src).toContain('Decision makers \\\\u00b7 named on this notice');
    expect(src).not.toContain("sec('Solicitation contacts'");
  });
  it('the Next Actions bar is STICKY (position:sticky bottom), not a scrolling section or a tab', () => {
    // Next Actions is the sticky bottom bar (Eric 2026-08-04) — .oact is position:sticky;bottom:0,
    // it keeps id=osec-actions for the deep-link anchor, but it's deliberately NOT in the tab groups.
    expect(src).toContain('<div class="oact" id="osec-actions">');
    expect(src).toContain('.oact{position:sticky;bottom:0');
  });
  it('the section RENAMES are in place (no old labels)', () => {
    // The drawer JS is a template-literal emitted to the browser, so its unicode escapes are
    // DOUBLE-backslashed in source (\\uXXXX). Assert on the plain-text portions of each heading.
    expect(src).toContain('Should I pursue this?');   // was "AI analysis · Go / No-Go"
    expect(src).toContain("sec('Opportunity intelligence'"); // was "Bid facts"
    expect(src).toContain("sec('Opportunity summary'");      // was "Description"
    expect(src).toContain('Market pricing');          // was "Pricing intel"
    expect(src).toContain('Buyer intelligence');      // was "Know your buyer · agency intel"
    expect(src).toContain('Decision makers');         // was "Other contacts at this agency"
    expect(src).toContain("sec('Related opportunities'"); // was "Similar opportunities"
    expect(src).toContain("var head='Teaming opportunities'"); // was "Subcontract targets nearby"
    // The STICKY bottom bar = WORKFLOW actions (Eric 2026-08-04, clean separation): Start Pursuit ·
    // Generate Proposal · View SAM. The proposal button is "Generate proposal" (a concrete workflow
    // verb) — NOT "Win this contract", which now names the SECTION and would collide with the button.
    expect(src).toContain('>Start pursuit<');         // was "Save to pursuits"
    expect(src).toContain('>Generate proposal</button>'); // was "✍️ Win this contract" (button↔section collision)
    // separation of concerns: the sticky bar does NOT carry the page controls (Save/Share/Hide/More)
    // — those live in the TOP action row (oppSave/oppShare/oppHide/oppMore), not duplicated below.
    expect(src).toContain("id=\"oppShare\"");           // Share is a TOP-row page control
    expect(src).not.toMatch(/oact[\s\S]{0,400}>Share</); // …and not repeated in the sticky action bar
    // The retired OPEN-opp labels must be gone. (The DLA/DIBBS quote drawer is a separate variant —
    // a priced NSN quote, not a SAM listing — and is intentionally out of this reorder's scope, so
    // its own 'Bid facts'/'Save to pursuits' strings are not asserted against here.)
    expect(src).not.toContain("sec('Description'");
    expect(src).not.toContain("sec('Similar opportunities'");
    expect(src).not.toContain('Subcontract targets nearby');
  });
});

describe('GOS #10 — content sections that can have data always render', () => {
  it('Scope of work + Related opportunities render a placeholder when empty', () => {
    expect(src).toContain('No scope-of-work text has been extracted');
    expect(src).toContain('No related open opportunities found');
  });
});

describe('GOS #10 — Awarded / Company / Buyer drawers apply the same rule', () => {
  it('renderRecompeteIntel takes {} and always renders agency intel + pricing', () => {
    expect(src).toMatch(/function renderRecompeteIntel\(intel\)\{\s*intel=intel\|\|\{\};/);
  });
  it('company sections render placeholders when empty', () => {
    expect(src).toContain('No agency award breakdown on file');
    expect(src).toContain('No NAICS breakdown on file');
    expect(src).toContain('No similar firms found for this NAICS');
  });
  it('buyer similar + roster render placeholders when empty', () => {
    expect(src).toContain('No other decision-makers found at');
  });
});
