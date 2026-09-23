/**
 * queryFederalContacts (MCP search_federal_contacts + chat) — the DoDAAC path emits the
 * indexable prefix predicate, and a query error (e.g. the 8s statement_timeout) comes back
 * DEGRADED with its trace — never as a clean empty roster.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = [string, ...unknown[]];
const calls: Call[] = [];
let response: { data: unknown; error: unknown; count: number | null } = { data: [], error: null, count: 0 };

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'not', 'eq', 'ilike', 'or', 'order', 'range', 'limit']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(response).then(res, rej);
  return b;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => builder() }));
vi.mock('@/lib/gov-contacts/dodaac-directory', () => ({
  loadDodaacNames: async () => new Map<string, string>(),
  dodaacCodesForAgency: async () => ['W912PL', 'W912BV', 'junk'],
}));
vi.mock('@/lib/utils/command-info', () => ({ osbpContactForAgency: () => null }));

import { queryFederalContacts } from './contact-roster';

beforeEach(() => {
  calls.length = 0;
  response = { data: [], error: null, count: 0 };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stub.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
});

describe('queryFederalContacts — DoDAAC prefix query', () => {
  it('dodaac path filters solicitation_number ILIKE <DODAAC>% (trigram-indexable)', async () => {
    await queryFederalContacts({ dodaac: 'w912pl' });
    expect(calls).toContainEqual(['ilike', 'solicitation_number', 'W912PL%']);
    // No office ILIKE (the office column is ~always NULL) on an anchored query.
    expect(calls.some((c) => c[0] === 'ilike' && c[1] === 'office')).toBe(false);
  });

  it('agency-dodaac path ORs one indexable prefix per VALID code', async () => {
    await queryFederalContacts({ agency: 'USACE' });
    const or = calls.find((c) => c[0] === 'or');
    expect(or?.[1]).toBe('solicitation_number.ilike.W912PL%,solicitation_number.ilike.W912BV%');
  });

  it('a statement timeout returns degraded with the error in the trace, not an empty grounded roster', async () => {
    response = { data: null, error: { message: 'canceling statement due to statement timeout' }, count: null };
    const r = await queryFederalContacts({ dodaac: 'W912PL' });
    expect(r.degraded).toBe(true);
    expect(r.contacts).toEqual([]);
    expect(r.trace.join(' ')).toContain('statement timeout');
  });
});
