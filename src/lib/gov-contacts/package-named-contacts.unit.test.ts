/**
 * POTETO — Pursuit Dossier Truth: CONTACT.
 *
 * Measured on VA 36C24226Q0857 (demolition/asbestos, East Orange & Lyons NJ):
 * Michael.Spivack@va.gov is named 3x in the package and was named in NONE of
 * the 10 directory contacts the dossier returned. The package routes the actual
 * work to him:
 *   "all questions ... must be submitted in writing to Michael.Spivack@va.gov"
 *   "Quotes shall be emailed to Michael Spivack at Michael.Spivack@va.gov"
 * while Karmazyn/McIntosh appear only inside a past-performance questionnaire
 * TEMPLATE dated January 2024 — stale, yet both literally labelled
 * "Contracting Officer". Ranking on the printed title surfaced the stale
 * template contact first; ranking on submission routing surfaces the real one.
 */
import { describe, it, expect } from 'vitest';
import { extractPackageNamedContacts, dedupeAgainstPackage } from './package-named-contacts';

const PACKAGE = `
Z1DA--VANJHCS Demolition and Abatement IDIQ East Orange and Lyons.
To preserve the integrity of the procurement process, all questions and requests
for information must be submitted in writing to Michael.Spivack@va.gov.
Questions must be received no later than 10/06/2026 by 12:00pm EST.
...
All proposals are due October 16th, 2026 at 10:00EST. Quotes shall be emailed to
Michael Spivack at Michael.Spivack@va.gov.
${'-'.repeat(400)}
[PAST PERFORMANCE QUESTIONNAIRE TEMPLATE — January 2024]
Once completed, please send the form to the Contracting Officer by emailing
directly to: Hanna.Karmazyn@va.gov
If you have any questions, please contact the Contracting Officer: Elijah.mcintosh@va.gov
Davis-Bacon questions: davisbaconinfo@dol.gov · Protests: EDProtests@va.gov
`;

describe('POTETO CONTACT: the solicitation-named contact outranks the directory', () => {
  it('surfaces the CO the package routes submissions to — FIRST', () => {
    const got = extractPackageNamedContacts(PACKAGE);
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].contact_email.toLowerCase()).toBe('michael.spivack@va.gov');
    expect(got[0].contact_fullname).toBe('Michael Spivack');
  });

  it('a STALE template contact labelled "Contracting Officer" does not outrank them', () => {
    // THE EXACT REGRESSION. Spivack carries NO adjacent title (so roleRank=9)
    // while McIntosh is literally labelled "Contracting Officer" (roleRank=0).
    // Under title-first ranking McIntosh wins; only submission-routing count
    // puts the real contact first. Asserting index 0 is what makes this bind.
    const got = extractPackageNamedContacts(PACKAGE);
    const spiv = got.findIndex((c) => /spivack/i.test(c.contact_email));
    const stale = got.findIndex((c) => /karmazyn|mcintosh/i.test(c.contact_email));
    expect(spiv).toBe(0);
    expect(stale).toBeGreaterThan(0);
    // The stale one carries the authoritative-looking title, which is exactly
    // why title-first ranking chose it.
    expect(got[stale].contact_title).toBe('Contracting Officer');
    // Spivack wins on ROUTING, not on title.
    expect(got[spiv].submission_mentions).toBeGreaterThan(got[stale].submission_mentions);
  });

  it('counts how often the package routes submissions to an address', () => {
    const got = extractPackageNamedContacts(PACKAGE);
    expect(got[0].submission_mentions).toBeGreaterThanOrEqual(2);
  });

  it('drops procedural / org-level mailboxes, never a person', () => {
    const emails = extractPackageNamedContacts(PACKAGE).map((c) => c.contact_email.toLowerCase());
    expect(emails).not.toContain('davisbaconinfo@dol.gov');
    expect(emails).not.toContain('edprotests@va.gov');
  });

  it('never invents a name it cannot derive from the address', () => {
    const got = extractPackageNamedContacts('Contact: coteam@va.gov for all questions.');
    // A single-token local part yields no confident full name — null, not a guess.
    expect(got[0]?.contact_fullname ?? null).toBeNull();
  });

  it('requires a .gov/.mil address — a vendor email in an attachment is not the CO', () => {
    const got = extractPackageNamedContacts('Questions to john.smith@acmecorp.com for this bid.');
    expect(got).toHaveLength(0);
  });

  it('empty/short text yields no contacts (absence is not an error)', () => {
    expect(extractPackageNamedContacts('')).toHaveLength(0);
  });

  it('dedupes a directory row that repeats a package-named person', () => {
    const pkg = extractPackageNamedContacts(PACKAGE);
    const directory = [
      { contact_email: 'Michael.Spivack@va.gov', contact_fullname: 'M Spivack' },
      { contact_email: 'someone.else@va.gov', contact_fullname: 'Someone Else' },
    ];
    const kept = dedupeAgainstPackage(directory, pkg);
    expect(kept).toHaveLength(1);
    expect(kept[0].contact_email).toBe('someone.else@va.gov');
  });

  it('keeps the directory as fallback when the package names nobody', () => {
    const directory = [{ contact_email: 'a@va.gov' }, { contact_email: 'b@va.gov' }];
    expect(dedupeAgainstPackage(directory, [])).toHaveLength(2);
  });
});
