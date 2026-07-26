/**
 * Guards getBuyerDetail — the Gov Buyer drawer's one-call feed.
 *
 * Asserts the drawer's data contract: real buyer identity, the opportunities they run (the
 * headline section), agency intel, the office roster, contact info — all grounded (never
 * fabricated), and the phone-as-name guard (#462) honored (a "Telephone: …" placeholder id
 * returns null rather than a card whose name is a phone number).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Supabase client with a tiny per-table fixture query builder. ──
type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = { federal_contacts: [], sam_opportunities: [] };

function makeBuilder(table: string) {
  let rows = [...(TABLES[table] || [])];
  const b: Record<string, (...a: unknown[]) => unknown> = {};
  b.select = () => b;
  b.eq = (col: string, val: unknown) => { rows = rows.filter((r) => String(r[col as string]) === String(val)); return b; };
  b.neq = (col: string, val: unknown) => { rows = rows.filter((r) => String(r[col as string]) !== String(val)); return b; };
  b.in = (col: string, vals: unknown[]) => { const s = new Set((vals as unknown[]).map(String)); rows = rows.filter((r) => s.has(String(r[col as string]))); return b; };
  b.not = (col: string, op: string, val: unknown) => {
    if (op === 'is' && val === null) rows = rows.filter((r) => r[col as string] != null);
    else if (op === 'ilike') { const pre = String(val).replace(/%/g, '').toLowerCase(); rows = rows.filter((r) => !String(r[col as string] ?? '').toLowerCase().startsWith(pre)); }
    return b;
  };
  b.order = () => b;
  b.limit = () => b;
  // Terminal: awaiting the builder resolves to {data,error}.
  (b as unknown as { then: (res: (v: unknown) => void) => void }).then = (res) => res({ data: rows, error: null });
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => makeBuilder(t) }),
}));
vi.mock('@/lib/agency-intelligence', () => ({
  getUnifiedAgencyIntelligence: vi.fn(async (agency: string) =>
    agency === 'GENERAL SERVICES ADMINISTRATION'
      ? { agencyName: agency, priorities: ['Cloud modernization'], painPoints: ['Legacy systems'], gaoReports: [], spendingPatterns: [], sources: ['static'] }
      : null),
}));

// Import AFTER mocks are registered.
const { getBuyerDetail } = await import('./buyer-detail');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'y';
  TABLES.federal_contacts = [
    { id: 10, contact_fullname: 'Jane Buyer', contact_title: 'Contracting Officer', contact_email: 'jane@gsa.gov', contact_phone: '202-555-0100', department_ind_agency: 'GENERAL SERVICES ADMINISTRATION', office: 'FAS', sub_tier: 'Federal Acquisition Service', role_category: 'Contracting Officer', solicitation_number: 'GSA-001' },
    { id: 11, contact_fullname: 'Jane Buyer', contact_title: 'Contracting Officer', contact_email: 'jane@gsa.gov', contact_phone: '', department_ind_agency: 'GENERAL SERVICES ADMINISTRATION', office: 'FAS', sub_tier: 'Federal Acquisition Service', role_category: 'Contracting Officer', solicitation_number: 'GSA-002' },
    // A colleague at the same agency → the roster.
    { id: 12, contact_fullname: 'Sam Colleague', contact_title: 'Contract Specialist', contact_email: 'sam@gsa.gov', contact_phone: '', department_ind_agency: 'GENERAL SERVICES ADMINISTRATION', office: 'FAS', sub_tier: 'FAS', solicitation_number: 'GSA-003' },
    // A phone-as-name placeholder row (#462) — must NOT be returned as a buyer.
    { id: 99, contact_fullname: 'Telephone: 7175503112', contact_title: '', contact_email: 'x@y.gov', contact_phone: '', department_ind_agency: 'DEPT OF X', office: '', sub_tier: '', solicitation_number: 'X-1' },
  ];
  TABLES.sam_opportunities = [
    { notice_id: 'N1', solicitation_number: 'GSA-001', title: 'Cloud services', notice_type: 'Solicitation', naics_code: '541519', set_aside_code: null, set_aside_description: null, response_deadline: '2099-01-01', posted_date: '2026-07-01', ui_link: 'http://sam/N1', active: true, pop_city: 'Washington', pop_state: 'DC', office_address: { city: 'Washington', state: 'DC' } },
    { notice_id: 'N2', solicitation_number: 'GSA-002', title: 'Old contract', notice_type: 'Presolicitation', naics_code: '541512', set_aside_code: 'SBA', set_aside_description: 'Small Business', response_deadline: '2020-01-01', posted_date: '2026-06-01', ui_link: 'http://sam/N2', active: false, pop_city: null, pop_state: 'VA', office_address: null },
  ];
});

describe('getBuyerDetail', () => {
  it('returns the buyer header (name/role/agency/office) + contact info', async () => {
    const b = await getBuyerDetail('10');
    expect(b).toBeTruthy();
    expect(b!.name).toBe('Jane Buyer');
    expect(b!.role).toBe('Contracting Officer');
    expect(b!.agency).toBe('GENERAL SERVICES ADMINISTRATION');
    expect(b!.office).toBe('Federal Acquisition Service');
    expect(b!.email).toBe('jane@gsa.gov');
    expect(b!.phone).toBe('202-555-0100');
  });

  it('lists the opportunities they run, open ones first, with a real location', async () => {
    const b = await getBuyerDetail('10');
    expect(b!.oppCount).toBe(2);
    // Active/open (N1) sorts before the closed one (N2).
    expect(b!.opportunities[0].noticeId).toBe('N1');
    expect(b!.opportunities[0].active).toBe(true);
    // Location recovered from the first notice carrying one.
    expect(b!.location).toBe('Washington, DC');
    expect(b!.locApprox).toBe(false);
  });

  it('includes the office roster (other contacts at the agency, excluding the buyer)', async () => {
    const b = await getBuyerDetail('10');
    expect(b!.roster.map((r) => r.name)).toContain('Sam Colleague');
    expect(b!.roster.map((r) => r.name)).not.toContain('Jane Buyer');
  });

  it('includes agency intel when available', async () => {
    const b = await getBuyerDetail('10');
    expect(b!.agencyIntel?.priorities).toContain('Cloud modernization');
  });

  it('honors the phone-as-name guard (#462) — a placeholder id returns null', async () => {
    const b = await getBuyerDetail('99');
    expect(b).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const b = await getBuyerDetail('404');
    expect(b).toBeNull();
  });
});
