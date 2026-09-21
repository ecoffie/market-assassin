/**
 * Agency identity for OSBP promotion.
 *
 * Production failure: search_federal_contacts("United States Coast Guard")
 * prepended Gail Clark because "UNITED STATES COAST GUARD".includes("STATE").
 *
 * USCG director Maria L. Kersey-Robinson is directory-backed with
 * directorVerified "2026-06". That is provenance for this identity fix, not a
 * claim of fresh contact verification.
 */
import { describe, it, expect } from 'vitest';
import commandInfoData from '@/data/dod-command-info.json';
import {
  emailDomainFlagsDifferentCommand,
  identityEstablishedEqual,
  identityKey,
  legacySubstringContains,
  osbpContradictsRequestedAgency,
  queryIdentifiesCandidate,
  resolveDirectoryIdentity,
  resolveIdentitySpendingGrain,
} from './agency-identity';
import {
  getAgencyInfoByParentAgency,
  getCommandInfo,
  getCommandsByParentAgency,
  getEnhancedAgencyInfo,
  GENERIC_OSBP_FALLBACK_LABEL,
  osbpContactForAgency,
  type CommandInfo,
} from '@/lib/utils/command-info';
import { lookupFederalOsbp } from '@/mcp/tools/federal-osbp';

const COMMANDS = commandInfoData.commands as Record<string, CommandInfo>;

const SHORT_TOKENS = [
  'STATE', 'ARMY', 'NAVY', 'AIR', 'ENERGY', 'INTERIOR', 'LABOR',
  'COMMERCE', 'TRANSPORTATION', 'JUSTICE', 'TREASURY',
] as const;

const ABBREV_KEYWORDS: Array<{ abbr: string; keyword: string }> = [
  { abbr: 'DOJ', keyword: 'JUSTICE' },
  { abbr: 'DOE', keyword: 'ENERGY' },
  { abbr: 'Treasury', keyword: 'TREASURY' },
  { abbr: 'DOI', keyword: 'INTERIOR' },
  { abbr: 'State', keyword: 'STATE' },
  { abbr: 'Commerce', keyword: 'COMMERCE' },
  { abbr: 'DOL', keyword: 'LABOR' },
  { abbr: 'DOT', keyword: 'TRANSPORTATION' },
];

type ExpectedAfter =
  | { kind: 'command'; abbreviation: string }
  | { kind: 'parent_roster'; parent: string }
  | { kind: 'abstain' };

/** Independently expected identities — directory rows, not search/lookup agreement. */
const INDEPENDENT_IDENTITIES: Array<{ query: string; expected: ExpectedAfter }> = [
  { query: 'United States Coast Guard', expected: { kind: 'command', abbreviation: 'USCG' } },
  { query: 'UNITED STATES COAST GUARD', expected: { kind: 'command', abbreviation: 'USCG' } },
  { query: 'U.S. Coast Guard', expected: { kind: 'command', abbreviation: 'USCG' } },
  { query: 'Department of State', expected: { kind: 'command', abbreviation: 'State' } },
  { query: 'STATE', expected: { kind: 'command', abbreviation: 'State' } },
  { query: 'Department of Energy', expected: { kind: 'command', abbreviation: 'DOE' } },
  { query: 'Department of Transportation', expected: { kind: 'command', abbreviation: 'DOT' } },
  { query: 'Department of Homeland Security', expected: { kind: 'command', abbreviation: 'DHS' } },
  { query: 'DHS', expected: { kind: 'command', abbreviation: 'DHS' } },
  { query: 'Navy', expected: { kind: 'parent_roster', parent: 'Department of the Navy' } },
  { query: 'Bureau of Ocean Energy Management', expected: { kind: 'command', abbreviation: 'BOEM' } },
  { query: 'Transportation Security Administration', expected: { kind: 'command', abbreviation: 'TSA' } },
];

function observedAfter(query: string): ExpectedAfter {
  const resolved = resolveDirectoryIdentity(query, COMMANDS);
  if (resolved.kind === 'command') return { kind: 'command', abbreviation: resolved.info.abbreviation };
  if (resolved.kind === 'parent_roster') return { kind: 'parent_roster', parent: resolved.parentLabel };
  return { kind: 'abstain' };
}

