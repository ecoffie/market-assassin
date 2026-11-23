/**
 * Contact rows name their contracting office and its code (Claude Local, 2026-11-22: VA contacts carried no
 * office). A civilian office code (VA NCO 8 = 36C248) is taken from the solicitation-number prefix ONLY when the
 * office directory knows it — a 6-char fragment of an arbitrary solicitation number is never an office.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let response: { data: unknown; error: unknown; count: number | null } = { data: [], error: null, count: 0 };
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'not', 'eq', 'ilike', 'or', 'order', 'range', 'limit', 'is', 'neq', 'in']) b[m] = () => b;
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(response).then(res, rej);
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => builder() }));
vi.mock('@/lib/gov-contacts/dodaac-directory', () => ({
  loadDodaacNames: async () => new Map<string, string>([['36C248', 'NETWORK CONTRACT OFFICE 8'], ['W912EQ', 'W07V ENDIST MEMPHIS']]),
  dodaacCodesForAgency: async () => [],
}));
vi.mock('@/lib/utils/command-info', () => ({ osbpContactForAgency: () => null }));

import { queryFederalContacts } from './contact-roster';

const row = (over: Record<string, unknown>) => ({
  id: String(Math.random()), contact_fullname: 'Pat Example', contact_title: 'Contracting Officer', contact_email: `${Math.random()}@va.gov`,
  contact_phone: null, department_ind_agency: 'VETERANS AFFAIRS, DEPARTMENT OF', office: null, sub_tier: null, role_category: 'contracting',
  solicitation_number: null, contact_kind: 'government_buyer', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stub.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
});

describe('office_code on contact rows', () => {
  it('a civilian office code in the directory is named; an unknown 6-char prefix is not an office', async () => {
    response = { data: [
      row({ solicitation_number: '36C24826R0012' }),
      row({ solicitation_number: 'RFQ12345-2026' }),   // office-shaped prefix "RFQ123", not in the directory
      row({ solicitation_number: 'W912EQ26R0001' }),   // DoD DoDAAC
    ], error: null, count: 3 };
    const r = await queryFederalContacts({ officeCodes: ['36C248', 'W912EQ'], limit: 10 });
    const byCode = r.contacts.map((c) => c.office_code);
    expect(byCode).toContain('36C248');
    expect(byCode).toContain('W912EQ');
    expect(byCode).not.toContain('RFQ123');
    const va = r.contacts.find((c) => c.office_code === '36C248')!;
    expect(va.derived_office).toMatch(/NETWORK CONTRACT OFFICE 8/i);
  });
});
