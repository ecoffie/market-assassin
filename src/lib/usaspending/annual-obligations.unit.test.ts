import { describe, it, expect } from 'vitest';
import { classifyObligationAmount } from './annual-obligations';

describe('annual obligations — unavailable is not $0', () => {
  it('a degraded USASpending call reports UNAVAILABLE with a null total', () => {
    const r = classifyObligationAmount({ degraded: true, resolved: true, total: 0 });
    expect(r.amount_status).toBe('unavailable');
    expect(r.total).toBeNull();
  });

  it('a resolved recipient with no prime dollars is a measured ZERO, not missing data', () => {
    const r = classifyObligationAmount({ degraded: false, resolved: true, total: 0 });
    expect(r.amount_status).toBe('zero');
    expect(r.total).toBe(0);
  });

  it('an unmatched name is unresolved — not $0 federal awards', () => {
    const r = classifyObligationAmount({ degraded: false, resolved: false, total: 0 });
    expect(r.amount_status).toBe('unresolved');
    expect(r.total).toBeNull();
  });

  it('positive dollars stay positive', () => {
    const r = classifyObligationAmount({ degraded: false, resolved: true, total: 20_200_000 });
    expect(r.amount_status).toBe('positive');
    expect(r.total).toBe(20_200_000);
  });
});