/** Expected identity from the directory row itself — not from resolveDirectoryIdentity. */
function independentExpected(query: string): ExpectedAfter {
  const values = Object.values(COMMANDS);
  const byName = values.filter((c) => identityEstablishedEqual(query, c.fullName));
  if (byName.length === 1) return { kind: 'command', abbreviation: byName[0].abbreviation };
  const byAbbr = values.filter((c) => identityEstablishedEqual(query, c.abbreviation));
  if (byAbbr.length === 1) return { kind: 'command', abbreviation: byAbbr[0].abbreviation };
  const kids = values.filter((c) =>
    identityEstablishedEqual(query, c.parentAgency) || queryIdentifiesCandidate(query, c.parentAgency),
  );
  if (kids.length > 0) return { kind: 'parent_roster', parent: kids[0].parentAgency };
  return { kind: 'abstain' };
}

function legacyCollidingAbbrs(query: string): string[] {
  const hits: string[] = [];
  for (const { abbr, keyword } of ABBREV_KEYWORDS) {
    if (!legacySubstringContains(query, keyword)) continue;
    if (identityEstablishedEqual(query, keyword) || queryIdentifiesCandidate(query, keyword)) continue;
    hits.push(abbr);
  }
  return hits;
}

/**
 * Tested query set: each directory fullName, "United States "+fullName, and
 * each parentAgency. Counts describe THIS set, not the production population.
 */
function auditRows(): Array<{
  query: string;
  expected: ExpectedAfter;
  before: string[];
}> {
  const rows: Array<{ query: string; expected: ExpectedAfter; before: string[] }> = [];
  const seen = new Set<string>();
  const add = (query: string, expected: ExpectedAfter) => {
    if (seen.has(query)) return;
    seen.add(query);
    rows.push({ query, expected, before: legacyCollidingAbbrs(query) });
  };

  for (const info of Object.values(COMMANDS)) {
    add(info.fullName, { kind: 'command', abbreviation: info.abbreviation });
    add(`United States ${info.fullName}`, { kind: 'command', abbreviation: info.abbreviation });
    add(info.parentAgency, independentExpected(info.parentAgency));
  }
  add('United States Coast Guard', { kind: 'command', abbreviation: 'USCG' });
  add('UNITED STATES COAST GUARD', { kind: 'command', abbreviation: 'USCG' });
  return rows;
}

describe('agency identity — Coast Guard gold fixture', () => {
  it('UNITED STATES COAST GUARD identity key is COAST GUARD, not STATE', () => {
    expect(identityKey('United States Coast Guard')).toBe('COAST GUARD');
    expect(identityEstablishedEqual('United States Coast Guard', 'U.S. Coast Guard')).toBe(true);
    expect(identityEstablishedEqual('United States Coast Guard', 'STATE')).toBe(false);
    expect(queryIdentifiesCandidate('STATE', 'United States Coast Guard')).toBe(false);
    expect(legacySubstringContains('UNITED STATES COAST GUARD', 'STATE')).toBe(true);
  });

  it('resolves United States Coast Guard to USCG, not State', () => {
    expect(getCommandInfo('United States Coast Guard')?.abbreviation).toBe('USCG');
    expect(getCommandInfo('U.S. Coast Guard')?.abbreviation).toBe('USCG');
    expect(getCommandInfo('Coast Guard')?.abbreviation).toBe('USCG');
    expect(getCommandInfo('USCG')?.abbreviation).toBe('USCG');
    expect(getAgencyInfoByParentAgency('United States Coast Guard')?.abbreviation).toBe('USCG');
  });

  it('does not promote Gail Clark / State OSDBU as Coast Guard OSBP', () => {
    const prepend = osbpContactForAgency('United States Coast Guard');
    expect(prepend.reason).toBe('established');
    expect(prepend.command?.abbreviation).toBe('USCG');
    expect(prepend.contact?.email?.toLowerCase()).toBe('uscg-smallbusiness@uscg.mil');
    expect(prepend.contact?.director).toMatch(/Kersey-Robinson/i);
    expect(prepend.contact?.director).not.toMatch(/Gail Clark/i);
    expect(prepend.contact?.email?.toLowerCase()).not.toBe('sdbupolicy@state.gov');
    expect(prepend.contact?.name).not.toMatch(/State Department/i);
    // Directory provenance, not a live re-verification of the person.
    expect(COMMANDS.USCG.smallBusinessOffice.directorVerified).toBe('2026-06');

    const enhanced = getEnhancedAgencyInfo(
      'United States Coast Guard',
      'United States Coast Guard',
      'United States Coast Guard',
    );
    expect(enhanced.command).toBe('USCG');
    expect(enhanced.smallBusinessContact?.email?.toLowerCase()).toBe('uscg-smallbusiness@uscg.mil');
  });

  it('lookup independently expects USCG, not merely agreement with search', () => {
    const lookup = lookupFederalOsbp({ agency: 'United States Coast Guard' });
    expect(lookup.office?.abbreviation).toBe('USCG');
    expect(lookup.office?.email?.toLowerCase()).toBe('uscg-smallbusiness@uscg.mil');
    expect(lookup.office?.osbp_director).toMatch(/Kersey-Robinson/i);
    expect(lookup._meta.match).toBe('command');
    expect(lookup._meta.grounded).toBe(true);
    expect(lookup._meta.email_domain_flag).toBe(false);
  });
});

