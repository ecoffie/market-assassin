/**
 * lookup_sam_entity — a SAM placeholder negative vs a stored extract that CONTRADICTS ITSELF.
 *
 * Found in review of #1947 (2026-11-09). The cross-check weakened a placeholder negative only
 * when the extract marked the program `active`. When the extract's two columns disagree —
 * `certifications` lists the program while `certification_records` says expired — the local
 * mapper reads `not_established` (conflicting_extract_fields), and the cross-check treated
 * that as "the extract does not show it", so `has8a:false` / `hasHUBZone:false` stood.
 * Same evidence, two answers: the local path said unknown, the live path said "not certified".
 * Measured among single-placeholder firms: 97 with 8(a) conflicts, 4 with HUBZone conflicts.
 * Jordon (N4BAZDMM7DV7) is the proof the pattern can hide an ACTIVE cert: its extract carried
 * exactly this HUBZone conflict while SBA showed HUBZone active.
 *
 * Unlike sam-entity-cert-truth, the stored row goes through the REAL entity-local-fallback
 * mapper (only the Supabase client is stubbed), so the reason string is the one production
 * emits — not a hand-written record. Live SAM goes through the REAL transformEntity.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import cnr from '@/lib/sam/__fixtures__/sam-cert-VNXTJ9FY5LA9.json';

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mockFrom(t) }) }));

const mockByUei = vi.fn();
vi.mock('@/lib/sam/entity-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sam/entity-api')>('@/lib/sam/entity-api');
  return { ...actual, getEntityByUEI: (u: string) => mockByUei(u), searchEntities: vi.fn() };
});

const { transformEntity } = await import('@/lib/sam/entity-api');
const { lookupSamEntity } = await import('./sam-entity');
const { projectChatgptResult } = await import('@/lib/mcp/chatgpt-profile');

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-09T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
  mockFrom.mockReset(); mockByUei.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k';
});

function stubRow(row: unknown) {
  const chain = {
    select: () => chain, eq: () => chain, ilike: () => chain,
    limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
  mockFrom.mockReturnValue(chain);
}

/** A live SAM response carrying ONLY SAM's single all-null placeholder entry. */
const placeholderFirm = (uei: string) => transformEntity({
  entityRegistration: { ueiSAM: uei, legalBusinessName: 'PLACEHOLDER CO', registrationStatus: 'Active' },
  coreData: { businessTypes: { businessTypeList: [], sbaBusinessTypeList: [
    { sbaBusinessTypeCode: null, sbaBusinessTypeDesc: null, certificationEntryDate: null, certificationExitDate: null },
  ] } },
});

/** Stored sam_entities row in the production column shape. */
const storedRow = (uei: string, certifications: string[], certification_records: unknown[]) => ({
  uei, cage_code: null, legal_business_name: 'PLACEHOLDER CO', dba_name: null,
  physical_city: null, physical_state: null, physical_zip: null, physical_country: 'USA',
  primary_naics: null, naics_codes: [], certifications, certification_records,
  registration_status: 'Active', registration_expiry: null, exclusion_flag: false, sam_url: null,
  synced_at: '2026-08-25T00:00:00.000+00:00',
});

function shipped(result: unknown) {
  return {
    claude: JSON.parse(JSON.stringify(result, null, 2)),
    chatgpt: projectChatgptResult('lookup_sam_entity', result as Record<string, unknown>),
  };
}
const statusOf = (out: { certification_status: Array<{ program: string }> }, p: string) =>
  out.certification_status.find((c) => c.program === p) as { status: string; reasons: string[]; source_label: string };

