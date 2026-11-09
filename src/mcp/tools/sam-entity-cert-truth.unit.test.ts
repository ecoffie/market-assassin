/**
 * lookup_sam_entity certification truth — what the ASSISTANT actually receives.
 *
 * Real SAM v3 responses (2026-11-09, POCs removed) go through the REAL transformEntity; only
 * the network edges (live SAM, the stored-extract read) are mocked. Every result is checked
 * through both serializers that ship it:
 *   Claude  — src/app/mcp/[transport]/route.ts: JSON.stringify(result) + structuredContent
 *   ChatGPT — src/app/chatgpt/mcp/route.ts: projectChatgptResult(tool, result)
 * so no layer can re-create `has8a:false` from an unknown.
 *
 * Production before this fix, AMS TH2ZULPHFJS8 (prod MCP call, 2026-11-09):
 *   "has8a":false, "hasHUBZone":false, "sbaBusinessTypes":[], source sam_live, degraded false
 * while SBA's Small Business Search shows 8(a), HUBZone, WOSB and EDWOSB active.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import th2z from '@/lib/sam/__fixtures__/sam-cert-TH2ZULPHFJS8.json';
import ghfy from '@/lib/sam/__fixtures__/sam-cert-GHFYLESVE2V5.json';
import jordon from '@/lib/sam/__fixtures__/sam-cert-N4BAZDMM7DV7.json';

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}) }) }));

const mockByUei = vi.fn();
const mockLocalUei = vi.fn();
vi.mock('@/lib/sam/entity-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sam/entity-api')>('@/lib/sam/entity-api');
  return { ...actual, getEntityByUEI: (u: string) => mockByUei(u), searchEntities: vi.fn() };
});
vi.mock('@/lib/sam/entity-local-fallback', () => ({
  lookupLocalEntitiesByName: async () => ({ status: 'absent' }),
  lookupLocalEntityByUEI: async (u: string) => {
    try {
      const hit = await mockLocalUei(u);
      return hit ? { status: 'found', hit } : { status: 'absent' };
    } catch (e) {
      return { status: 'unavailable', detail: String(e) };
    }
  },
}));

const { transformEntity } = await import('@/lib/sam/entity-api');
const { lookupSamEntity } = await import('./sam-entity');
const { projectChatgptResult } = await import('@/lib/mcp/chatgpt-profile');

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-09T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { mockByUei.mockReset(); mockLocalUei.mockReset(); mockLocalUei.mockResolvedValue(null); });

const live = (fx: { entity: unknown }) => transformEntity(fx.entity as Record<string, unknown>);

/** Both shipped serializations, as the hosts parse them. */
function shipped(result: unknown) {
  const claude = JSON.parse(JSON.stringify(result, null, 2));
  const chatgpt = projectChatgptResult('lookup_sam_entity', result as Record<string, unknown>);
  return { claude, chatgpt, text: JSON.stringify(result) };
}

describe('AMS TH2ZULPHFJS8 — four blank SAM entries', () => {
  it('⚠️ THE REGRESSION: neither host receives has8a:false or hasHUBZone:false', async () => {
    mockByUei.mockResolvedValue(live(th2z));
    const r = await lookupSamEntity({ uei: 'TH2ZULPHFJS8' });
    const { claude, chatgpt, text } = shipped(r);
    expect(text).not.toMatch(/"has(8a|HUBZone)":false/);
    for (const out of [claude, chatgpt]) {
      expect(out.entity.has8a).toBeUndefined();
      expect(out.entity.hasHUBZone).toBeUndefined();
      expect(out.certification_status.map((c: { status: string }) => c.status))
        .toEqual(['not_established', 'not_established', 'not_established', 'not_established']);
      expect(out.certification_note).toMatch(/UNKNOWN, not "not certified"/);
      expect(out.certification_note).toMatch(/8\(a\), HUBZone, WOSB, EDWOSB/);
    }
    // 4 blanks are not the placeholder → no extract read was needed
    expect(r._meta.certification_cross_check).toBe('not_needed');
    expect(mockLocalUei).not.toHaveBeenCalled();
  });

  it('cert_provenance never lists 8(a)/HUBZone as held — and never as SBA-negative', async () => {
    mockByUei.mockResolvedValue(live(th2z));
    const r = await lookupSamEntity({ uei: 'TH2ZULPHFJS8' });
    expect(r.cert_provenance).toEqual([
      { cert: 'WOSB', source: 'self', source_label: 'SAM self-identified', authoritative: false },
    ]);
  });
});