describe('agency identity — independent expected identities (not search/lookup agreement)', () => {
  it('frozen expected identities resolve without using search/lookup agreement', () => {
    for (const row of INDEPENDENT_IDENTITIES) {
      expect(observedAfter(row.query), row.query).toEqual(row.expected);
    }
  });

  it('State / DOE / DOT resolve to those directory rows', () => {
    expect(getCommandInfo('Department of State')?.abbreviation).toBe('State');
    expect(getCommandInfo('State Department')?.abbreviation).toBe('State');
    expect(getCommandInfo('STATE')?.abbreviation).toBe('State');
    expect(osbpContactForAgency('Department of State').contact?.email?.toLowerCase()).toBe('sdbupolicy@state.gov');
    expect(getCommandInfo('Department of Energy')?.abbreviation).toBe('DOE');
    expect(getAgencyInfoByParentAgency('Department of Energy')?.abbreviation).toBe('DOE');
    expect(getCommandInfo('Department of Transportation')?.abbreviation).toBe('DOT');
    expect(getAgencyInfoByParentAgency('Department of Transportation')?.abbreviation).toBe('DOT');
  });

  it('Department of Homeland Security resolves to DHS, not an arbitrary child', () => {
    const dhsFamily = Object.values(COMMANDS).filter((c) => c.parentAgency === 'Department of Homeland Security');
    expect(dhsFamily.length).toBeGreaterThan(3);
    expect(dhsFamily.some((c) => c.abbreviation === 'CBP')).toBe(true);
    expect(dhsFamily.some((c) => c.abbreviation === 'USCG')).toBe(true);
    expect(getCommandInfo('Department of Homeland Security')?.abbreviation).toBe('DHS');
    expect(getAgencyInfoByParentAgency('Department of Homeland Security')?.abbreviation).toBe('DHS');
    expect(getCommandInfo('DHS')?.abbreviation).toBe('DHS');
    expect(osbpContactForAgency('Department of Homeland Security').command?.abbreviation).toBe('DHS');
    const lookup = lookupFederalOsbp({ agency: 'Department of Homeland Security' });
    expect(lookup.office?.abbreviation).toBe('DHS');
    expect(lookup.related_offices.length).toBeGreaterThan(1);
    expect(lookup.related_offices.some((o) => o.abbreviation === 'USCG')).toBe(true);
  });

  it('Navy is a parent roster — not whichever child appears first', () => {
    const navy = getCommandsByParentAgency('Navy');
    expect(navy.length).toBeGreaterThan(1);
    expect(navy.every((c) => /Navy/i.test(c.parentAgency))).toBe(true);
    expect(getCommandInfo('Navy')).toBeNull();
    expect(getAgencyInfoByParentAgency('Navy')).toBeNull();
    expect(osbpContactForAgency('Navy').reason).toBe('not_established');
    const resolved = resolveDirectoryIdentity('Navy', COMMANDS);
    expect(resolved.kind).toBe('parent_roster');
    if (resolved.kind === 'parent_roster') {
      expect(resolved.children.length).toBe(navy.length);
    }
    const lookup = lookupFederalOsbp({ agency: 'Navy' });
    expect(lookup._meta.match).toBe('parent_agency');
    expect(lookup.office).toBeNull();
    expect(lookup.related_offices.length).toBeGreaterThan(1);
  });

  it('a parent query never first-wins a child that merely shares the parent', () => {
    const parents = [...new Set(Object.values(COMMANDS).map((c) => c.parentAgency))];
    for (const parent of parents) {
      const got = getAgencyInfoByParentAgency(parent);
      if (!got) continue;
      const isSelf =
        identityEstablishedEqual(got.fullName, parent)
        || identityEstablishedEqual(got.abbreviation, parent);
      expect(isSelf, `${parent} → ${got.abbreviation}`).toBe(true);
    }
  });
});

