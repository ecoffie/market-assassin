import { describe, expect, it } from 'vitest';
import { deriveRegistrationStatus, isRegistrationActive } from './registration-status';

const NOW = new Date('2026-11-18T12:00:00.000Z');

describe('deriveRegistrationStatus', () => {
  it('Active + past expiry is Expired (the 157k contradiction class)', () => {
    expect(deriveRegistrationStatus('Active', '2026-01-01', NOW)).toBe('Expired');
    expect(isRegistrationActive('Active', '2026-01-01', NOW)).toBe(false);
  });

  it('Active + future expiry stays Active', () => {
    expect(deriveRegistrationStatus('Active', '2027-06-29', NOW)).toBe('Active');
    expect(isRegistrationActive('Active', '2027-06-29', NOW)).toBe(true);
  });

  it('expiry on the calendar day of now is still Active through end of day UTC', () => {
    expect(deriveRegistrationStatus('Active', '2026-11-18', NOW)).toBe('Active');
  });

  it('missing status does not become Active', () => {
    expect(deriveRegistrationStatus(null, '2027-01-01', NOW)).toBe('Unknown');
    expect(deriveRegistrationStatus(null, null, NOW)).toBe('Unknown');
  });

  it('stored Expired is kept when expiry is absent', () => {
    expect(deriveRegistrationStatus('Expired', null, NOW)).toBe('Expired');
  });
});
