/**
 * The ONE name-quality contract — placeholder suppression and display cleaning.
 *
 * Every fixture is a REAL value measured in federal_contacts on 2026-09-15, not an invented
 * shape. The "must survive" block is the half that matters: a guard that suppresses junk by
 * also suppressing people is a worse bug than the one it fixes.
 */
import { describe, it, expect } from 'vitest';
import {
  isUsableContactName, displayContactName, PLACEHOLDER_NAME_PREFIXES, placeholderNameFilter,
} from './contact-quality';

describe('placeholder shapes are suppressed', () => {
  it.each([
    // the shapes the ORIGINAL guard already caught
    ['Telephone: 7175503112'],
    ['Phone: 555-0100'],
    ['Fax: 555 1234'],
    ['Tel: (614) 692-3131'],
    // facsimile — MISSED until 2026-09-15, 26 rows rendered a fax number as a buyer name
    ['Facsimile: 0000000000'],
    ['Facsimile: 0034956822332'],
    ['Facsimile: 555-555-1212'],
    // "ELECTRONIC MAIL: <address>" — 873 rows
    ['ELECTRONIC MAIL: AUSTIN.SHATTO@DLA.MIL'],
    ['Electronic Mail: person@example.gov'],
    ['ELECTRONIC MAIL: TAYLOR.M.WEIDMAN2.CIV@US.NAVY.MIL'],
    // unlabelled digit strings
    ['7175503112'],
    ['(614) 692-3131'],
  ])('rejects %s', (name) => {
    expect(isUsableContactName(name)).toBe(false);
    expect(displayContactName(name)).toBeNull();
  });

  it.each([
    ['CONTRACTING OFFICER'], ['Contracting Officer'], ['CONTRACT SPECIALIST'],
    ['BAA COORDINATOR'], ['PROCUREMENT TEAM'], ['PROCUREMENT'], ['PURCHASING'],
    ['CONTRACT OFFICER'], ['CONTRACTING OFFICE'], ['POC'],
    ['  contracting   officer  '],   // whitespace-collapsed before the exact match
  ])('rejects the bare role label %s', (name) => {
    expect(isUsableContactName(name)).toBe(false);
  });

  it('rejects empty and whitespace', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(isUsableContactName(v)).toBe(false);
      expect(displayContactName(v)).toBeNull();
    }
  });
});

describe('real names MUST survive — the half that matters', () => {
  it.each([
    ['Jane Doe'],
    ["O'Brien-Smith, Patricia"],
    ['BOOKER L. JORDAN, JR.'],
    ['ABEGAIL B. LAMBAN-TUBO'],
    ['JESÚS GONZÁLEZ'],
    ['Maryam,Sabri'],
    // these CONTAIN a suppressed token but are people — proof the rules are not substring rules
    ['Michael Faxon'],                    // contains "fax"
    ['Telephone Jones'],                  // starts with "telephone" but no digit payload
    ['Contracting Officer Jane Smith'],   // role words + a real name, not a bare label
    ['April Mailer'],                     // contains "mail"
    ['Sean P. Searcie'],
    ['M. Shannon Lindsay'],
  ])('keeps %s', (name) => {
    expect(isUsableContactName(name)).toBe(true);
    expect(displayContactName(name)).toBeTruthy();
  });
});

