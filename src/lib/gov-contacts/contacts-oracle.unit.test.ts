/**
 * The contacts oracle must never turn a degraded roster into "0 people".
 * (Measured 2026-09-23: W912PL has 182 rows; a statement timeout printed "0 people".)
 */
import { describe, it, expect } from 'vitest';
import { classifyContactsRoster } from './contacts-oracle';

describe('classifyContactsRoster', () => {
  it('degraded → UNMEASURED with the error trace, never a count of 0', () => {
    const v = classifyContactsRoster({
      contacts: [],
      degraded: true,
      trace: ['query error: canceling statement due to statement timeout'],
    });
    expect(v.status).toBe('unmeasured');
    expect(v.detail).toContain('statement timeout');
    expect(v.detail).not.toMatch(/\b0 people\b/);
  });

  it('no result at all → UNMEASURED', () => {
    expect(classifyContactsRoster(null).status).toBe('unmeasured');
  });

  it('a genuine, non-degraded empty roster is a FAIL (measured and wrong), not unmeasured', () => {
    const v = classifyContactsRoster({ contacts: [], degraded: false, trace: [] });
    expect(v.status).toBe('fail');
    expect(v.detail).toContain('0 people');
  });

  it('a real district roster passes', () => {
    const v = classifyContactsRoster({
      degraded: false,
      contacts: [
        { contact_email: 'a@usace.army.mil' },
        { contact_email: 'b@usace.army.mil' },
        { contact_email: 'c@usace.army.mil' },
      ],
    });
    expect(v.status).toBe('pass');
  });

  it('a dept-wide DoD fallback fails', () => {
    const v = classifyContactsRoster({
      degraded: false,
      contacts: [
        { contact_email: 'a@usace.army.mil' },
        { contact_email: 'b@usace.army.mil' },
        { contact_email: 'osd.osbp@mail.mil' },
      ],
    });
    expect(v.status).toBe('fail');
  });
});
