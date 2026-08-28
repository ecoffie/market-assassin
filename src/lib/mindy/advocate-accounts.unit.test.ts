/**
 * The advocate registry gates complimentary Pro access and campaign exclusion.
 *
 * WHY THIS TEST EXISTS: four power users were running live demos of Mindy on our behalf
 * and none of them were in this list. Nothing in the system marked them as advocates, so
 * they read as ordinary paying users — every comp looked like revenue given away, and they
 * were eligible for upgrade campaigns aimed at people who already have complimentary access.
 *
 * The identity cases are the fragile part: two advocates work from an account that is NOT
 * the address they signed up with. Credits granted to the signup email sat unspent while
 * the demo account ran dry. These tests pin the WORKING accounts.
 */
import { describe, it, expect } from 'vitest';
import { ADVOCATE_ACCOUNTS, isAdvocateAccount, getAdvocateName } from './advocate-accounts';

describe('advocate registry', () => {
  it('recognizes every registered advocate', () => {
    for (const a of ADVOCATE_ACCOUNTS) {
      expect(isAdvocateAccount(a.email), `${a.email} must be recognized`).toBe(true);
    }
  });

  it('includes the demo advocates added 2026-08-28', () => {
    for (const email of [
      'westover105@gmail.com',
      'olga@olaexecutiveconsulting.com',
      'louis.reed@reedasolutions.com',
      'johnpalmer101@gmail.com',
      'jaisonsolutions@gmail.com',
    ]) {
      expect(isAdvocateAccount(email), `${email} runs live demos — must be an advocate`).toBe(true);
    }
  });

  it('registers the WORKING account, not the signup address', () => {
    // John connects as johnpalmer101@; Tabitha as jaisonsolutions@. Their app-signup
    // addresses hold auth but are not where the demos happen, so comp access keyed to
    // those would miss the account that actually runs dry.
    expect(isAdvocateAccount('johnpalmer101@gmail.com')).toBe(true);
    expect(isAdvocateAccount('jaisonsolutions@gmail.com')).toBe(true);
  });

  it('carries a name for every entry so support can identify them', () => {
    for (const a of ADVOCATE_ACCOUNTS) {
      expect(getAdvocateName(a.email), `${a.email} needs a name`).toBeTruthy();
    }
  });

  it('normalizes case and whitespace — an advocate is not missed on formatting', () => {
    expect(isAdvocateAccount('  Westover105@Gmail.COM  ')).toBe(true);
    expect(isAdvocateAccount('OLGA@OLAEXECUTIVECONSULTING.COM')).toBe(true);
  });

  it('does not sweep in ordinary users', () => {
    expect(isAdvocateAccount('someone@example.com')).toBe(false);
    expect(isAdvocateAccount('')).toBe(false);
    expect(isAdvocateAccount(null)).toBe(false);
    expect(isAdvocateAccount(undefined)).toBe(false);
  });

  it('has no duplicate entries', () => {
    const emails = ADVOCATE_ACCOUNTS.map((a) => a.email.toLowerCase().trim());
    expect(new Set(emails).size).toBe(emails.length);
  });
});
