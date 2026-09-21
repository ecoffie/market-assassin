import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FORBIDDEN_ACTIVITY_POOL_FLOOR,
  assertBoundedActivityPool,
  describeSamSizeForRequirement,
  evaluationCap,
  sizeStatusForNaics,
  uniqueUeis,
} from './evaluation-bound';

const SRC = readFileSync(join(__dirname, 'market-research.ts'), 'utf8');
const DEPTH = readFileSync(join(__dirname, '../../mcp/tools/market-depth.ts'), 'utf8');

describe('evaluation bound — population vs sample vs activity pool', () => {
  it('treats businesses.length, requested limit, and eligible population as separate concepts', () => {
    expect(SRC).toMatch(/matchingUeiCount/);
    expect(SRC).toMatch(/eligiblePopulation/);
    expect(SRC).toMatch(/const POOL_TARGET = limit/);
    expect(SRC).not.toMatch(/Math\.max\(limit \* 10,\s*2500\)/);
    expect(DEPTH).toMatch(/matching_uei_count: res\?\.matchingUeiCount \?\? null/);
    expect(evaluationCap(50)).toBe(50);
    expect(evaluationCap(undefined)).toBe(200);
  });

  it('refuses to construct the historic 2,500-UEI activity pool', () => {
    expect(() => assertBoundedActivityPool(50, 2500)).toThrow(/2,500-UEI cost bomb|2500/);
    expect(() => assertBoundedActivityPool(50, 51)).toThrow(/exceeds evaluation cap 50/);
    expect(() => assertBoundedActivityPool(50, 50)).not.toThrow();
    expect(FORBIDDEN_ACTIVITY_POOL_FLOOR).toBe(2500);
    expect(SRC).toMatch(/assertBoundedActivityPool\(evaluationLimit \?\? unique\.length, unique\.length\)/);
  });

  it('deduplicates UEIs before querying', () => {
    expect(uniqueUeis(['abc123abc123', 'ABC123ABC123', '  ', 'def123def123'])).toEqual([
      'ABC123ABC123',
      'DEF123DEF123',
    ]);
    expect(SRC).toMatch(/uniqueUeis\(pool\.map/);
  });

  it('does not substitute sampleSize when matchingUeiCount is unknown', () => {
    expect(SRC).not.toMatch(/matchingUeiCount !== null \? matchingUeiCount : sampleSize/);
    expect(SRC).toMatch(/matchingUeiCount !== null/);
    expect(SRC).toMatch(/matchingUeiCount \/ eligiblePopulation/);
  });
});

describe('SAM size evidence — no inference', () => {
  it('reads only the requirement NAICS Y/N/E cell', () => {
    expect(sizeStatusForNaics({ '541512': 'Y', '561720': 'N' }, '541512')).toBe('Y');
    expect(sizeStatusForNaics({ '541512': 'Y' }, '561720')).toBeNull();
    expect(sizeStatusForNaics({ '541512': 'maybe' }, '541512')).toBeNull();
    expect(sizeStatusForNaics(null, '541512')).toBeNull();
  });

  it('does not treat an SBA exception as small or other-than-small', () => {
    const described = describeSamSizeForRequirement({
      sizeStatus: 'E',
      sizeStatusNaics: '541512',
      requirementNaics: '541512',
    });
    expect(described.established).toBe(false);
    expect(described.small).toBeNull();
  });
});