describe('display cleaning — the Alicia Wargo class (12.8% of rows)', () => {
  it.each([
    // the outliers that taught us this, verbatim from the corpus
    ['Alicia Wargo 771-229-0601', 'Alicia Wargo'],
    ['Alicia Wargo\r\n771-229-0601\r\nalicia.l.wargo.civ@us.navy.mil', 'Alicia Wargo'],
    ['Alicia Wargo 771-229-0601 alicia.l.wargo.civ@us.navy.mil', 'Alicia Wargo'],
    ['Stephen Weaver6142923131', 'Stephen Weaver'],
    ['Jennifer Payne614-692-1629', 'Jennifer Payne'],
    ['Natalya RadykDSN312-850-4033', 'Natalya Radyk'],     // DSN glued with no space
    ['Deborah Ferrin(614 693-1652', 'Deborah Ferrin'],      // trailing punctuation residue
    ['Mary Shannon Lindsay 267-660-8079', 'Mary Shannon Lindsay'],
    ['Alicia Wargo', 'Alicia Wargo'],                        // already clean → unchanged
    ['Angela Haden(445)737-4366', 'Angela Haden'],
    ['Mary Repole+1 445-737-4384', 'Mary Repole'],           // leading "+1" on the phone run
    ['Cheryl BroadieDSN695-5488', 'Cheryl Broadie'],
    ['Charlie  Augustin', 'Charlie Augustin'],               // whitespace collapsed
  ])('%s -> %s', (raw, expected) => {
    expect(displayContactName(raw)).toBe(expected);
  });

  it('suppresses rather than inventing when nothing person-like survives', () => {
    // 6 rows in the corpus reduce to nothing once the phone run is stripped.
    expect(displayContactName('614-692-3131 (614) 692')).toBeNull();
  });

  it.each([
    ['CASEY STOCK, APAC.40, PHONE (215)737-0543, EMAIL CASEY.STOCK@DLA.MIL', 'CASEY STOCK, APAC.40'],
    ['JEREMY P. BARNEY, N722.10, EMAIL JEREMY.P.BARNEY.CIV@US.NAVY.MIL', 'JEREMY P. BARNEY, N722.10'],
    ['MARY S. LINDSAY, APBA.29, PHONE (215)737-3832, EMAIL MARY.LINDSAY@DLA.MIL', 'MARY S. LINDSAY, APBA.29'],
  ])('cuts SAM structured contact blocks: %s', (raw, expected) => {
    expect(displayContactName(raw)).toBe(expected);
  });

  it.each([
    // the local part IS the surname — the domain goes, the name stays
    ['Tamara Feist-Hatfield@va.gov', 'Tamara Feist-Hatfield'],
    ['Anna Bournakis@us.af.mil', 'Anna Bournakis'],
    ['Brian Whalen-Crichton@va.gov', 'Brian Whalen-Crichton'],
    // a DOTTED local part is a machine address, not a surname — the whole token goes
    ['Megan Emery\r\nmegan.p.emery.civ@us.navy.mil', 'Megan Emery'],
    ['Alicia Wargo alicia.l.wargo.civ@us.navy.mil', 'Alicia Wargo'],
  ])('keeps a surname fused to a domain: %s', (raw, expected) => {
    expect(displayContactName(raw)).toBe(expected);
  });

  it('the contact-keyword cut is a WHOLE-token match', () => {
    // ", EMAILY" must not trigger the ", EMAIL" cut.
    expect(displayContactName('SMITH, EMAILY')).toBe('SMITH, EMAILY');
  });

  it('leaves a legitimate parenthetical alone', () => {
    // An unconditional trailing-punct trim turned this into "HYONTONG YANG (Rio" in a real
    // corpus run. Trailing punctuation is only trimmed when a strip actually occurred.
    expect(displayContactName('HYONTONG YANG (Rio)')).toBe('HYONTONG YANG (Rio)');
    expect(displayContactName('Patricia Shaw (Acting)')).toBe('Patricia Shaw (Acting)');
  });

  it('never destroys a numeric name disambiguator', () => {
    // Measured: ZERO corpus names end in a single glued digit, so the strip cannot eat one.
    // A spaced suffix is not a phone run and must be preserved.
    expect(displayContactName('John Smith 3rd')).toBe('John Smith 3rd');
  });
});

describe('one contract across every surface', () => {
  it('exports the query-level prefixes that the four route files used to hand-copy', () => {
    expect([...PLACEHOLDER_NAME_PREFIXES]).toEqual(
      ['telephone:', 'phone:', 'fax:', 'tel:', 'facsimile:', 'electronic mail:'],
    );
  });

  it('placeholderNameFilter applies every prefix to the query builder', () => {
    const calls: Array<[string, string, string]> = [];
    const fake = { not(c: string, op: string, v: string) { calls.push([c, op, v]); return this; } };
    placeholderNameFilter(fake);
    expect(calls.map((c) => c[2])).toEqual(PLACEHOLDER_NAME_PREFIXES.map((p) => `${p}%`));
    expect(calls.every((c) => c[0] === 'contact_fullname' && c[1] === 'ilike')).toBe(true);
  });

  it('the query prefixes and the regex agree — a prefix match implies an unusable name', () => {
    // If these two drift, the query hides a row the JS guard would have allowed (or worse,
    // the reverse). Each prefix with a digit payload must fail isUsableContactName.
    for (const p of PLACEHOLDER_NAME_PREFIXES) {
      const sample = p === 'electronic mail:' ? `${p} someone@agency.gov` : `${p} 555-555-1212`;
      expect(isUsableContactName(sample), sample).toBe(false);
    }
  });
});