describe('placeholder negative vs a self-contradicting stored extract', () => {
  it('HUBZone — Jordon\'s conflicting-field pattern weakens the placeholder negative on BOTH hosts', async () => {
    mockByUei.mockResolvedValue(placeholderFirm('HZCONFLICT01'));
    // Jordon's stored HUBZone values, verbatim (Aug extract): listed, yet recorded expired.
    stubRow(storedRow('HZCONFLICT01', ['HUBZone'], [
      { source_code: 'XX20240318', certification_type: 'HUBZone', certification_status: 'expired', certification_expires_on: '2024-03-18' },
    ]));
    const r = await lookupSamEntity({ uei: 'HZCONFLICT01' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(JSON.stringify(out)).not.toMatch(/"hasHUBZone":false/);
      expect('hasHUBZone' in out.entity).toBe(false);          // unknown, never a positive either
      const hz = statusOf(out, 'HUBZone');
      expect(hz.status).toBe('not_established');
      expect(hz.reasons).toEqual(['sam_placeholder_entry', 'conflicts_with_stored_sam_extract', 'stored_extract_fields_conflict']);
      expect(hz.source_label).toMatch(/contradictory records/);
      expect(out.certification_note).toMatch(/did not establish HUBZone/);
      expect(out.certification_note).toMatch(/UNKNOWN, not "not certified"/);
      // 8(a): the extract is silent on it, so SAM's placeholder negative stands — still labelled
      // as SAM evidence, never as an SBA non-certification.
      expect(out.entity.has8a).toBe(false);
      expect(statusOf(out, '8(a)').status).toBe('not_listed');
      expect(statusOf(out, '8(a)').source_label).toMatch(/not an SBA determination of non-certification/);
    }
    expect((r.cert_provenance ?? []).some((p) => p.cert === 'HUBZone')).toBe(false);
    expect(r._meta.certification_cross_check).toBe('checked');
  });

  it('8(a) — listed but recorded expired weakens the placeholder negative on BOTH hosts', async () => {
    mockByUei.mockResolvedValue(placeholderFirm('EIGHTACONF01'));
    stubRow(storedRow('EIGHTACONF01', ['8(a)'], [
      { source_code: 'A620250612', certification_type: '8(a)', certification_status: 'expired', certification_expires_on: '2025-06-12' },
    ]));
    const r = await lookupSamEntity({ uei: 'EIGHTACONF01' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(JSON.stringify(out)).not.toMatch(/"has8a":false/);
      expect('has8a' in out.entity).toBe(false);
      expect(statusOf(out, '8(a)').status).toBe('not_established');
      expect(statusOf(out, '8(a)').reasons).toContain('stored_extract_fields_conflict');
      expect(out.certification_note).toMatch(/did not establish 8\(a\)/);
      expect(out.entity.hasHUBZone).toBe(false);               // extract silent on HUBZone
    }
    expect((r.cert_provenance ?? []).some((p) => p.cert === '8(a)')).toBe(false);
  });

  it('an extract that AGREES (recorded expired, not listed) leaves the placeholder negative standing', async () => {
    mockByUei.mockResolvedValue(placeholderFirm('EIGHTAAGREE1'));
    stubRow(storedRow('EIGHTAAGREE1', [], [
      { source_code: 'A620250612', certification_type: '8(a)', certification_status: 'expired', certification_expires_on: '2025-06-12' },
    ]));
    const r = await lookupSamEntity({ uei: 'EIGHTAAGREE1' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(out.entity.has8a).toBe(false);
      expect(statusOf(out, '8(a)').status).toBe('not_listed');
      expect(out.certification_note).toBeUndefined();
    }
  });

  it('a negative from a COMPLETE SAM list is never weakened by an extract conflict (CNR 8(a))', async () => {
    mockByUei.mockResolvedValue(transformEntity(cnr.entity as Record<string, unknown>));
    stubRow(storedRow('VNXTJ9FY5LA9', ['HUBZone', '8(a)'], [
      { source_code: 'A620250612', certification_type: '8(a)', certification_status: 'expired', certification_expires_on: '2025-06-12' },
    ]));
    const r = await lookupSamEntity({ uei: 'VNXTJ9FY5LA9' });
    expect(r.entity?.has8a).toBe(false);
    expect(r._meta.certification_cross_check).toBe('not_needed');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('CNR Restorations VNXTJ9FY5LA9 — real SAM response (sam_api_cache, 2026-11-04)', () => {
  it('HUBZone active from 2024-07-09; 8(a) is SAM\'s complete-list negative; same on both hosts', async () => {
    mockByUei.mockResolvedValue(transformEntity(cnr.entity as Record<string, unknown>));
    const r = await lookupSamEntity({ uei: 'VNXTJ9FY5LA9' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(out.entity).toMatchObject({ hasHUBZone: true, has8a: false });
      expect(statusOf(out, 'HUBZone')).toMatchObject({ status: 'active', entry_date: '2024-07-09', exit_date: null });
      expect(statusOf(out, '8(a)').status).toBe('not_listed');
      expect(out.certification_note).toBeUndefined();
    }
    expect(r._meta.certification_cross_check).toBe('not_needed');
    expect(r.cert_provenance?.map((p) => `${p.cert}:${p.source}`)).toContain('HUBZone:sba');
  });
});
