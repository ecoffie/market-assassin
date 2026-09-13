import { describe, expect, it } from 'vitest';
import {
  mergePrioritiesIntoAggregated,
  parseNaicsPriorities,
  prioritiesFromAggregated,
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
});
