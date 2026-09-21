import { describe, it, expect } from 'vitest';
import { buildCapabilityBlob, blobHash, cosineSimilarity, estimateTokens, type EmbeddableProfile } from './embed';

const base: EmbeddableProfile = {
  rollup_uei: 'ABC123',
  rollup_name: 'ACME SERVICES LLC',
  capability_label: 'Custodial & janitorial services',
  top_pscs: [
    { code: 'S201', description: 'HOUSEKEEPING- CUSTODIAL JANITORIAL', share: 0.92 },
    { code: 'S208', description: 'HOUSEKEEPING- LANDSCAPING/GROUNDSKEEPING', share: 0.05 },
  ],
  top_naics: [{ code: '561720', description: 'JANITORIAL SERVICES' }],
  top_agencies: [{ agency: 'Department of Defense', share: 0.61 }],
  set_asides_won: ['SMALL BUSINESS SET ASIDE - TOTAL'],
  specialty_tier: 'specialist',
};

describe('buildCapabilityBlob', () => {
  it('leads with the capability label and the primary PSC', () => {
    const blob = buildCapabilityBlob(base);
    expect(blob.startsWith('Custodial & janitorial services')).toBe(true);
    expect(blob).toContain('Primarily HOUSEKEEPING- CUSTODIAL JANITORIAL');
  });

  it('includes industries and buyers so the vector captures who they sell to', () => {
    const blob = buildCapabilityBlob(base);
    expect(blob).toContain('Industries: JANITORIAL SERVICES');
    expect(blob).toContain('Sells to Department of Defense');
  });

  it('never renders numeric shares — a model reads "0.92" as a token, not a magnitude', () => {
    const blob = buildCapabilityBlob(base);
    expect(blob).not.toMatch(/0\.\d+/);
    expect(blob).not.toMatch(/\d+%/);
  });

  it('phrases set-aside as work WON, never as a held certification', () => {
    const blob = buildCapabilityBlob(base);
    expect(blob).toContain('Has won set-aside work');
    expect(blob).not.toMatch(/\bis (certified|an? (SDVOSB|8\(a\)|HUBZone|WOSB))\b/i);
  });

  it('drops the NO SET ASIDE sentinel rather than embedding it as a capability', () => {
    const blob = buildCapabilityBlob({ ...base, set_asides_won: ['NO SET ASIDE USED.'] });
    expect(blob).not.toContain('set-aside work');
  });

  it('describes the tier in words the embedding space can use', () => {
    expect(buildCapabilityBlob(base)).toContain('specialist concentrated in one');
    expect(buildCapabilityBlob({ ...base, specialty_tier: 'diversified' })).toContain('diversified contractor spanning');
  });

  it('returns an empty string when there is nothing real to embed', () => {
    expect(buildCapabilityBlob({
      ...base, capability_label: null, top_pscs: null, top_naics: null,
      top_agencies: null, set_asides_won: null, specialty_tier: null,
    })).toBe('');
  });

  it('caps length so a pathological row cannot blow the token budget', () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({ code: `X${i}`, description: 'A'.repeat(200) }));
    expect(buildCapabilityBlob({ ...base, top_pscs: huge }).length).toBeLessThanOrEqual(8000);
  });
});

describe('blobHash', () => {
  it('is stable for identical text and differs when the meaning changes', () => {
    const a = buildCapabilityBlob(base);
    expect(blobHash(a)).toBe(blobHash(a));
    expect(blobHash(a)).not.toBe(blobHash(buildCapabilityBlob({ ...base, capability_label: 'Something else' })));
  });

  it('is what makes a re-run free — unchanged rows are skipped, not re-embedded', () => {
    expect(blobHash('x')).toHaveLength(40); // sha1 hex
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('is scale-invariant (direction is the meaning, not magnitude)', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });

  it('returns 0 on shape mismatch or empty input rather than throwing', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('approximates 4 chars per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