describe('AMS GHFYLESVE2V5 — complete SBA list with dates', () => {
  it('active programs carry SAM entry/exit dates; WOSB is SBA-sourced (A9), EDWOSB listed', async () => {
    mockByUei.mockResolvedValue(live(ghfy));
    const r = await lookupSamEntity({ uei: 'GHFYLESVE2V5' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(out.entity).toMatchObject({ has8a: true, hasHUBZone: true, hasWOSB: true });
      expect(out.certification_status.find((c: { program: string }) => c.program === '8(a)'))
        .toMatchObject({ status: 'active', entry_date: '2022-06-03', exit_date: '2031-06-02' });
      expect(out.certification_note).toBeUndefined();
    }
    expect(r.cert_provenance?.map((p) => `${p.cert}:${p.source}`)).toEqual(['8(a):sba', 'HUBZone:sba', 'WOSB:sba', 'EDWOSB:sba']);
  });
});

describe('Jordon N4BAZDMM7DV7 — exit then re-entry', () => {
  it('HUBZone active from the 2024-04-05 re-entry, the 2024-03-18 exit kept as history', async () => {
    mockByUei.mockResolvedValue(live(jordon));
    const r = await lookupSamEntity({ uei: 'N4BAZDMM7DV7' });
    const { chatgpt } = shipped(r);
    expect(chatgpt.entity.hasHUBZone).toBe(true);
    expect(chatgpt.certification_status.find((c: { program: string }) => c.program === 'HUBZone'))
      .toMatchObject({ status: 'active', entry_date: '2024-04-05', exit_date: null, prior_exit_date: '2024-03-18' });
    expect(chatgpt.entity.has8a).toBe(false); // complete readable list without 8(a): SAM's negative
  });
});

describe('placeholder negatives vs the stored SAM extract (conflicting / stale evidence)', () => {
  const placeholderFirm = () => transformEntity({
    entityRegistration: { ueiSAM: 'PLACEHOLDER01', legalBusinessName: 'PLACEHOLDER CO', registrationStatus: 'Active' },
    coreData: { businessTypes: { businessTypeList: [], sbaBusinessTypeList: [{ sbaBusinessTypeCode: null, sbaBusinessTypeDesc: null }] } },
  });
  const extractWith = (status: 'active' | 'inactive') => ({
    asOf: '2026-08-25',
    entity: { ueiSAM: 'PLACEHOLDER01', certificationStatus: [{ program: '8(a)', status, basis: 'sam_extract', reasons: [] }] },
  });

  it('extract shows current 8(a) → 8(a) not_established, flag removed, note names it', async () => {
    mockByUei.mockResolvedValue(placeholderFirm());
    mockLocalUei.mockResolvedValue(extractWith('active'));
    const r = await lookupSamEntity({ uei: 'PLACEHOLDER01' });
    const { claude, chatgpt } = shipped(r);
    for (const out of [claude, chatgpt]) {
      expect(out.entity.has8a).toBeUndefined();
      expect(out.entity.hasHUBZone).toBe(false);
      expect(out.certification_note).toMatch(/did not establish 8\(a\)/);
    }
    expect(r._meta.certification_cross_check).toBe('checked');
  });

  it('extract agrees (no 8(a)) → SAM\'s negative stands', async () => {
    mockByUei.mockResolvedValue(placeholderFirm());
    mockLocalUei.mockResolvedValue(extractWith('inactive'));
    const r = await lookupSamEntity({ uei: 'PLACEHOLDER01' });
    expect(r.entity?.has8a).toBe(false);
    expect(r.certification_note).toBeUndefined();
    expect(r._meta.certification_cross_check).toBe('checked');
  });

  it('extract unreachable → FAIL SAFE: placeholder negatives become not_established on BOTH hosts', async () => {
    mockByUei.mockResolvedValue(placeholderFirm());
    mockLocalUei.mockRejectedValue(new Error('db down'));
    const r = await lookupSamEntity({ uei: 'PLACEHOLDER01' });
    const { claude, chatgpt, text } = shipped(r);
    expect(text).not.toMatch(/"has(8a|HUBZone)":false/);
    for (const out of [claude, chatgpt]) {
      expect(out.entity.has8a).toBeUndefined();
      expect(out.entity.hasHUBZone).toBeUndefined();
      expect(out.certification_status.find((c: { program: string }) => c.program === '8(a)').reasons)
        .toContain('extract_cross_check_unavailable');
      expect(out.certification_note).toMatch(/UNKNOWN/);
    }
    expect(r._meta.certification_cross_check).toBe('unavailable');
    expect(r._meta.degraded).toBe(false); // registration lookup itself succeeded
  });

  it('the fail-safe never weakens a negative from a COMPLETE list (Jordon 8(a)) even if the check cannot run', async () => {
    mockByUei.mockResolvedValue(live(jordon));
    mockLocalUei.mockRejectedValue(new Error('db down'));
    const r = await lookupSamEntity({ uei: 'N4BAZDMM7DV7' });
    expect(r.entity?.has8a).toBe(false);
    expect(r._meta.certification_cross_check).toBe('not_needed');
  });

  it('cross-check covers every program the extract knows: HUBZone and WOSB, not just 8(a)', async () => {
    mockByUei.mockResolvedValue(placeholderFirm());
    mockLocalUei.mockResolvedValue({
      asOf: '2026-08-25',
      entity: { ueiSAM: 'PLACEHOLDER01', certificationStatus: [
        { program: 'HUBZone', status: 'active', basis: 'sam_extract', reasons: [] },
        { program: 'WOSB', status: 'active', basis: 'sam_extract', reasons: [] },
      ] },
    });
    const r = await lookupSamEntity({ uei: 'PLACEHOLDER01' });
    expect(r.entity?.hasHUBZone).toBeUndefined();
    expect(r.entity?.hasWOSB).toBeUndefined();
    expect(r.entity?.has8a).toBe(false);
  });

  it('a placeholder negative is labelled as SAM evidence, never as non-certification', async () => {
    mockByUei.mockResolvedValue(placeholderFirm());
    const r = await lookupSamEntity({ uei: 'PLACEHOLDER01' });
    for (const c of r.certification_status!) {
      expect(c.status).toBe('not_listed');
      expect(c.source_label).toMatch(/not an SBA determination of non-certification/);
    }
  });
});

describe('response contract stays usable for existing clients', () => {
  it('existing keys and shapes are unchanged; new keys are additive', async () => {
    mockByUei.mockResolvedValue(live(ghfy));
    const r = await lookupSamEntity({ uei: 'GHFYLESVE2V5' });
    expect(r.entity).toEqual(expect.objectContaining({
      ueiSAM: 'GHFYLESVE2V5', isActive: true,
      certifications: expect.objectContaining({ sbaBusinessTypes: expect.any(Array), certificationExpirations: expect.any(Array) }),
    }));
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, source: 'sam_live', lookup_status: 'found' });
  });
});
