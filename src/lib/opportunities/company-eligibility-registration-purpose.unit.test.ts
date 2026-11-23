/**
 * FIND eligibility for an assistance-only (Z1) SAM registration — HERMETIC.
 *
 * Production 2026-11-23 (RBA Engineering, C9K6EE9JVDK7): SAM purpose Z1 "Federal Assistance
 * Awards", no NAICS. Every set-aside read UNKNOWN with the bare "no per-NAICS size" reason and the
 * customer was never told why. The verdict stays UNKNOWN (size is NOT inferred from award history);
 * only the reason now states the registration fact.
 */
import { describe, it, expect } from 'vitest';
import { transformEntity } from '@/lib/sam/entity-api';
import { anchorFromSamEntity, type CompanyAnchor } from './company-anchor';
import { evaluateEligibility, evaluateRecompeteEligibility } from './company-eligibility';

function anchorFor(code: string | undefined, desc: string | undefined, naics: unknown[], source: 'sam_entity_api' | 'local_registry' = 'sam_entity_api'): CompanyAnchor {
  const entity = transformEntity({
    entityRegistration: {
      ueiSAM: 'C9K6EE9JVDK7', legalBusinessName: 'RBA ENGINEERING INTERNATIONAL PLLC', registrationStatus: 'Active',
      ...(code ? { purposeOfRegistrationCode: code } : {}),
      ...(desc ? { purposeOfRegistrationDesc: desc } : {}),
    },
    coreData: { businessTypes: { sbaBusinessTypeList: [{ sbaBusinessTypeCode: 'A6', sbaBusinessTypeDesc: 'SBA Certified 8A Program Participant' }], businessTypeList: [] } },
    assertions: { goodsAndServices: { naicsList: naics, pscList: [] } },
  });
  return anchorFromSamEntity(entity, { source });
}

const SB_NOTICE = { set_aside_code: 'SBA', set_aside_description: 'Total Small Business Set-Aside (FAR 19.5)', naics_code: '541330' };
const EIGHT_A = { set_aside_code: '8A', set_aside_description: '8(a) Set-Aside (FAR 19.8)', naics_code: '541330' };

describe('eligibility reason — assistance-only registration', () => {
  const z1 = anchorFor('Z1', 'Federal Assistance Awards', [{ naicsCode: null }]);

  it('anchor carries the purpose and no NAICS (placeholder dropped)', () => {
    expect(z1.naics).toEqual([]);
    expect(z1.registration_purpose.contract_awards).toBe('not_registered');
    expect(z1.registration_purpose.warning).toContain('purposeOfRegistrationCode Z1');
  });

  it('set-aside stays UNKNOWN; the reason names the missing NAICS and the purpose', () => {
    for (const row of [SB_NOTICE, EIGHT_A]) {
      const v = evaluateEligibility(row, z1);
      expect(v.status).toBe('UNKNOWN');
      expect(v.reason).toContain('SAM registration lists no NAICS (registration purpose: Federal Assistance Awards only), so size under this NAICS is not established.');
      expect(v.basis.company_size_under_naics).toBe('size_unavailable');
    }
  });

  it('an unrestricted notice keeps its status but the reason carries the registration caveat', () => {
    const v = evaluateEligibility({ set_aside_code: 'NONE', set_aside_description: 'No Set aside used', naics_code: '541330' }, z1);
    expect(v.reason).toContain('not currently registered for contract awards');
  });

  it('recompete context carries the caveat', () => {
    const v = evaluateRecompeteEligibility({ set_aside_type: '8(a)', naics_code: '541330' }, z1);
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).toContain('Federal Assistance Awards only');
  });
});

describe('eligibility reason — genuinely unknown cases keep the bare reason', () => {
  it('mirror record (no size, purpose unknown) → generic size-unavailable reason, no caveat', () => {
    const mirror = anchorFor(undefined, undefined, [], 'local_registry');
    const v = evaluateEligibility(SB_NOTICE, mirror);
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).toContain('the company record available here carries no per-NAICS size');
    expect(v.reason).not.toMatch(/Federal Assistance|registration purpose/);
  });

  it('All Awards record with NAICS but no size map → generic reason, no caveat', () => {
    const z2 = anchorFor('Z2', 'All Awards', [{ naicsCode: '541330' }]);
    const v = evaluateEligibility(SB_NOTICE, z2);
    expect(v.reason).toContain('carries no per-NAICS size');
    expect(v.reason).not.toContain('contract awards');
  });

  it('live record with no NAICS and no purpose → states no NAICS, never claims assistance-only', () => {
    const a = anchorFor(undefined, undefined, []);
    const v = evaluateEligibility(SB_NOTICE, a);
    expect(v.reason).toContain('SAM registration lists no NAICS, so size under this NAICS is not established.');
    expect(v.reason).not.toContain('Federal Assistance');
  });
});
