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
  it('the M-Estimate DETAIL block is back under Market Intelligence (number + chart + comps), hero keeps the headline', () => {
    // Eric 2026-08-04: "put M-estimate detail info with number back down there … we can show it like
    // this" (the Zillow value-history mockup). renderIntel now EMITS mEstMethodologyHTML(vr,p) as the
    // Market Intelligence lead — the number is reprinted here (detailed context) with the distribution
    // chart + the incumbent comp chip. This is deliberate, NOT the old duplicate-number bug.
    expect(src).toMatch(/out\+=mEstMethodologyHTML\(vr,p\);/);          // the live (re-enabled) call
    expect(src).toContain('Value history');                            // the value-history header (mockup)
    expect(src).toContain('mest-num');                                  // the reprinted number lives here
    expect(src).toContain('mest-comps');                               // the grounded comp chip(s)
    // The detail block owns the CHART; the hero stays a card (no chart), still with the headline number.
    // Slice mEstTopHTML from its signature to the NEXT "  function " declaration (mEstMethodologyHTML)
    // so only mEstTopHTML's body is checked — its own comment block ends where the next fn begins.
    const topStart = src.indexOf('function mEstTopHTML(vr,pinEst)');
    const topFn = src.slice(topStart, src.indexOf('\n  function ', topStart + 10));
    expect(topFn).not.toContain('vrChart(');          // no distribution chart RENDER in the hero
    expect(topFn).toContain('vr-band');               // the likely-band subtext now rides the hero
    expect(topFn).toContain('mEstBasis(vr)');          // "N comparable federal awards" — real, not faked
    expect(topFn).toContain('vr-big');                 // the single headline number lives here
    // HEADLINE + BAND FROM THE SAME OBJECT (Eric 2026-08-04: "$898,136 · Likely $25.2M–$34M" was the
    // pin est under the fetched predecessor band — a number outside its own range). The fetched
    // valueRange median is AUTHORITATIVE when present (headline+band+basis all coherent); pinEst is
    // ONLY the pre-fetch placeholder.
    expect(topFn).toMatch(/var headline=\(vr&&vr\.median\)\?vr\.median:\(\(typeof pinEst==='number'&&pinEst>0\)\?pinEst:0\)/);
    expect(topFn).toContain('esc(fmtM(headline))');    // the hero renders the coherent headline
  });
  it('the top price header is ALWAYS filled after the intel fetch (success AND failure), seeded from the pin est', () => {
    // Success path passes the pin est so the drawer number equals the pin/card.
    expect(src).toMatch(/fillMEstTop\(intel\.valueRange,_pinEst\)/);   // success path
    expect(src).toMatch(/catch\(function\(\)\{ fillMEstTop\(null,_pinEst\)/); // failure path keeps the pin est
    // And it seeds the hero IMMEDIATELY (before the intel fetch) when the pin already has an est.
    expect(src).toMatch(/if\(_pinEst>0\)fillMEstTop\(null,_pinEst\)/);
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
    // FORECAST anchors (Eric 2026-08-05, "forecasts are an early-capture product") are ADDITIVE to
    // each group's candidate list — the SAME eight tabs resolve for the forecast drawer (fcdesc→
    // Opportunity, fcmkt→Market, fcpoc→Buyer, fcwin→Related), so a forecast reads in the identical
    // reading order as an open opp. The forecast anchor is listed LAST in its group (open-opp anchors
    // win when both are present; only a forecast pin emits the fc* ids).
    expect(src).toContain("[['overview','value'],'Snapshot']");
    expect(src).toContain("[['ai'],'Should I pursue?']");
    expect(src).toContain("[['facts','description','sow','sowfacts','fcdesc'],'Opportunity']");
    expect(src).toContain("[['mest','incumbent','pricing','taskorders','fcmkt'],'Market']");
    // Buyer Intelligence absorbs Decision makers (Eric FINAL spec: contacts/roster are sub-parts of
    // "Who am I selling to?"), so they share the ONE Buyer tab — no separate Decision-makers tab.
    expect(src).toContain("[['agencyintel','contacts','roster','fcpoc'],'Buyer']");
    expect(src).toContain("[['subtargets','openbids'],'Teaming']");
    expect(src).toContain("[['similar','fcwin'],'Related']");
    // TEAMING before RELATED (Eric 2026-08-04: once interested, the next thought is "who can help me
    // WIN this?" — THEN "what else is similar?"). Teaming's group is declared before Related's.
    expect(src.indexOf("[['subtargets','openbids'],'Teaming']")).toBeLessThan(src.indexOf("[['similar','fcwin'],'Related']"));
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
  it('"Should I Pursue This?" IS the decision card — NO standalone AI button; Bid/No-Bid lives inside', () => {
    // The section is fillPursue → #pursueBox. NO standalone "run AI analysis" button on screen
    // (Eric 2026-08-04: "you cannot have an ai button on the screen ... remove it").
    expect(src).toContain('id="pursueBox"');
    expect(src).toContain('function fillPursue(res,oppId,opp,vr,pin)');       // opp+vr+pin threaded (pin = Universal DNA)
    expect(src).toContain('fillPursue(res||{grounded:false},opp&&opp.id,opp,vr,pin)'); // wired w/ opp id + opp + vr + pin
    expect(src).toContain('function loadMWin(opp,vr,pin)');                   // loadMWin forwards the pin's DNA
    // aiSec RENDERS just the two slots — no standalone AI button in the section markup.
    expect(src).toContain('\'<div id="pursueBox"></div><div id="aiBox"></div>\'');
    // The old standalone-button markup (an ai-run button labeled "run AI analysis" inside aiBox's
    // initial render) is GONE — aiSec no longer emits a <button class="ai-run" …>run AI analysis.
    expect(src).not.toContain('Should I bid on this? \\u2014 run AI analysis');
    // GROUNDED card: Pursue/Watch/Skip badge + Why/Risks columns, never faked (grounded gate).
    expect(src).toContain('class="pursue-badge"');
    expect(src).toContain('pursue-cl why');
    expect(src).toContain('pursue-cl risk');
    // Bid/No-Bid lives inside the card (runs the deep AI on demand into #aiBox).
    expect(src).toContain('class="pursue-bid"');
    expect(src).toContain('Run Bid / No-Bid analysis');
    // UNIVERSAL vs PERSONAL DNA (Eric 2026-08-04): the shell leads with GROUNDED "Opportunity signals"
    // true for EVERY viewer (SB-friendly buyer, Early-in-the-cycle, Recompete/Forecast, Closes-soon) —
    // NOT the hero's facts (no repetition), and NOT profile-dependent signals ("Fits your NAICS" is
    // reserved for the gated recommendation, since it can't be grounded for an anonymous viewer).
    expect(src).toContain('function pursueSignals(opp,pin)');               // the Universal-DNA signal builder
    expect(src).toContain('Opportunity signals');                          // the section header
    expect(src).toContain('Small-business friendly buyer');                // a grounded universal signal (pin.sbf)
    expect(src).toContain('Early in the buying cycle');                    // grounded from notice type
    expect(src).toContain('pursue-signals');                               // the signals block renders in the shell
    // NO empty Why/Risks/Win-factors preview headers in the pre-analysis shell (Eric: reads unfinished).
    expect(src).not.toContain('pursue-lock-heads');
    // "Fits your NAICS" must NOT appear as an ungated universal signal (it's PERSONAL DNA).
    expect(src.slice(src.indexOf('function pursueSignals'), src.indexOf('function fillPursue'))).not.toContain('Fits your NAICS');
    expect(src).toContain("res&&res.reason==='signed_out'");
    expect(src).toContain('pursue-lock-cta');                              // the sign-in / setup CTA link
    expect(src).toContain('/app?next=%2Fopportunity-map');                 // signed-out → sign in
    expect(src).toContain('Sign in for your recommendation');             // the value-ladder CTA copy
    expect(src).toContain('reason:\'signed_out\'');                        // loadMWin passes it when no token
  });
  it('M-Win rides the hero beside M-Estimate — grounded or an honest locked card, never a fake %', () => {
    // The two branded numbers sit in a .herotwo grid: #mEstTop (M-Estimate) + #mWinTop (M-Win).
    expect(src).toContain('class="herotwo"');
    expect(src).toContain('id="mWinTop"');
    // M-Win fills from its OWN async fetch (loadMWin) → the M-Estimate never waits on it. It scores on
    // the SAME number the hero shows: the fetched valueRange median when present, else the pin est.
    expect(src).toContain('loadMWin(d.opp,intel.valueRange&&intel.valueRange.median?intel.valueRange:(_pinEst>0?{median:_pinEst}:intel.valueRange),_pin)');
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
  it('HERO facts = exactly the 4 Eric specced (Due · Set-aside · Agency · Location) — codes moved down', () => {
    // Eric 2026-08-04: the hero shows Response Due · Set-aside · Agency · Location. The technical
    // codes (NAICS · PSC · Posted · Solicitation) live DOWN in Opportunity Intelligence, not the hero.
    const sf = src.slice(src.indexOf('function snapshotFacts(o)'), src.indexOf('\n  function ', src.indexOf('function snapshotFacts(o)') + 20));
    expect(sf).toContain('>Response due<');
    expect(sf).toContain('>Set-aside<');
    expect(sf).toContain('>Agency<');
    expect(sf).toContain('>Location<');
    // the codes are NOT in the hero grid (they belong to Opportunity Intelligence / bidFactsSec)
    expect(sf).not.toContain('>NAICS<');
    expect(sf).not.toContain('>PSC<');
    expect(sf).not.toContain('>Solicitation<');
    expect(sf).not.toContain('>Posted<');
  });
  it('Should-I-pursue (ai) comes BEFORE the opportunity-intel facts', () => {
    // The decision is promoted to the top of the flow, above the detail.
    expect(at('aiSec(o)')).toBeGreaterThan(-1);
    expect(at('aiSec(o)')).toBeLessThan(at('bidFactsSec(extra.bidFacts,o)'));
  });
  it('Teaming comes BEFORE Related, both before the action bar (Eric 2026-08-04: "who can help me?" then "what else is similar?")', () => {
    // Order: … Buyer → Decision makers → TEAMING (#xsellSub) → RELATED (similar) → Actions. Once
    // interested, the next thought is "who can help me win this?" (Teaming), THEN "what else is
    // similar?" (Related). Related is the last browse row before the sticky bar.
    expect(at("id=\"xsellSub\"")).toBeLessThan(at('similarSec(extra.similar)')); // Teaming BEFORE Related
    expect(at('similarSec(extra.similar)')).toBeLessThan(at('actions(o)'));      // Related before the sticky bar
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
    // The two INTELLIGENCE sections, Title Case (Eric 2026-08-04): Opportunity Intelligence
    // (everything about the opp) + Market Intelligence (the moat — what the market looks like).
    expect(src).toContain("sec('Opportunity Intelligence'"); // was "Bid facts" → "Opportunity intelligence" → Title Case
    expect(src).toContain("sec('Market Intelligence'");      // NEW group header anchoring the market cluster (osec-mest)
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
