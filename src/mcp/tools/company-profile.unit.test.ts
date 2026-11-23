import { describe, it, expect, vi, beforeEach } from 'vitest';

const { inserted, loadVaultContext, loadBidderProfileResult, embedVaultRow } = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  loadVaultContext: vi.fn(),
  loadBidderProfileResult: vi.fn(),
  embedVaultRow: vi.fn(async () => true),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: 'pp-1', ...row }, error: null }) }) };
      },
      select: () => ({ eq: () => ({ is: async () => ({ count: inserted.length, error: null }) }) }),
    }),
  }),
}));
vi.mock('@/lib/proposal/loaders', () => ({ loadVaultContext, loadBidderProfileResult }));
vi.mock('@/lib/vault/embed-evidence', () => ({ embedVaultRow }));
vi.mock('@/lib/alerts/capability-vector', () => ({ invalidateCapabilityVector: vi.fn(async () => {}) }));

import { buildPastPerformanceRow, savePastPerformance, getCompanyProfile } from './company-profile';

const REAL = { title: 'Grounds maintenance, Dayton parks', customer: 'City of Dayton', scope: 'Mowed and maintained 40 acres weekly.', confirm_real: true };

beforeEach(() => {
  inserted.length = 0;
  loadVaultContext.mockReset();
  loadBidderProfileResult.mockReset();
  loadBidderProfileResult.mockResolvedValue({ status: 'ok', profile: {} });
});

describe('save_past_performance', () => {
  it('refuses without confirm_real (never saves an example or invented project)', () => {
    const r = buildPastPerformanceRow({ userEmail: 'a@x.com', ...REAL, confirm_real: undefined });
    expect(r.ok).toBe(false);
  });

  it('names the missing required fields', () => {
    const r = buildPastPerformanceRow({ userEmail: 'a@x.com', confirm_real: true, title: 'X' });
    expect(r).toMatchObject({ ok: false, missing_fields: ['customer', 'scope'] });
  });

  it('validates role, dates and value', () => {
    expect(buildPastPerformanceRow({ userEmail: 'a', ...REAL, role: 'boss' }).ok).toBe(false);
    expect(buildPastPerformanceRow({ userEmail: 'a', ...REAL, period_start: '03/2024' }).ok).toBe(false);
    expect(buildPastPerformanceRow({ userEmail: 'a', ...REAL, value: -5 }).ok).toBe(false);
    const ok = buildPastPerformanceRow({ userEmail: 'a', ...REAL, role: 'Sub', value: '$1,250,000', naics_codes: ['561730', 'abc'] });
    expect(ok).toMatchObject({ ok: true, row: { role: 'sub', contract_value: 1250000, naics_codes: ['561730'], agency: 'City of Dayton', source: 'mcp' } });
  });

  it('writes to the verified caller, ignoring any email in args', async () => {
    const r = await savePastPerformance({ ...REAL, userEmail: 'owner@x.com', ...({ user_email: 'victim@y.com' } as object) });
    expect(r.saved).toBe(true);
    expect(inserted[0].user_email).toBe('owner@x.com');
    expect(embedVaultRow).toHaveBeenCalled();
  });

  it('coach workspace: writes to the authorized vault owner', async () => {
    await savePastPerformance({ ...REAL, userEmail: 'coach@x.com', vaultEmail: 'client@clients.getmindy.ai' });
    expect(inserted[0].user_email).toBe('client@clients.getmindy.ai');
  });
});

describe('get_company_profile', () => {
  it('empty vault: lists what is missing and gives past-performance guidance', async () => {
    loadVaultContext.mockResolvedValue({ has_any: false, identity: null, past_performance: [], capabilities: [], team: [] });
    const r = await getCompanyProfile({ userEmail: 'new@x.com' });
    expect(r.counts.past_performance).toBe(0);
    expect(r.missing).toContain('past performance');
    expect(r.past_performance_guidance?.join(' ')).toMatch(/FAR 15\.305/);
  });

  it('a failed read is unavailable with a null count, never zero', async () => {
    loadVaultContext.mockResolvedValue({ has_any: false, past_performance: [], capabilities: [], team: [], unavailable: ['past_performance'] });
    const r = await getCompanyProfile({ userEmail: 'x@x.com' });
    expect(r.counts.past_performance).toBeNull();
    expect(r.missing).not.toContain('past performance');
    expect(r.past_performance_guidance).toBeUndefined();
    expect(r._meta.degraded).toBe(true);
  });

  it('returns saved projects', async () => {
    loadVaultContext.mockResolvedValue({
      has_any: true,
      identity: { legal_name: 'Acme Grounds LLC', uei: 'ABCDEFGHJKLM', primary_naics: ['561730'] },
      past_performance: [{ id: 'p1', contract_title: 'Parks', agency: 'City of Dayton', role: 'prime', period_start: '2024-01-01', contract_value: '50000', reference_name: 'J. Doe' }],
      capabilities: [{}], team: [{}],
    });
    const r = await getCompanyProfile({ userEmail: 'x@x.com' });
    expect(r.company).toMatchObject({ name: 'Acme Grounds LLC', uei: 'ABCDEFGHJKLM', naics_codes: ['561730'] });
    expect(r.past_performance[0]).toMatchObject({ title: 'Parks', customer: 'City of Dayton', value: 50000, has_reference: true, period: '2024-01-01 to present' });
    expect(r.missing).toEqual([]);
  });
});
