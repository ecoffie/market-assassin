/**
 * Ask Mindy → Contacts (RelationshipsPanel). A plain question becomes the tab's OWN filters (sub-list,
 * search box, NAICS box, Agency box) — never a guess; anything the tab can't filter by returns null so
 * the box hands off to chat; an unknown count is never shown as 0.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import {
  relationshipsAgencyText,
  relationshipsAskAdapter as A,
  relationshipsRequest,
  type RelationshipsAskParams,
} from './relationships';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));
const blank: RelationshipsAskParams = { view: null, search: '', naics: '', agency: '' };

describe('relationshipsAskAdapter.toQuery — the tab\'s own params', () => {
  it.each<[string, Partial<RelationshipsAskParams>]>([
    ['contracting officers at the Navy', { agency: 'navy', search: 'contracting officers' }],
    ['OSBP at DHS', { view: 'osbp', agency: 'homeland security' }],
    ['teaming partners 541512', { view: 'partners', naics: '541512' }],
    ['cybersecurity partners at VA', { view: 'partners', agency: 'veterans affairs', search: 'cybersecurity' }],
    ['Smith in my network', { view: 'network', search: 'smith' }],
    ['Navy contacts', { agency: 'navy' }],
    ['Defense Logistics Agency buyers', { view: 'buyers', agency: 'Defense Logistics Agency' }],
    ['janitorial 561720 buyers', { view: 'buyers', search: 'janitorial', naics: '561720' }],
    ['Army FY2027', { agency: 'army' }],
    ['OSBP directory', { view: 'osbp' }],
  ])('%s', (q, want) => {
    expect(query(q)).toEqual({ ...blank, ...want });
  });

  it('every example is a question the tab can always express', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const ex of A.examples) expect(query(ex), ex).not.toBeNull();
  });

  it.each([
    ['contracting officers in Virginia', /location/],
    ['8(a) buyers at the Army', /set-aside/],
    ['Navy and Army buyers', /one agency at a time/],
    ['program manager, contracting officer', /one name, title or company at a time/],
    ['state department buyers', /can’t be matched reliably/],
    ['Marine Corps buyers', /can’t be matched reliably/],
    ['OSBP partners at the Navy', /one list at a time/],
    ['541512 in my network', /can’t be filtered by NAICS/],
    ['how do I reach a contracting officer', /question for Mindy/],
    ['FY2027', /fiscal year alone/],
    ['', /Type a buyer/],
  ])('hands off to chat instead of guessing: %s', (q, why) => {
    expect(query(q)).toBeNull();
    expect(A.whyNot(ask(q))).toMatch(why);
  });
});

describe('agency text: words the stored department / OSBP names carry, never a bare acronym', () => {
  it('maps discovery codes to substrings that appear in SAM department/sub-tier labels', () => {
    // Real label shapes: "DEPT OF THE NAVY", "HOMELAND SECURITY, DEPARTMENT OF", "VETERANS AFFAIRS, DEPARTMENT OF".
    const labels: Array<[string, string]> = [
      ['NAVY', 'DEPT OF THE NAVY'], ['ARMY', 'DEPT OF THE ARMY'], ['AIR FORCE', 'DEPT OF THE AIR FORCE'],
      ['DOD', 'DEPT OF DEFENSE'], ['DHS', 'HOMELAND SECURITY, DEPARTMENT OF'],
      ['VA', 'VETERANS AFFAIRS, DEPARTMENT OF'], ['HHS', 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF'],
      ['DOT', 'TRANSPORTATION, DEPARTMENT OF'], ['NASA', 'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION'],
      ['GSA', 'GENERAL SERVICES ADMINISTRATION'],
    ];
    for (const [code, label] of labels) {
      const text = relationshipsAgencyText(code)!;
      expect(label.toLowerCase(), code).toContain(text.toLowerCase());
    }
    // …and the OSBP directory's own agency names.
    expect('Department of Homeland Security'.toLowerCase()).toContain(relationshipsAgencyText('DHS')!);
    expect('Department of Veterans Affairs'.toLowerCase()).toContain(relationshipsAgencyText('VA')!);
  });

  it('never sends an ambiguous or unstored buyer', () => {
    for (const code of ['DOS', 'DOI', 'USMC', 'USACE', 'XYZ']) expect(relationshipsAgencyText(code), code).toBeNull();
    expect(relationshipsAgencyText('Defense Logistics Agency')).toBe('Defense Logistics Agency');
  });
});

describe('relationshipsRequest — params against the sub-list the user is on', () => {
  it('keeps the current list unless the question named one', () => {
    expect(relationshipsRequest({ ...blank, agency: 'navy' }, 'osbp')).toEqual({ view: 'osbp', search: '', naics: '', agency: 'navy' });
    expect(relationshipsRequest({ ...blank, view: 'partners', naics: '541512' }, 'buyers'))
      .toEqual({ view: 'partners', search: '', naics: '541512', agency: '' });
  });

  it('My Saved Contacts has one search box: an agency alone becomes the search', () => {
    expect(relationshipsRequest({ ...blank, agency: 'navy' }, 'network')).toEqual({ view: 'network', search: 'navy', naics: '', agency: '' });
    expect(relationshipsRequest({ ...blank, search: 'smith' }, 'network')).toEqual({ view: 'network', search: 'smith', naics: '', agency: '' });
  });

  it('an un-named question My Saved Contacts cannot run moves to Gov Buyers, nothing dropped', () => {
    expect(relationshipsRequest({ ...blank, naics: '541512' }, 'network')).toEqual({ view: 'buyers', search: '', naics: '541512', agency: '' });
    expect(relationshipsRequest({ ...blank, agency: 'navy', search: 'contracting officers' }, 'network'))
      .toEqual({ view: 'buyers', search: 'contracting officers', naics: '', agency: 'navy' });
  });
});

describe('relationshipsAskAdapter.summary', () => {
  it('names what Mindy searched, the count, and that the search box matches text', () => {
    expect(A.summary(ask('contracting officers at the Navy'), { shown: 37, more: false }))
      .toBe('Mindy searched: Navy · contracting officers — 37 contacts (name, title, company or agency contains “contracting officers”)');
    expect(A.summary(ask('OSBP at DHS'), { shown: 1, more: false })).toBe('Mindy searched: OSBP Directory · DHS — 1 contact');
    expect(A.summary(ask('teaming partners 541512'), { shown: 100, more: true }))
      .toBe('Mindy searched: Find Partners · NAICS 541512 — 100+ contacts (showing the first 100)');
  });

  it('an unknown count is unavailable, never 0', () => {
    const s = A.summary(ask('OSBP at DHS'), null);
    expect(s).toContain('count unavailable');
    expect(s).not.toMatch(/\b0 contacts/);
  });

  it('says a fiscal year was not applied', () => {
    expect(A.summary(ask('Army FY2027'), { shown: 5, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
