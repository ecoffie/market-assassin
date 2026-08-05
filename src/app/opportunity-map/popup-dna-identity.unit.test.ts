/**
 * The map-pin POPUP (popupHTML) — the frozen "Expanded Decision Card" (Eric 2026-08-04,
 * feat/expanded-decision-card-popup). The popup is a COMPRESSED DECISION PREVIEW, not a
 * mini-listing: it answers "is this worth opening the full listing?" in six calm slots and
 * pushes everything heavier (the four-box grid, NAICS, response-due, solicitation #,
 * "View on SAM") DOWN to the listing. This locks the frozen contract so a future edit can't
 * silently regress it:
 *
 *   1. IDENTITY-FIRST. lifecycle header → IDENTITY (dnaRow) → value HERO (cardHero) → title.
 *   2. The value HERO owns the ≈-glyph rule: OPEN (modeled) gets ≈; RECOMPETE (real award
 *      value) and FORECAST (the agency's OWN published estimated_value_range) get NO ≈.
 *   3. ONE context sentence (pvSentence) from the row's own fields, never AI.
 *   4. ONE set-aside/context chip (pvSetRow): open set-aside or "Open competition"; forecast
 *      "Open competition" + "Not yet on SAM.gov"; recompete NOTHING (no "Win odds").
 *   5. ONE lifecycle-matched CTA (lcCTA): Track Forecast / Review Opportunity / Analyze Recompete.
 *   6. The heavy freight is GONE — no grid2, no "Current incumbent" cell, no "Solicitation" line,
 *      no "View on SAM" secondary link. They live at the listing level.
 *
 * Asserts on the SHIPPED template (source of truth) + the generated served copy (they must agree),
 * and EVALs the real popupHTML (extracted with its helpers) against fake `o` objects.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const gen = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

// ---- static (template-shape) assertions ---------------------------------------------------

describe('popupHTML — Expanded Decision Card shape (template)', () => {
  // Isolate the popupHTML body (from its declaration to the next function / listing-card section).
  const popupFn = tmpl.slice(tmpl.indexOf('function popupHTML(o){'), tmpl.indexOf('// ---------- listing card ----------'));

  it('REUSES the card identity helpers — no invented equivalents', () => {
    expect(popupFn).toContain('${lcHeader(o)}');
    expect(popupFn).toContain('${dnaRow(o)}');
    expect(popupFn).toContain('${cardHero(o)}');
    // Popup DNA reveal = 3 grounded genome strands via dnaChips (was fitChips, Eric 2026-08-04:
    // strict progressive reveal — card=1 strand (dnaRow), popup=3 (dnaChips), listing=all).
    expect(popupFn).toContain('${dnaChips(o)}');
  });

  it('decision 1 — identity leads, the value HERO comes SECOND, title THIRD', () => {
    const lcIdx = popupFn.indexOf('${lcHeader(o)}');
    const dnaIdx = popupFn.indexOf('${dnaRow(o)}');
    const heroIdx = popupFn.indexOf('${cardHero(o)}');
    const titleIdx = popupFn.indexOf('<div class="pvt">');
    expect(lcIdx).toBeGreaterThan(-1);
    expect(lcIdx).toBeLessThan(dnaIdx);   // lifecycle header opens the popup
    expect(dnaIdx).toBeLessThan(heroIdx); // IDENTITY before the value hero
    expect(heroIdx).toBeLessThan(titleIdx);
  });

  it('slots 3+4 — one context sentence then one set-aside/context chip', () => {
    expect(popupFn).toContain('${sent?');           // the one sentence, conditional
    expect(popupFn).toContain('pvSentence(o)');       // built from the row's fields
    expect(popupFn).toContain('${pvSetRow(o)}');      // one chip row
  });

  it('slot 6 — a single lifecycle-matched CTA that opens the drawer, no secondary "View on SAM"', () => {
    expect(popupFn).toContain('class="pva pri pv-cta"');
    expect(popupFn).toContain('${lcCTA(o)}');
    expect(popupFn).toContain('openOppDrawer');        // stays on-map (flywheel), never claude.ai
    expect(popupFn).not.toContain('draftURL(o)');      // no off-site leak
    expect(popupFn).not.toContain('View on SAM');      // moved to the listing
    // the actions block renders the single CTA var; the CTA carries the pv-cta hook
    expect(popupFn).toContain('<div class="pvacts">${cta}</div>');
  });

  it('the heavy freight is GONE — no grid2, incumbent cell, or solicitation line', () => {
    expect(popupFn).not.toContain('class="grid2"');
    expect(popupFn).not.toContain('Current incumbent');
    expect(popupFn).not.toContain('Solicitation ${o.sol}');
    expect(popupFn).not.toContain('Win probability');    // no scoring language on the popup
  });

  it('lcCTA maps each lifecycle to its own verb', () => {
    const lcCTA = tmpl.slice(tmpl.indexOf('function lcCTA(o){'), tmpl.indexOf('function lcCTA(o){') + 260);
    expect(lcCTA).toContain("'Track Forecast'");
    expect(lcCTA).toContain("'Analyze Recompete'");
    expect(lcCTA).toContain("'Review Opportunity'");
  });

  it('cardHero shows the agency range (no ≈) for FORECAST and the ≈ M-Estimate only for OPEN', () => {
    const hero = tmpl.slice(tmpl.indexOf('function cardHero(o){'), tmpl.indexOf('function dueDate(o){'));
    // FORECAST branch leads with the agency's verbatim estRange, in a violet hero, NO ≈
    expect(hero).toContain("if(o.src==='FORECAST')");
    expect(hero).toContain('class="chero fore"');
    expect(hero).toContain('esc(er)');
    // the ≈ glyph belongs ONLY to the modeled open-opp path
    expect(hero).toContain('<span class="apx">≈ </span>');
  });

  it('served copy agrees with the template (sync gate)', () => {
    expect(gen).toContain('${dnaRow(o)}');
    expect(gen).toContain('${cardHero(o)}');
    expect(gen).toContain('pv-cta');
  });
});

// ---- behavioral (real popupHTML eval) assertions ------------------------------------------

// Pull popupHTML + every helper it calls out of the template and eval them so we render REAL
// HTML on fake `o` objects (the extract+eval technique used for the DNA card + parser).
function buildPopup(): (o: unknown) => string {
  const names = [
    'esc', 'shortAgency', 'lcHeader', 'dnaTop', 'dnaRow', 'dnaChips', 'dueChip', 'pvLoc',
    'cardHero', 'estMoney', 'estMoneyExact',
    'shortDate', 'longDate', 'daysOut', 'dueDate', 'fmtDays', 'srcColor',
    'cardBadge', 'awardTypeBadge', 'postedAgo', 'earlySignalChip', 'draftURL',
    'draftCTA', 'recompetePlay', 'samURL', 'pvSentence', 'pvSetRow', 'lcCTA', 'popupHTML',
  ];
  let src = '';
  for (const n of names) {
    const decl = `function ${n}(`;
    const start = tmpl.indexOf(decl);
    expect(start, `${n} must exist in template.html`).toBeGreaterThan(-1);
    // grab from the declaration to just before the next top-level "function " declaration OR the
    // next "// ----------" section marker.
    const afterFn = tmpl.indexOf('\nfunction ', start + decl.length);
    const afterSec = tmpl.indexOf('\n// ----------', start + decl.length);
    const ends = [afterFn, afterSec].filter((i) => i !== -1);
    const end = ends.length ? Math.min(...ends) : tmpl.length;
    src += tmpl.slice(start, end) + '\n';
  }
  // Constants the helpers reference. TODAY is anchored; SETFULL/AGENCY/CATCOL/SRCLABEL etc.
  const preamble = `
    var TODAY = new Date('2026-08-03T12:00:00');
    var SETFULL = { SDVOSB:'Service-Disabled Veteran-Owned', WOSB:'Women-Owned Small Business', None:'Open / unrestricted', NONE:'Open / unrestricted', '':'—' };
    var AGENCY = { EPA:'Environmental Protection Agency', VA:'Veterans Affairs' };
    function cv(){ return '#000'; }
    function catColor(){ return '#000'; }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(`${preamble}\n${src}\n return popupHTML;`)() as (o: unknown) => string;
}

describe('popupHTML — rendered output (real eval)', () => {
  const popupHTML = buildPopup();

  // KEMRON — a recompete whose title IS the incumbent, firm value $46.9M, sub-agency EPA.
  const kemron = {
    src: 'RECOMPETE', title: 'KEMRON ENVIRONMENTAL SERVICES INC', incumbent: 'KEMRON ENVIRONMENTAL SERVICES INC',
    value: '$46.9M', prob: 'high', cat: 'Environmental Remediation', naics: '562910',
    agency: 'EPA', subAgency: 'EPA Region 4', loc: 'Atlanta, GA', sol: 'EP-R4-23-001',
    exp: '2027-03-31', sbf: 1, est: 0, docs: false,
  };
  // OPEN opp with a modeled estimate + a real set-aside.
  const open = {
    src: 'SAM', title: 'Cloud Migration Support Services',
    set: 'WOSB', close: '2026-08-20', naics: '541512', cat: 'IT Services',
    agency: 'VA', subAgency: 'Veterans Health Administration', loc: 'Washington, DC',
    sol: '36C10B24R0001', est: 4_900_000, posted: '2026-08-01', sbf: 0, docs: false, fits: 1,
  };
  // FORECAST with the agency's OWN published range (no ≈).
  const forecast = {
    src: 'FORECAST', title: 'AA Romania CMAV/SRA', set: 'NONE',
    naics: '336611', cat: 'Forecast · Q2 FY2026', agency: 'Navy', subAgency: 'Navy',
    loc: 'Constanta, Romania', sol: 'fc-abc', nid: 'fc-abc', close: '2026-04-01',
    est: 7_500_000, estRange: '$2M - $7.5M',
  };

  it('recompete: identity (sub-agency) precedes the REAL value, which carries NO ≈, and no Win-odds', () => {
    const html = popupHTML(kemron);
    expect(html).toContain('EPA Region 4');            // sub-agency identity shown
    expect(html).toContain('$46.9M');                   // real contract value
    expect(html.indexOf('EPA Region 4')).toBeLessThan(html.indexOf('$46.9M')); // identity FIRST
    expect(html).not.toContain('≈');                    // real value → no glyph
    expect(html).not.toMatch(/Win odds|Win probability/); // scoring language removed from the card
    // the one sentence is the incumbent-expiry line, built from o.exp
    expect(html).toContain('Incumbent expires');
    // CTA matches the lifecycle
    expect(html).toContain('Analyze Recompete');
  });

  it('recompete: the incumbent is not duplicated (no incumbent cell) — company appears once', () => {
    const html = popupHTML(kemron);
    expect(html).not.toContain('Current incumbent');
    const occurrences = html.split('KEMRON ENVIRONMENTAL SERVICES INC').length - 1;
    expect(occurrences).toBe(1);
  });

  it('open opp: the ≈ estimate band shows, the set-aside chip + due sentence render, CTA = Review Opportunity', () => {
    const html = popupHTML(open);
    expect(html).toContain('≈');
    expect(html).toContain('$4.9M');
    expect(html).toContain('Veterans Health Administration'); // sub-agency identity
    expect(html.indexOf('Veterans Health Administration')).toBeLessThan(html.indexOf('$4.9M'));
    expect(html).toContain('Due ');                            // the one sentence
    expect(html).toContain('Women-Owned Small Business');      // set-aside chip
    expect(html).toContain('Review Opportunity');
  });

  it('forecast: shows the agency\'s OWN published range VERBATIM with NO ≈, plus the differentiator tag + Track CTA', () => {
    const html = popupHTML(forecast);
    expect(html).toContain('$2M - $7.5M');   // the agency's verbatim range, shown as-is
    expect(html).not.toContain('≈');          // a real gov figure, never the modeled glyph
    // the hero renders the verbatim range, NOT the modeled estMoney(est) "$7.5M" single value
    expect(html).toContain('class="chero fore"><div class="cval">$2M - $7.5M<');
    expect(html).toContain('Planned for');    // the one sentence (timing from o.cat)
    expect(html).toContain('Not yet on SAM.gov');
    expect(html).toContain('Track Forecast');
  });

  it('never fabricates: a recompete with no real value shows the honest pending treatment, not $0', () => {
    const html = popupHTML({ ...kemron, value: '' });
    expect(html).not.toContain('$0');
    expect(html).toContain('Value on file at SAM'); // cardHero's honest pending block
  });

  it('forecast: no published range → honest "Estimate pending", never a modeled number', () => {
    const html = popupHTML({ ...forecast, estRange: '' });
    expect(html).toContain('Estimate pending');
    expect(html).not.toContain('≈');
  });
});
