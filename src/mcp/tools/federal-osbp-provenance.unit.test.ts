import { describe, it, expect } from 'vitest';
import { lookupFederalOsbp } from './federal-osbp';

/**
 * A named human's stale email is the highest-consequence staleness in the repo:
 * the customer emails someone who left, and the failure is silent and
 * reputational.
 *
 * Measured 2026-08-16: 121 of 169 commands carry no verification stamp. The
 * caveat explaining that ("treat the name as an unverified role-title, lead with
 * the office mailbox") existed ONLY inside `_ai_hint`, which is OFF by default in
 * production — so the common case shipped a name with no signal attached.
 */
describe('OSBP contact provenance is always in the payload', () => {
  it('every returned office carries an explicit director_status', () => {
    const r = lookupFederalOsbp({ agency: 'Navy' });
    const offices = [...(r.office ? [r.office] : []), ...r.related_offices];
    expect(offices.length).toBeGreaterThan(0);
    for (const o of offices) {
      expect(['verified', 'unverified', 'none']).toContain(o.director_status);
      // A name with no stamp must say so — never look like a checked one.
      if (o.osbp_director && !o.director_verified) expect(o.director_status).toBe('unverified');
      if (!o.osbp_director) expect(o.director_status).toBe('none');
    }
  });

  it('_meta reports the SPLIT, not just "any verified"', () => {
    // Air Force returns 15 offices with only 3 verified. The old boolean read
    // `true` and hid that 12 names were unchecked.
    const r = lookupFederalOsbp({ agency: 'Air Force' });
    const total = (r.office ? 1 : 0) + r.related_offices.length;
    expect(r._meta.directors_verified + r._meta.directors_unverified).toBeLessThanOrEqual(total);
    expect(r._meta.directors_unverified).toBeGreaterThan(0);
    // The boolean alone would have implied the whole set was checked.
    expect(r._meta.director_verified).toBe(true);
  });

  it('an unmatched agency reports zero of both rather than a misleading default', () => {
    const r = lookupFederalOsbp({ agency: 'Department of Nonexistent Things' });
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.directors_verified).toBe(0);
    expect(r._meta.directors_unverified).toBe(0);
  });
});
