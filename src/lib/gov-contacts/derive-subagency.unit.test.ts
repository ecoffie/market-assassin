import { describe, it, expect } from 'vitest';
import { deriveSubAgency, deriveSubAgencyEvidence } from './derive-subagency';

describe('cross-agency contacts — email domain is not a verdict', () => {
  it('a @dla.mil mailbox on a Navy solicitation is a CONFLICT, not a DLA contact', () => {
    const r = deriveSubAgencyEvidence('jane.doe@dla.mil', 'N0017426R1003');
    expect(r.from_email).toBe('Defense Logistics Agency');
    expect(r.from_prefix).toBe('Navy');
    expect(r.evidence).toBe('conflict');
    expect(r.uncertain).toBe(true);
    // Display follows the NOTICE (solicitation prefix), not the mailbox.
    expect(r.label).toBe('Navy');
    expect(deriveSubAgency('jane.doe@dla.mil', 'N0017426R1003')).toBe('Navy');
  });

  it('email domain ALONE is uncertain — never treated as proven agency membership', () => {
    const r = deriveSubAgencyEvidence('ko@navy.mil', null);
    expect(r.label).toBe('Navy');
    expect(r.evidence).toBe('email_domain');
    expect(r.uncertain).toBe(true);
  });

  it('solicitation prefix alone is source evidence, not a guess', () => {
    const r = deriveSubAgencyEvidence(null, 'W912PL26R0001');
    expect(r.label).toBe('Army');
    expect(r.evidence).toBe('solicitation_prefix');
    expect(r.uncertain).toBe(false);
  });

  it('agreeing signals are not uncertain', () => {
    const r = deriveSubAgencyEvidence('pat@navy.mil', 'N0002426C0001');
    expect(r.evidence).toBe('both_agree');
    expect(r.uncertain).toBe(false);
    expect(r.label).toBe('Navy');
  });
});
