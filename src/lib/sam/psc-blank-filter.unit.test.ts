/**
 * Behavior tests for blank PSC filtering at the SAM transform boundary.
 */
import { describe, expect, it } from 'vitest';
import { filterBlankPscList } from '@/lib/contractor/award-history-shape';

// Mirror the transformEntity filter contract without hitting SAM.
describe('SAM pscList blank-record contract', () => {
  it('turns a sole blank PSC object into an empty array', () => {
    expect(filterBlankPscList([{ pscCode: '', pscDescription: '' }])).toEqual([]);
  });

  it('keeps real PSC rows', () => {
    expect(
      filterBlankPscList([
        { pscCode: '', pscDescription: '' },
        { pscCode: 'D307', pscDescription: 'IT AND TELECOM' },
      ]),
    ).toEqual([{ pscCode: 'D307', pscDescription: 'IT AND TELECOM' }]);
  });
});
