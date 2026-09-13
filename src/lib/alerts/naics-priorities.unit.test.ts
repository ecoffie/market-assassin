import { describe, expect, it } from 'vitest';
import {
  mergePrioritiesIntoAggregated,
  parseNaicsPriorities,
  prioritiesFromAggregated,
  validateNaicsPrioritiesInput,
} from './naics-priorities';

describe('naics priorities persist', () => {
  it('keeps only exact six-digit primary/secondary roles', () => {
    expect(
      parseNaicsPriorities({
        '541511': 'primary',
        '541611': 'secondary',
        '541': 'primary',
        junk: 'primary',
        '238350': 'maybe',
      }),
    ).toEqual({ '541511': 'primary', '541611': 'secondary' });
  });

  it('reads from aggregated_profile without a new column', () => {
    expect(
      prioritiesFromAggregated({ naics_priorities: { '561720': 'primary' }, keywords: ['x'] }),
    ).toEqual({ '561720': 'primary' });
  });

  it('drops roles for codes no longer stored', () => {
    const next = mergePrioritiesIntoAggregated(
      { naics_priorities: { '541511': 'primary', '541611': 'secondary' } },
      { '541511': 'primary', '541611': 'secondary' },
      ['541511'],
    );
    expect(next.naics_priorities).toEqual({ '541511': 'primary' });
  });

  it('rejects malformed and non-stored codes at the persist boundary', () => {
    expect(validateNaicsPrioritiesInput('junk', ['541511'])).toEqual({
      ok: false,
      error: 'naicsPriorities must be an object keyed by exact six-digit NAICS',
    });
    expect(validateNaicsPrioritiesInput({ notacode: 'primary' }, ['541511'])).toEqual({
      ok: false,
      error: 'Invalid NAICS code "notacode". Use an exact six-digit code.',
    });
    expect(validateNaicsPrioritiesInput({ '541511': 'maybe' }, ['541511'])).toEqual({
      ok: false,
      error: 'Invalid role for 541511. Use primary or secondary.',
    });
    expect(validateNaicsPrioritiesInput({ '238350': 'primary' }, ['541511'])).toEqual({
      ok: false,
      error: 'NAICS 238350 is not on this profile.',
    });
    expect(validateNaicsPrioritiesInput({ '541511': 'primary' }, ['541511'])).toEqual({
      ok: true,
      priorities: { '541511': 'primary' },
    });
  });
});
