/**
 * contact-quality — the render/query guard for federal_contacts ghost cards.
 * Measured against real prod rows (2026-07-26): "Telephone: 7175503122" is a
 * literal contact_fullname value on 3,912 rows (AllSamContacts +
 * sam_opportunities_pointOfContact) that otherwise have a real email/agency.
 */
import { describe, it, expect } from 'vitest';
import { isUsableContactName, isUsableContactCard } from './contact-quality';

describe('isUsableContactName', () => {
  it('rejects the real "Telephone: ###" placeholder (measured prod pattern)', () => {
    expect(isUsableContactName('Telephone: 7175503122')).toBe(false);
    expect(isUsableContactName('Telephone: 7176051319')).toBe(false);
  });

  it('rejects other label+digits placeholders', () => {
    expect(isUsableContactName('Fax: 555-1234')).toBe(false);
    expect(isUsableContactName('Phone: (703) 555-0100')).toBe(false);
    expect(isUsableContactName('Tel: 555.123.4567')).toBe(false);
  });

  it('rejects a bare digit string with no label', () => {
    expect(isUsableContactName('7175503122')).toBe(false);
    expect(isUsableContactName('(703) 555-0100')).toBe(false);
  });

  it('rejects null/empty/whitespace', () => {
    expect(isUsableContactName(null)).toBe(false);
    expect(isUsableContactName(undefined)).toBe(false);
    expect(isUsableContactName('')).toBe(false);
    expect(isUsableContactName('   ')).toBe(false);
  });

  it('accepts a real person name', () => {
    expect(isUsableContactName('Joshua Ginsburg')).toBe(true);
    expect(isUsableContactName('AHMED IBRAHIM')).toBe(true);
    expect(isUsableContactName('Medina, Noelli')).toBe(true);
  });

  it('does not false-positive on a name that merely contains digits', () => {
    // e.g. a rank/suffix — real names occasionally carry a numeral; the point
    // is the label+digits SHAPE ("Telephone:" prefix / all-digits string), not
    // "any digit anywhere".
    expect(isUsableContactName('John Smith III')).toBe(true);
  });
});

describe('isUsableContactCard', () => {
  it('rejects a row whose name is the phone-number placeholder even with email+agency present', () => {
    // This is the actual measured shape: real email + agency + sol#, garbage name.
    expect(
      isUsableContactCard({
        contact_fullname: 'Telephone: 7175503122',
        contact_email: 'JOSHUA.GINSBURG@DLA.MIL',
        department_ind_agency: 'DEPT OF DEFENSE',
      }),
    ).toBe(false);
  });

  it('rejects a name-only row with no org and no contactable field', () => {
    expect(
      isUsableContactCard({
        contact_fullname: 'Jane Doe',
      }),
    ).toBe(false);
  });

  it('accepts a name + org even with no email/phone (e.g. a sam_entities_pocs contractor POC)', () => {
    expect(
      isUsableContactCard({
        contact_fullname: 'AHMED IBRAHIM',
        contact_title: 'GM',
        sub_tier: 'MEDIA CITY',
      } as any),
    ).toBe(true);
  });

  it('accepts a name + a contactable field even with no org', () => {
    expect(
      isUsableContactCard({
        contact_fullname: 'Jane Doe',
        contact_email: 'jane@example.mil',
      }),
    ).toBe(true);
  });

  it('accepts a fully-populated real POC row', () => {
    expect(
      isUsableContactCard({
        contact_fullname: 'Jennifer Henry',
        contact_email: 'JENNIFER.HENRY@NAVY.MIL',
        department_ind_agency: 'DEPT OF DEFENSE',
        sub_tier: 'DEPT OF THE NAVY',
      }),
    ).toBe(true);
  });
});
