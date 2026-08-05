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
    // Popup DNA reveal = "Why this opportunity" GROUPED by meaning + deduped (whyGroups, Eric
    // 2026-08-04): Opportunity · Eligibility · Timing, pills without checkmarks, sources_sought
    // absorbs early_cycle. (Was fitChips → dnaChips → whyChips → whyGroups.)
    expect(popupFn).toContain('${whyGroups(o)}');
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

  it('slots 3+4 — the context sentence renders ONLY for recompete/forecast; pvSetRow is FORECAST-only (its "Not yet on SAM.gov" tag)', () => {
    // OPEN opps drop pvSentence (its Due/Posted duplicate the header + the Timing pill); recompete
    // "Incumbent expires" / forecast "Planned for" still render — so the sentence is gated by src.
    expect(popupFn).toMatch(/\(o\.src==='RECOMPETE'\|\|o\.src==='FORECAST'\)&&sent\?/);
    expect(popupFn).toContain('pvSentence(o)');       // still built from the row's fields
    // pvSetRow now renders ONLY for FORECAST (its "Not yet on SAM.gov" differentiator tag). OPEN's
    // set-aside lives in the whyGroups Eligibility pill; recompete has none.
    expect(popupFn).toMatch(/o\.src==='FORECAST'\?pvSetRow\(o\):''/);
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
    'esc', 'shortAgency', 'titleCaseWord', 'cleanTitle', 'tidyLoc', 'lcHeader', 'dnaOrder', 'dnaTop', 'dnaRow', 'dnaChips',
    'whyGroups', 'confLine', 'dueChip', 'pvLoc', 'setAsideLabel', 'cardHero', 'estMoney', 'estMoneyExact',
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
  // cleanTitle references the module-level TITLE_ABBR/TITLE_STOP dicts — pull them from the template
  // verbatim so the real expansion is exercised (not a stub).
  const titleAbbr = (tmpl.match(/var TITLE_ABBR = \{[\s\S]*?\};/) || [''])[0];
  const titleStop = (tmpl.match(/var TITLE_STOP = \{[\s\S]*?\};/) || [''])[0];
  const preamble = `
    var TODAY = new Date('2026-08-03T12:00:00');
    var SETFULL = { SDVOSB:'Service-Disabled Veteran-Owned', WOSB:'Women-Owned Small Business', None:'Open / unrestricted', NONE:'Open / unrestricted', '':'—' };
    var AGENCY = { EPA:'Environmental Protection Agency', VA:'Veterans Affairs' };
    ${titleAbbr}
    ${titleStop}
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

  it('recompete: the incumbent is not duplicated (no incumbent cell) — company appears once, title-cased', () => {
    const html = popupHTML(kemron);
    expect(html).not.toContain('Current incumbent');
    // cleanTitle title-cases the SHOUTING title (the recompete title IS the incumbent name), so the
    // card reads "Kemron Environmental Services Inc" not the raw all-caps — appearing exactly once.
    const occurrences = html.split('Kemron Environmental Services Inc').length - 1;
    expect(occurrences).toBe(1);
    expect(html).not.toContain('KEMRON ENVIRONMENTAL SERVICES INC'); // the shouting form is gone
  });

  it('open opp: ≈ estimate band, identity-before-value, set-aside named (not the bare program), CTA = Review Opportunity', () => {
    const html = popupHTML(open);
    expect(html).toContain('≈');
    expect(html).toContain('$4.9M');
    expect(html).toContain('Veterans Health Administration'); // sub-agency identity
    expect(html.indexOf('Veterans Health Administration')).toBeLessThan(html.indexOf('$4.9M'));
    // The set-aside reads as a NAMED program, never the bare full name (Eric 2026-08-04). This
    // fixture has no genome, so pvSetRow's fallback pill carries it → "WOSB Set-Aside".
    expect(html).toContain('WOSB Set-Aside');
    expect(html).not.toContain('>Women-Owned Small Business<'); // the old bare pill is gone
    expect(html).toContain('Review Opportunity');
  });

  it('open opp WITH a genome: set-aside is the Eligibility pill (named, once); the buyer strand stays on the identity line', () => {
    const withDna = { ...open, dna: [
      { category: 'buyer', key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 },
      { category: 'approach', key: 'set_aside', label: 'WOSB Set-Aside', tone: 'good', tier: 1 },
    ] };
    const html = popupHTML(withDna);
    expect(html).toContain('Why this opportunity');        // the section heading
    expect(html).toContain('Eligibility');                 // the meaning group
    expect(html).toContain('WOSB Set-Aside');              // the set-aside, named (open.set === 'WOSB')
    expect(html.split('WOSB Set-Aside').length - 1).toBe(1); // exactly once (no dup pill)
    // the top genome strand (Repeat Buyer) rides the IDENTITY line, so it must NOT repeat in the groups
    const grpZone = html.slice(html.indexOf('Why this opportunity'));
    expect(grpZone).not.toContain('Repeat Buyer');
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

// The title/location/ordering refinements (Eric 2026-08-04) — read like a deal, not a solicitation record.
describe('card polish: cleanTitle (deterministic, no LLM) · tidyLoc · Why-order', () => {
  const popupHTML = buildPopup();
  // extract the pure helpers + their dicts and eval them standalone (cleanTitle/tidyLoc call
  // titleCaseWord, so pull it in too).
  function fnText(name: string): string {
    const start = tmpl.indexOf(`function ${name}(`);
    let i = tmpl.indexOf('{', start), d = 0, end = tmpl.length;
    for (; i < tmpl.length; i++) { if (tmpl[i] === '{') d++; else if (tmpl[i] === '}') { d--; if (!d) { end = i + 1; break; } } }
    return tmpl.slice(start, end);
  }
  function pull(name: string): (s: unknown) => string {
    const titleAbbr = (tmpl.match(/var TITLE_ABBR = \{[\s\S]*?\};/) || [''])[0];
    const titleStop = (tmpl.match(/var TITLE_STOP = \{[\s\S]*?\};/) || [''])[0];
    // eslint-disable-next-line no-new-func
    return new Function(`${titleAbbr}\n${titleStop}\n${fnText('titleCaseWord')}\n${fnText(name)}\nreturn ${name};`)() as (s: unknown) => string;
  }

  it('cleanTitle strips the PIID, expands curated abbrevs, and (N-Year) — never inventing a word', () => {
    const cleanTitle = pull('cleanTitle');
    expect(cleanTitle('W911SA26RA026 REGION 3 JOC 5 YEAR')).toBe('Region 3 Job Order Contract (5-Year)');
    expect(cleanTitle('N0001925RQ0042 MATOC FOR HVAC O&M 3 YEAR')).toBe('Multiple Award Task Order Contract for HVAC Operations & Maintenance (3-Year)');
    // a term NOT in the dictionary is never INVENTED into something else — JOC never becomes
    // "Construction"; a plain title just gets cased. (The price of no-LLM determinism.)
    expect(cleanTitle('DEMOLITION SERVICES CONTRACT')).toBe('Demolition Services Contract');
    // a real (long) PIID prefix is stripped; a short token that isn't a PIID is left alone
    expect(cleanTitle('N0018925R0042 DEMOLITION SERVICES')).toBe('Demolition Services');
    // an already mixed-case title is left ALONE
    expect(cleanTitle('F/A-18 Cable Assembly, IRST Program Loader Set')).toBe('F/A-18 Cable Assembly, IRST Program Loader Set');
  });

  it('tidyLoc title-cases a shouting city (Mc-aware) but keeps a 2-letter state code upper', () => {
    const tidyLoc = pull('tidyLoc');
    expect(tidyLoc('FORT MCCOY, WI')).toBe('Fort McCoy, WI'); // Mc-name cased correctly
    expect(tidyLoc('New Jersey')).toBe('New Jersey');
    expect(tidyLoc('WASHINGTON, DC')).toBe('Washington, DC');
  });

  it('whyGroups: groups Opportunity/Eligibility/Timing in order; header has NO Posted', () => {
    const opp = { src: 'SAM', title: 'X', agency: 'ARMY', subAgency: 'ARMY', est: 1_400_000,
      loc: 'Fort McCoy, WI', set: 'HZ', close: '2026-08-07', posted: '2026-07-08', nid: 'z',
      dna: [
        { category: 'opportunity', key: 'sources_sought', label: 'Sources Sought', tone: 'good', tier: 1 },
        { category: 'approach', key: 'set_aside', label: 'HUBZone Set-Aside', tone: 'good', tier: 1 },
        { category: 'buyer', key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 },
      ] };
    const html = popupHTML(opp);
    const why = html.slice(html.indexOf('Why this opportunity'));
    // the meaning-groups render, in order (Timing moved to the header — see below)
    expect(why).toContain('Opportunity'); expect(why).toContain('Eligibility');
    expect(why.indexOf('Opportunity')).toBeLessThan(why.indexOf('Eligibility'));
    expect(why).toContain('Sources Sought');       // Opportunity group
    expect(why).toContain('HUBZone Set-Aside');     // Eligibility group (from o.set='HZ')
    // the DEADLINE moved to the header ("N DAYS LEFT"), so it's NOT a Timing pill in the groups
    expect(why).not.toContain('Due in');
    // Repeat Buyer (top strand) rides the identity line, not repeated in the groups
    expect(why).not.toContain('Repeat Buyer');
    // the header carries urgency on the right + never "Posted"
    const header = html.slice(0, html.indexOf('Why this opportunity'));
    expect(header).not.toContain('Posted');
    expect(header).toMatch(/4 DAYS LEFT/); // TODAY 2026-08-03 → close 08-07
  });

  it('whyGroups DEDUPS: Sources Sought absorbs Early in Cycle (never both)', () => {
    const opp = { src: 'SAM', title: 'X', agency: 'ARMY', subAgency: 'ARMY', est: 1_000_000,
      loc: 'X, TX', set: 'None', close: '2026-08-20', nid: 'z',
      dna: [
        { category: 'timing', key: 'early_cycle', label: 'Early in Cycle', tone: 'good', tier: 1 },
        { category: 'opportunity', key: 'sources_sought', label: 'Sources Sought', tone: 'good', tier: 1 },
        { category: 'buyer', key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 },
      ] };
    const html = popupHTML(opp);
    expect(html).toContain('Sources Sought');
    expect(html).not.toContain('Early in Cycle'); // absorbed — one idea, one pill
  });

  it('confLine: renders the REAL comparable count when present, and nothing when absent (no fabrication)', () => {
    const base = { src: 'SAM', title: 'X', agency: 'ARMY', subAgency: 'ARMY', loc: 'X, TX',
      set: 'None', close: '2026-08-20', nid: 'z', dna: [] };
    expect(popupHTML({ ...base, est: 1_400_000, estN: 62 })).toContain('Estimated from 62 similar awards');
    // no count → no line (never invents a number)
    expect(popupHTML({ ...base, est: 1_400_000, estN: 0 })).not.toContain('similar awards');
    // no estimate → no line
    expect(popupHTML({ ...base, est: 0, estN: 62 })).not.toContain('similar awards');
  });
});
