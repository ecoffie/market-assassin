/** Rule 2 (award / J&A never open) also holds on the incumbent path's derived status (Data Core 2026-11-17). */
import { describe, it, expect } from 'vitest';
import { summarizeSolicitationIncumbent } from './solicitation-incumbent';

describe('summarizeSolicitationIncumbent status', () => {
  it('an active award notice with no deadline is not described as open', () => {
    const s = summarizeSolicitationIncumbent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { notice_id: 'n1', solicitation_number: 'X1', active: true, response_deadline: null, archive_date: null, notice_type: 'Award Notice' } as any,
      null,
    );
    expect(s).not.toMatch(/Open solicitation/);
    expect(s).toMatch(/Closed solicitation/);
  });
});
