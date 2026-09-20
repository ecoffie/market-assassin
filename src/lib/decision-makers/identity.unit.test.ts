/**
 * Decision Makers identity layer.
 *
 * Fixtures are REAL production values measured 2026-09-20, so the tests pin the
 * actual failure modes rather than invented ones.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getIdentityByEmail,
  listAgencyIdentities,
  getRolesForIdentity,
  isPresentableAsPerson,
  type DecisionMakerIdentity,
} from './identity';

/** The busiest address in the corpus — 3,807 observations, and a REAL PERSON. */
const NATALYA = {
  identity_email: 'natalya.radyk@dla.mil',
  identity_kind: 'person',
  observation_count: 3807,
  agency_count: 1,
  solicitation_count: 3807,
  first_seen_posted: '2026-04-14',
  last_seen_posted: '2026-09-19',
  last_observed_at: '2026-09-20T14:00:00Z',
  latest_observed_name: 'Natalya RadykDSN312-850-4033',
  latest_observed_title: null,
};
const ROLE_BOX = { ...NATALYA, identity_email: 'mrr-procurement@uscg.mil', identity_kind: 'role_mailbox', observation_count: 313, latest_observed_name: 'MRR Procurement Mailbox' };
const AMBIGUOUS = { ...NATALYA, identity_email: 'stephen.1.weaver@dla.mil', identity_kind: 'unknown', observation_count: 1354 };

function dbReturning(rows: unknown[], single?: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: single ?? null, error: null }));
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
  return { from: vi.fn(() => q) } as never;
}

describe('volume is never evidence of a role mailbox', () => {
  it('the 3,807-observation address is a PERSON, not a role mailbox', async () => {
    const i = await getIdentityByEmail(dbReturning([], NATALYA), 'natalya.radyk@dla.mil');
    expect(i?.identityKind).toBe('person');
    expect(i?.observationCount).toBe(3807);
    expect(isPresentableAsPerson(i as DecisionMakerIdentity)).toBe(true);
  });

  it('a 313-observation shared box is NOT presentable as a person', async () => {
    const i = await getIdentityByEmail(dbReturning([], ROLE_BOX), 'mrr-procurement@uscg.mil');
    expect(i?.identityKind).toBe('role_mailbox');
    expect(isPresentableAsPerson(i as DecisionMakerIdentity)).toBe(false);
  });
});

describe('unknown stays unknown', () => {
  it('an ambiguous address is not promoted to person', async () => {
    const i = await getIdentityByEmail(dbReturning([], AMBIGUOUS), 'stephen.1.weaver@dla.mil');
    expect(i?.identityKind).toBe('unknown');
    expect(isPresentableAsPerson(i as DecisionMakerIdentity)).toBe(false);
  });

  it('an unrecognised kind string degrades to unknown, never to person', async () => {
    const weird = { ...NATALYA, identity_kind: 'something_new' };
    const i = await getIdentityByEmail(dbReturning([], weird), 'x@y.mil');
    expect(i?.identityKind).toBe('unknown');
  });
});

describe('name is display-only, never a key', () => {
  it('a name that is actually a phone number is carried but not used to identify', async () => {
    const phoneName = { ...NATALYA, identity_email: 'ethan.t.stein.civ@us.navy.mil', latest_observed_name: 'Telephone: 2156972983' };
    const i = await getIdentityByEmail(dbReturning([], phoneName), 'ethan.t.stein.civ@us.navy.mil');
    expect(i?.latestObservedName).toBe('Telephone: 2156972983');
    // identity is the EMAIL — the garbage name cannot split or merge anyone
    expect(i?.identityEmail).toBe('ethan.t.stein.civ@us.navy.mil');
  });
});

describe('not-held is not an absence claim', () => {
  it('an unheld address returns null, not an empty person', async () => {
    expect(await getIdentityByEmail(dbReturning([], null), 'nobody@nowhere.mil')).toBeNull();
  });
  it('an empty email is rejected without a query', async () => {
    expect(await getIdentityByEmail(dbReturning([], NATALYA), '   ')).toBeNull();
  });
});

describe('agency listing defaults to people only', () => {
  it('role mailboxes are excluded unless explicitly requested', async () => {
    const db = dbReturning([{ identity_email: 'natalya.radyk@dla.mil' }]);
    await listAgencyIdentities(db, 'DEPT OF DEFENSE');
    const q = (db as unknown as { from: () => Record<string, ReturnType<typeof vi.fn>> }).from();
    expect(q.in).toHaveBeenCalledWith('identity_kind', ['person']);
  });

  it('widening is deliberate and explicit', async () => {
    const db = dbReturning([{ identity_email: 'mrr-procurement@uscg.mil' }]);
    await listAgencyIdentities(db, 'USCG', { includeKinds: ['person', 'role_mailbox'] });
    const q = (db as unknown as { from: () => Record<string, ReturnType<typeof vi.fn>> }).from();
    expect(q.in).toHaveBeenCalledWith('identity_kind', ['person', 'role_mailbox']);
  });
});

describe('roles are separate from identity', () => {
  it('one identity can hold several roles without overwriting', async () => {
    const rows = [
      { identity_email: 'a.b@dla.mil', identity_kind: 'person', agency: 'DLA', sub_tier: 'DLA Land', office: 'Columbus', role_category: 'contracting', observation_count: 40, first_seen_posted: '2026-04-01', last_seen_posted: '2026-06-01' },
      { identity_email: 'a.b@dla.mil', identity_kind: 'person', agency: 'DLA', sub_tier: 'DLA Aviation', office: 'Richmond', role_category: 'contracting', observation_count: 12, first_seen_posted: '2026-07-01', last_seen_posted: '2026-09-01' },
    ];
    const roles = await getRolesForIdentity(dbReturning(rows), 'A.B@dla.mil');
    expect(roles).toHaveLength(2);
    expect(new Set(roles.map((r) => r.office))).toEqual(new Set(['Columbus', 'Richmond']));
    // the move is observable — neither role was collapsed away
    expect(roles.every((r) => r.identityEmail === 'a.b@dla.mil')).toBe(true);
  });
});