describe('agency identity — contradiction guard', () => {
  it('excludes Gail because the directory row is State OSDBU, not because of the email domain', () => {
    expect(osbpContradictsRequestedAgency({
      requestedAgency: 'United States Coast Guard',
      selectedCommand: COMMANDS.State,
      osbpName: COMMANDS.State.smallBusinessOffice.name,
      osbpParentAgency: COMMANDS.State.parentAgency,
    }, COMMANDS)).toBe(true);
  });

  it('does not flag the real USCG directory row as a contradiction', () => {
    expect(osbpContradictsRequestedAgency({
      requestedAgency: 'United States Coast Guard',
      selectedCommand: COMMANDS.USCG,
      osbpName: COMMANDS.USCG.smallBusinessOffice.name,
      osbpEmail: COMMANDS.USCG.smallBusinessOffice.email,
      osbpParentAgency: COMMANDS.USCG.parentAgency,
    }, COMMANDS)).toBe(false);
  });

  it('a cross-domain email does not override established Navy identity', () => {
    // Navy / state.gov: the mailbox would look like State. Identity is NAVFAC.
    expect(osbpContradictsRequestedAgency({
      requestedAgency: 'NAVFAC',
      selectedCommand: COMMANDS.NAVFAC,
      osbpName: COMMANDS.NAVFAC.smallBusinessOffice.name,
      osbpEmail: 'sdbupolicy@state.gov',
      osbpParentAgency: COMMANDS.NAVFAC.parentAgency,
    }, COMMANDS)).toBe(false);
    expect(osbpContactForAgency('NAVFAC').reason).toBe('established');
    expect(osbpContactForAgency('NAVFAC').emailDomainFlag).toBe(false);
  });

  it('a uniquely mapped foreign mailbox FLAGs without excluding the established command', () => {
    expect(emailDomainFlagsDifferentCommand(
      'uscg-smallbusiness@uscg.mil',
      COMMANDS.NAVFAC,
      COMMANDS,
    )).toBe(true);
    expect(osbpContradictsRequestedAgency({
      requestedAgency: 'NAVFAC',
      selectedCommand: COMMANDS.NAVFAC,
      osbpName: COMMANDS.NAVFAC.smallBusinessOffice.name,
      osbpEmail: 'uscg-smallbusiness@uscg.mil',
      osbpParentAgency: COMMANDS.NAVFAC.parentAgency,
    }, COMMANDS)).toBe(false);
  });
});

describe('agency identity — measured substring collisions (tested query set, not production population)', () => {
  const rows = auditRows();
  const collisions = rows.filter((r) => r.before.length > 0);

  it('the production STATE ⊂ UNITED STATES COAST GUARD collision is in the tested set', () => {
    expect(collisions.some((c) =>
      /coast guard/i.test(c.query) && c.before.includes('State'),
    )).toBe(true);
  });

  it('tested-set collision counts are a query-set size, not a production population', () => {
    const stateStolen = collisions.filter((c) => c.before.includes('State'));
    const doeStolen = collisions.filter((c) => c.before.includes('DOE'));
    const dotStolen = collisions.filter((c) => c.before.includes('DOT'));
    expect(rows.length).toBeGreaterThan(300);
    expect(stateStolen.length).toBeGreaterThan(100);
    expect(doeStolen.map((c) => c.query).sort()).toEqual([
      'Bureau of Ocean Energy Management',
      'United States Bureau of Ocean Energy Management',
    ]);
    expect(dotStolen.map((c) => c.query).sort()).toEqual([
      'Transportation Security Administration',
      'United States Transportation Security Administration',
    ]);
  });

  it('each collision is a before/after: legacy includes-target vs independently expected identity or abstain', () => {
    expect(collisions.length).toBeGreaterThan(0);
    for (const row of collisions) {
      const after = observedAfter(row.query);
      expect(after, `AFTER ${row.query}`).toEqual(row.expected);
      if (after.kind === 'command') {
        expect(row.before, `BEFORE ${row.query} after=${after.abbreviation}`).not.toContain(after.abbreviation);
      }
    }
  });

  it('every tested query (collision or not) matches its expected after-state', () => {
    for (const row of rows) {
      expect(observedAfter(row.query), row.query).toEqual(row.expected);
    }
  });

  it('valid State, DOE, DOT, Navy, and DHS queries are preserved in the after-state', () => {
    for (const row of INDEPENDENT_IDENTITIES) {
      expect(observedAfter(row.query), row.query).toEqual(row.expected);
    }
  });

  it('short tokens do not identify United States Coast Guard', () => {
    for (const token of SHORT_TOKENS) {
      expect(queryIdentifiesCandidate(token, 'United States Coast Guard')).toBe(false);
    }
  });
});

