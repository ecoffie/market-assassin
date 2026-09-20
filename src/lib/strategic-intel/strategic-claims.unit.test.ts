/**
 * The strategic-claim read boundary.
 *
 * Measured on origin/main @297e3136: 2,500 priorities, 0 with a source URL,
 * 0 with a source tag, 8 with a bare document id. FULL provenance: 0.
 * These pin the contract that keeps that corpus from being presented as fact.
 */
import { describe, it, expect } from 'vitest';
import {
  toStrategicClaim,
  getAgencyLegacyClaimsSync,
  formatClaimForCustomer,
  citableClaimsOnly,
  DISPLAY_LABEL,
  type StrategicClaim,
} from './strategic-claims';
import type { SourcedPainPoint } from './sourced-pain-points';

const sourced: SourcedPainPoint = {
  agency: 'Department of Defense',
  pain_point: 'Chemical Security: DHS Should Provide Options',
  source_type: 'gao',
  source_url: 'https://www.gao.gov/products/gao-26-108127',
  document_number: 'GAO-26-108127',
  published_at: new Date().toISOString().slice(0, 10),
  institute_source_id: 'abc-123',
  provenance: 'SOURCE_FACT',
  legacy_source_tag: null,
};
const legacy: SourcedPainPoint = {
  agency: 'Department of Defense',
  pain_point: 'Cloud migration and DevSecOps adoption',
  source_type: 'legacy_manual',
  source_url: null,
  document_number: null,
  published_at: null,
  institute_source_id: null,
  provenance: 'LEGACY_MANUAL',
  legacy_source_tag: null,
};

describe('claim typing', () => {
  it('a cited GAO claim is AGENCY_STATED and citable', () => {
    const c = toStrategicClaim(sourced, 'Department of Defense');
    expect(c.claimType).toBe('AGENCY_STATED');
    expect(c.citable).toBe(true);
    expect(c.sourceAuthority).toBe('GAO');
    expect(c.sourceUrl).toContain('gao.gov');
    expect(c.displayLabel).toBe(DISPLAY_LABEL.AGENCY_STATED);
  });

  it('an uncited legacy claim is LEGACY_MANUAL and NOT citable', () => {
    const c = toStrategicClaim(legacy, null);
    expect(c.claimType).toBe('LEGACY_MANUAL');
    expect(c.citable).toBe(false);
    expect(c.sourceAuthority).toBeNull();
    expect(c.displayLabel).toBe(DISPLAY_LABEL.LEGACY_MANUAL);
  });

  it('a SOURCE_FACT with no URL is NOT promoted to agency-stated', () => {
    const c = toStrategicClaim({ ...sourced, source_url: null }, null);
    expect(c.claimType).not.toBe('AGENCY_STATED');
    expect(c.citable).toBe(false);
  });

  it('a legacy "(Source: GAO)" tag names an authority but never earns citability', () => {
    const c = toStrategicClaim({ ...legacy, legacy_source_tag: 'GAO' }, null);
    expect(c.sourceAuthority).toBe('GAO');
    expect(c.citable).toBe(false);
    expect(c.claimType).toBe('LEGACY_MANUAL');
  });
});

describe('temporal truth — Mindy ingest time is never evidence', () => {
  it('no publication date → UNDATED, never CURRENT', () => {
    expect(toStrategicClaim(legacy, null).temporalStatus).toBe('UNDATED');
  });
  it('a recent source date → CURRENT', () => {
    expect(toStrategicClaim(sourced, null).temporalStatus).toBe('CURRENT');
  });
  it('an old source date → HISTORICAL', () => {
    const c = toStrategicClaim({ ...sourced, published_at: '1998-04-01' }, null);
    expect(c.temporalStatus).toBe('HISTORICAL');
  });
  it('an unparseable date is UNDATED, not silently current', () => {
    expect(toStrategicClaim({ ...sourced, published_at: 'not-a-date' }, null).temporalStatus).toBe('UNDATED');
  });
});

describe('display semantics — wording is part of the claim', () => {
  it('an agency-stated claim renders with its authority and date', () => {
    expect(formatClaimForCustomer(toStrategicClaim(sourced, null))).toMatch(/\(GAO, \d{4}-\d{2}-\d{2}\)/);
  });
  it('a legacy claim always carries its label — it can never print bare', () => {
    expect(formatClaimForCustomer(toStrategicClaim(legacy, null))).toContain('[Legacy context (unsourced)]');
  });
  it('high-stakes surfaces get citable agency-stated claims ONLY', () => {
    const claims: StrategicClaim[] = [toStrategicClaim(sourced, null), toStrategicClaim(legacy, null)];
    const safe = citableClaimsOnly(claims);
    expect(safe).toHaveLength(1);
    expect(safe[0].claimType).toBe('AGENCY_STATED');
  });
});

describe('the real corpus, through the boundary', () => {
  it('DoD legacy priorities carry NO unsourced dollar amount', () => {
    const { priorities } = getAgencyLegacyClaimsSync('Department of Defense');
    expect(priorities.length).toBeGreaterThan(0);
    for (const c of priorities) {
      expect(c.claim).not.toMatch(/\$\s?[\d,.]+\s*(B|M|K|T|billion|million|trillion)\b/i);
    }
  });

  it('every corpus claim is LEGACY_MANUAL — none masquerades as agency-stated', () => {
    for (const agency of ['Department of Defense', 'Department of Veterans Affairs', 'NAVSEA']) {
      const { priorities, painPoints } = getAgencyLegacyClaimsSync(agency);
      for (const c of [...priorities, ...painPoints]) {
        expect(c.claimType).toBe('LEGACY_MANUAL');
        expect(c.citable).toBe(false);
        expect(c.temporalStatus).toBe('UNDATED');
      }
    }
  });

  it('claims that sanitize to nothing are DROPPED, not restored', () => {
    for (const agency of ['Department of Defense', 'NAVSEA']) {
      for (const c of getAgencyLegacyClaimsSync(agency).priorities) {
        expect(c.claim.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
