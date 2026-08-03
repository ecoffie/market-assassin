/**
 * The map-pin POPUP (popupHTML) — DNA identity-first redesign (Eric 2026-08-03,
 * feat/popup-dna-identity). The popup must speak the SAME card language as the result-list
 * card (cardHTML): it REUSES lcHeader / dnaRow / cardHero / fitChips so pin, card and popup
 * can never disagree. This locks Eric's THREE decisions so a future edit can't silently
 * regress them:
 *
 *   1. IDENTITY-FIRST. The popup leads with the lifecycle header + IDENTITY (dnaRow: sub-agency
 *      typography + Landmark anchor + SB-friendly badge). The value HERO (cardHero) comes SECOND.
 *   2. RECOMPETE value = the REAL contract number, NO ≈. Only OPEN/forecast get the ≈ estimate
 *      band. Both go through cardHero, which owns the ≈-glyph rule — so the popup can't diverge.
 *   3. "Current incumbent" is HIDDEN when it equals the title (a recompete's title IS the
 *      incumbent → repeating it is noise). It renders ONLY for a genuine, DIFFERENT incumbent.
 *
 * Asserts on the SHIPPED template (source of truth) + the generated served copy (they must agree).
 * Also EVALs the real popupHTML (extracted with its helpers) against fake `o` objects — a KEMRON
 * recompete (title==incumbent, $46.9M, EPA) and an OPEN opp with a real different incumbent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const gen = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

// ---- static (template-shape) assertions ---------------------------------------------------

describe('popupHTML — DNA identity-first shape (template)', () => {
  // Isolate the popupHTML body (from its declaration to the next function).
  const popupFn = tmpl.slice(tmpl.indexOf('function popupHTML(o){'), tmpl.indexOf('// ---------- listing card ----------'));

  it('REUSES the card identity helpers — no invented equivalents', () => {
    expect(popupFn).toContain('${lcHeader(o)}');
    expect(popupFn).toContain('${dnaRow(o)}');
    expect(popupFn).toContain('${cardHero(o)}');
    expect(popupFn).toContain('${fitChips(o)}');
  });

  it('decision 1 — identity leads, the value HERO comes SECOND', () => {
    const lcIdx = popupFn.indexOf('${lcHeader(o)}');
    const dnaIdx = popupFn.indexOf('${dnaRow(o)}');
    const heroIdx = popupFn.indexOf('${cardHero(o)}');
    const titleIdx = popupFn.indexOf('<div class="pvt">');
    expect(lcIdx).toBeGreaterThan(-1);
    expect(lcIdx).toBeLessThan(dnaIdx);   // lifecycle header opens the popup
    expect(dnaIdx).toBeLessThan(heroIdx); // IDENTITY before the value hero
    expect(heroIdx).toBeLessThan(titleIdx);
  });

  it('decision 2 — the popup no longer prints a raw value cell; the hero owns the number', () => {
    // The old 2x2 grid led with a "Contract value" cell competing with the title — gone.
    expect(popupFn).not.toContain('Contract value');
    // cardHero (the shared formatter) is the single source of the value + the ≈-glyph rule.
    expect(tmpl).toContain('<span class="apx">≈ </span>');
  });

  it('decision 3 — incumbent line is conditional on a genuine DIFFERENT incumbent', () => {
    // The unconditional "Current incumbent = ${o.title}" is gone; it now compares o.incumbent
    // (trimmed, case-insensitive) to the title and omits when equal/absent.
    expect(popupFn).not.toMatch(/Current incumbent<\/div><div class="v">\$\{o\.title\}/);
    expect(popupFn).toMatch(/inc\.toLowerCase\(\)!==String\(o\.title\|\|''\)\.trim\(\)\.toLowerCase\(\)/);
  });

  it('keeps the source-color strip, solicitation line and both CTAs', () => {
    expect(popupFn).toContain('class="pvstrip"');
    expect(popupFn).toContain('Solicitation ${o.sol}');
    expect(popupFn).toContain('${samURL(o)}');
    expect(popupFn).toContain('${draftURL(o)}');
    expect(popupFn).toContain('${draftCTA(o)}');
  });

  it('served copy agrees with the template (sync gate)', () => {
    expect(gen).toContain('${dnaRow(o)}');
    expect(gen).toContain('${cardHero(o)}');
  });
});

// ---- behavioral (real popupHTML eval) assertions ------------------------------------------

// Pull popupHTML + every helper it calls out of the template and eval them so we render REAL
// HTML on fake `o` objects (the extract+eval technique used for the DNA card + parser).
function buildPopup(): (o: unknown) => string {
  const names = [
    'esc', 'lcHeader', 'dnaRow', 'fitChips', 'cardHero', 'estMoney',
    'shortDate', 'longDate', 'daysOut', 'dueDate', 'fmtDays', 'srcColor',
    'cardBadge', 'awardTypeBadge', 'postedAgo', 'earlySignalChip', 'draftURL',
    'draftCTA', 'recompetePlay', 'samURL', 'popupHTML',
  ];
  let src = '';
  for (const n of names) {
    const decl = `function ${n}(`;
    const start = tmpl.indexOf(decl);
    expect(start, `${n} must exist in template.html`).toBeGreaterThan(-1);
    // grab from the declaration to just before the next top-level "function " declaration OR the
    // next "// ----------" section marker (draftCTA is a one-liner followed by the state section,
    // which references OPPS — stop before it so the extracted body stays helper-only).
    const afterFn = tmpl.indexOf('\nfunction ', start + decl.length);
    const afterSec = tmpl.indexOf('\n// ----------', start + decl.length);
    const ends = [afterFn, afterSec].filter((i) => i !== -1);
    const end = ends.length ? Math.min(...ends) : tmpl.length;
    src += tmpl.slice(start, end) + '\n';
  }
  // Constants the helpers reference. TODAY is anchored; SETFULL/AGENCY/CATCOL/SRCLABEL etc.
  const preamble = `
    var TODAY = new Date('2026-08-03T12:00:00');
    var SETFULL = { SDVOSB:'Service-Disabled Veteran-Owned', None:'Open / unrestricted', '':'—' };
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
  // OPEN opp with a real, DIFFERENT inferred incumbent.
  const open = {
    src: 'SAM', title: 'Cloud Migration Support Services', incumbent: 'Booz Allen Hamilton',
    set: 'None', close: '2026-08-20', naics: '541512', cat: 'IT Services',
    agency: 'VA', subAgency: 'Veterans Health Administration', loc: 'Washington, DC',
    sol: '36C10B24R0001', est: 4_900_000, posted: '2026-08-01', sbf: 0, docs: false, fits: 1,
  };

  it('recompete: identity (sub-agency) precedes the REAL value, which carries NO ≈', () => {
    const html = popupHTML(kemron);
    expect(html).toContain('EPA Region 4');            // sub-agency identity shown
    expect(html).toContain('$46.9M');                   // real contract value
    expect(html.indexOf('EPA Region 4')).toBeLessThan(html.indexOf('$46.9M')); // identity FIRST
    // no ≈ anywhere near the recompete value
    expect(html).not.toContain('≈');
  });

  it('recompete: the incumbent line is ABSENT when it equals the title', () => {
    const html = popupHTML(kemron);
    expect(html).not.toContain('Current incumbent');
    // the company name still appears exactly once (as the title), not duplicated in a fld cell
    const occurrences = html.split('KEMRON ENVIRONMENTAL SERVICES INC').length - 1;
    expect(occurrences).toBe(1);
  });

  it('open opp: the ≈ estimate band shows (estimate, not a firm price)', () => {
    const html = popupHTML(open);
    expect(html).toContain('≈');
    expect(html).toContain('$4.9M');
    expect(html).toContain('Veterans Health Administration'); // sub-agency identity
    expect(html.indexOf('Veterans Health Administration')).toBeLessThan(html.indexOf('$4.9M'));
  });

  it('open opp: a genuine DIFFERENT incumbent IS shown', () => {
    const html = popupHTML(open);
    expect(html).toContain('Current incumbent');
    expect(html).toContain('Booz Allen Hamilton');
  });

  it('never fabricates: a recompete with no real value shows the honest pending treatment, not $0', () => {
    const html = popupHTML({ ...kemron, value: '' });
    expect(html).not.toContain('$0');
    expect(html).toContain('Value on file at SAM'); // cardHero's honest pending block
  });
});
