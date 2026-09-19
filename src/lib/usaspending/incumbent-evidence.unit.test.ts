import { describe, it, expect } from 'vitest';
import { groundIncumbent } from './incumbent-evidence';

describe('unsupported incumbent identification', () => {
  it('a high-confidence guess with only a NAICS match is NOT grounded', () => {
    const r = groundIncumbent({
      distinctiveHits: 0,
      pscMatch: false,
      naicsMatch: true,
      matchConfidence: 'high',
    });
    expect(r.grounded).toBe(false);
    expect(r.certainty).toBe('uncertain');
    expect(r.reason).toMatch(/NAICS/i);
  });

  it('a NAICS Mismatch does not disqualify real title/PSC evidence', () => {
    const r = groundIncumbent({
      distinctiveHits: 3,
      pscMatch: true,
      naicsMatch: false,
      matchConfidence: 'high',
    });
    expect(r.grounded).toBe(true);
    expect(r.certainty).toBe('supported');
  });

  it('medium/low confidence stays uncertain even with a NAICS hit', () => {
    const r = groundIncumbent({
      distinctiveHits: 1,
      pscMatch: false,
      naicsMatch: true,
      matchConfidence: 'medium',
    });
    expect(r.grounded).toBe(false);
    expect(r.certainty).toBe('uncertain');
  });

  it('no candidate is none, not a fabricated incumbent', () => {
    expect(groundIncumbent(null).certainty).toBe('none');
    expect(groundIncumbent(null).grounded).toBe(false);
  });
});
