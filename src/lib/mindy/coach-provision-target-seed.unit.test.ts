import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Repair board P1-E — coach seeding wrote user_target_list rows WITHOUT office_name.
 * office_name is NOT NULL in prod (information_schema, 2026-09-26), so every seed
 * insert failed, and the error was swallowed (`if (!error) agenciesSeeded = …`):
 * 64 clients provisioned, 61 seeded from capability text, 0 capability_text_seed rows.
 *
 * The seed's buyer list is USASpending `awarding_agency` — a DEPARTMENT, never an
 * office. Nothing in hand names an office, so the honest outcome is: write no row
 * with an invented office, count the skip, and surface any insert failure.
 */

const profile = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/market/profile-from-text', () => ({
  buildProfileFromText: vi.fn(async () => profile.value),
}));
vi.mock('@/lib/codes/validate-market-codes', () => ({ isKnownNaicsCode: () => true }));

import { seedClientProfile } from './coach-provision';

type Row = Record<string, unknown>;
function fakeSupabase(insertError: { message: string; code?: string } | null = null) {
  const inserted: Row[] = [];
  const client = {
    from(table: string) {
      return {
        upsert: async () => ({ error: null }),
        insert: async (rows: Row | Row[]) => {
          if (table === 'user_target_list') inserted.push(...(Array.isArray(rows) ? rows : [rows]));
          return { error: insertError };
        },
      };
    },
  };
  return { client, inserted };
}

const baseProfile = {
  naics: [], coverageCandidates: ['236220'], topPsc: null, keywords: ['roofing'],
  states: [], setAsides: [],
};

describe('coach seed → user_target_list', () => {
  beforeEach(() => { profile.value = null; });

  it('never persists a target row without a real, non-empty office_name', async () => {
    profile.value = { ...baseProfile, agencies: [
      { name: 'Department of Defense', amount: 5_000_000 },
      { name: 'General Services Administration', amount: 1_000_000 },
    ] };
    const { client, inserted } = fakeSupabase();
    const r = await seedClientProfile(client, 'org-x-acme', 'ACME', 'we do roofing');
    for (const row of inserted) {
      expect(typeof row.office_name).toBe('string');
      expect(String(row.office_name).trim()).not.toBe('');
      // An agency name is not an office — never relabel one as the other.
      expect(row.office_name).not.toBe(row.agency_name);
    }
    expect(r.agencies).toBe(inserted.length);
    expect(r.targets.skippedNoOffice).toBe(2);
  });

  it('persists a row when the buyer carries a real office, with that office_name', async () => {
    profile.value = { ...baseProfile, agencies: [
      { name: 'Department of Defense', amount: 5, office: 'U.S. Army Corps of Engineers' },
      { name: 'Department of Energy', amount: 3 },
    ] };
    const { client, inserted } = fakeSupabase();
    const r = await seedClientProfile(client, 'org-x-acme', 'ACME', 'we do roofing');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].office_name).toBe('U.S. Army Corps of Engineers');
    expect(inserted[0].agency_name).toBe('Department of Defense');
    expect(r.agencies).toBe(1);
    expect(r.targets).toMatchObject({ attempted: 1, inserted: 1, skippedNoOffice: 1, error: null });
  });

  it('surfaces the insert error instead of swallowing it', async () => {
    profile.value = { ...baseProfile, agencies: [
      { name: 'Department of Defense', amount: 5, office: 'NAVFAC Mid-Atlantic' },
    ] };
    const { client } = fakeSupabase({ message: 'null value in column "office_name" violates not-null constraint', code: '23502' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await seedClientProfile(client, 'org-x-acme', 'ACME', 'we do roofing');
    expect(r.agencies).toBe(0);
    expect(r.targets.error).toMatch(/office_name/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
