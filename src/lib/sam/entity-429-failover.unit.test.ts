import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The UEI lookup failed twice in one week (Eric, 2026-08-21). It was not a bad key and
 * not a bad param.
 *
 * MEASURED against the four PRODUCTION keys that day:
 *   SAM_API_KEY         entity 200   opportunities 200
 *   SAM_API_KEY_1       entity 429   opportunities 429   <- quota exhausted
 *   SAM_API_KEY_2       entity 200   opportunities 200
 *   SAM_API_KEY_BACKUP  entity 429   opportunities 429   <- quota exhausted
 *
 * getSAMAPIConfig('entity') resolves ONE key via getRotatedSAMKey(), which picks by
 * day-of-year. On a day the rotation lands on an exhausted key, EVERY entity lookup
 * fails — hence "twice this week" rather than constantly.
 *
 * Worse, the failure was SILENT: a 429 returned an empty entity list identical to a
 * genuine no-match, so a caller could not tell "not registered in SAM" from "all our
 * keys are out of quota". That is how a total outage went unnoticed.
 */
const SRC = readFileSync(join(process.cwd(), 'src/lib/sam/entity-api.ts'), 'utf8');
const UTILS = readFileSync(join(process.cwd(), 'src/lib/sam/utils.ts'), 'utf8');

// Comments explain the bug and quote the patterns, so match against code only.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(SRC);

describe('SAM entity lookup: 429 fail-over', () => {
  it('retries across the OTHER keys when the rotated key is throttled', () => {
    expect(code).toContain('getAllDistinctSAMKeys()');
    expect(code).toMatch(/error\?\.status === 429/);
  });

  it('only fails over on 429 — a 400 must NOT burn every key', () => {
    // the retry loop is entered under a 429 check, never unconditionally
    const loop = code.slice(code.indexOf('429'), code.indexOf('if (result.error)'));
    expect(loop).toContain('for (const key of pool)');
    // and it stops as soon as a key is not throttled
    expect(loop).toMatch(/if \(result\.error\?\.status !== 429\) break/);
  });

  it('excludes the key that already failed from the retry pool', () => {
    expect(code).toMatch(/filter\(\(k\) => k !== config\.apiKey\)/);
  });

  it('THROWS on an exhausted quota instead of returning an empty list', () => {
    // the whole point: a 429 must never look like "this company is not in SAM"
    expect(code).toMatch(/throw new Error\('SAM entity lookup unavailable/);
  });

  it('still returns an empty result for a non-429 error (unchanged behaviour)', () => {
    const tail = code.slice(code.indexOf('if (result.error)'));
    expect(tail).toContain('entities: [],');
  });
});

describe('SAM entity cache: long TTL', () => {
  it('caches entity registrations for 30 days, not 24 hours', () => {
    // Eric: "UEI don't change that often they may expire but still". A 24h TTL threw the
    // answer away nightly and spent quota re-fetching stable registration data.
    const entityBlock = UTILS.slice(UTILS.indexOf("entity: {"), UTILS.indexOf('subaward: {'));
    expect(entityBlock).toContain('cacheTTLHours: 720');
    expect(entityBlock).not.toContain('cacheTTLHours: 24');
  });
});