describe('getEnhancedAgencyInfo reports fallback', () => {
  it('unknown agency does not assert a command identity or verified contact', () => {
    const r = getEnhancedAgencyInfo(
      'Department of Nonexistent Things',
      '',
      'Department of Nonexistent Things',
    );
    expect(r.command).toBeNull();
    expect(r.commandInfo).toBeNull();
    expect(r.osbpSource).toBe('generic_fallback');
    expect(r.smallBusinessContact?.genericFallback).toBe(true);
    expect(r.smallBusinessContact?.directorVerified).toBeUndefined();
    expect(r.smallBusinessContact?.name).toMatch(new RegExp(GENERIC_OSBP_FALLBACK_LABEL, 'i'));
    expect(r.smallBusinessContact?.director).toMatch(new RegExp(GENERIC_OSBP_FALLBACK_LABEL, 'i'));
    expect(r.smallBusinessContact?.director).toMatch(/not a verified contact/i);
  });

  it('ambiguous Navy parent does not first-wins a child command', () => {
    const r = getEnhancedAgencyInfo('Some Unknown Navy Office', 'Navy', 'Navy');
    expect(r.command).toBeNull();
    expect(r.commandInfo).toBeNull();
    expect(r.smallBusinessContact?.directorVerified).toBeUndefined();
  });

  it('established Coast Guard remains a directory identity, not generic', () => {
    const r = getEnhancedAgencyInfo(
      'United States Coast Guard',
      'United States Coast Guard',
      'United States Coast Guard',
    );
    expect(r.command).toBe('USCG');
    expect(r.osbpSource).toBe('directory');
    expect(r.smallBusinessContact?.genericFallback).not.toBe(true);
    expect(r.smallBusinessContact?.directorVerified).toBe('2026-06');
  });
});

describe('agency identity — spending grain (NAVSEA lock)', () => {
  it('NAVSEA and Naval Sea Systems Command share the locked parent-service grain', () => {
    for (const q of ['NAVSEA', 'Naval Sea Systems Command', 'navsea']) {
      const g = resolveIdentitySpendingGrain(q);
      expect(g.established, q).toBe(true);
      expect(g.identity, q).toEqual({
        command: 'NAVSEA',
        service: 'Department of the Navy',
        parent: 'Department of Defense',
      });
      expect(g.spendingScope, q).toBe('PARENT_SERVICE');
      expect(g.spendingScopeName, q).toBe('Department of the Navy');
      expect(g.commandSpending, q).toBe('NOT_ESTABLISHED');
      expect(g.serviceFetch, q).toEqual({ subAgency: 'Department of the Navy' });
      expect(g.displayName, q).toBe('Naval Sea Systems Command');
    }
  });

  it('Navy dollars are REQUESTED service spend, not a first-won SYSCOM', () => {
    for (const q of ['Navy', 'Department of the Navy']) {
      const g = resolveIdentitySpendingGrain(q);
      expect(g.established, q).toBe(true);
      expect(g.identity.command, q).toBeNull();
      expect(g.identity.service, q).toBe('Department of the Navy');
      expect(g.identity.parent, q).toBe('Department of Defense');
      expect(g.spendingScope, q).toBe('REQUESTED');
      expect(g.commandSpending, q).toBe('NOT_APPLICABLE');
      expect(g.serviceFetch, q).toEqual({ subAgency: 'Department of the Navy' });
    }
  });

  it('United States Coast Guard is USCG, not State, and does not borrow DHS dollars', () => {
    const g = resolveIdentitySpendingGrain('United States Coast Guard');
    expect(g.identity.command).toBe('USCG');
    expect(g.identity.parent).toBe('Department of Homeland Security');
    expect(g.spendingScope).toBe('NOT_ESTABLISHED');
    expect(g.commandSpending).toBe('NOT_ESTABLISHED');
    expect(g.serviceFetch).toBeNull();
    expect(g.identity.command).not.toBe('State');
  });

  it('STATE still resolves to Department of State as REQUESTED toptier spend', () => {
    const g = resolveIdentitySpendingGrain('STATE');
    expect(g.identity.command).toBe('State');
    expect(g.spendingScope).toBe('REQUESTED');
    expect(g.toptierName).toBe('Department of State');
    expect(g.commandSpending).toBe('NOT_APPLICABLE');
  });

  it('NAVAIR and NAVSUP follow the same SYSCOM grain as NAVSEA — no special case', () => {
    for (const q of ['NAVAIR', 'NAVSUP']) {
      const g = resolveIdentitySpendingGrain(q);
      expect(g.spendingScope, q).toBe('PARENT_SERVICE');
      expect(g.identity.service, q).toBe('Department of the Navy');
      expect(g.commandSpending, q).toBe('NOT_ESTABLISHED');
    }
  });
});
