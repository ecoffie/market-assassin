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

  // Exact measured contamination: Navy N40084 notices carry @state.gov POCs
  // (Kannikar Pakhunthot / May Dayday). Email-as-verdict labeled them State.
  it('@state.gov on a Navy N40084 solicitation is conflict, not State Department', () => {
    const r = deriveSubAgencyEvidence('kannikar@state.gov', 'N4008426T4505');
    expect(r.from_email).toBe('State Department');
    expect(r.from_prefix).toBe('Navy');
    expect(r.evidence).toBe('conflict');
    expect(r.uncertain).toBe(true);
    expect(r.label).toBe('Navy');
    expect(deriveSubAgency('kannikar@state.gov', 'N4008426T4505')).toBe('Navy');
  });

  it('@uscg.mil on a Navy solicitation is conflict, not Coast Guard', () => {
    const r = deriveSubAgencyEvidence('jane.doe@uscg.mil', 'N0017426R1003');
    expect(r.from_email).toBe('Coast Guard');
    expect(r.from_prefix).toBe('Navy');
    expect(r.evidence).toBe('conflict');
    expect(r.uncertain).toBe(true);
    expect(r.label).toBe('Navy');
    expect(deriveSubAgency('jane.doe@uscg.mil', 'N0017426R1003')).toBe('Navy');
  });

  it('a real Coast Guard 70Z solicitation + @uscg.mil agrees — not Navy', () => {
    const r = deriveSubAgencyEvidence('william.e.lewis3@uscg.mil', '70Z02326R93280004');
    expect(r.from_email).toBe('Coast Guard');
    expect(r.from_prefix).toBe('Coast Guard');
    expect(r.evidence).toBe('both_agree');
    expect(r.uncertain).toBe(false);
    expect(r.label).toBe('Coast Guard');
  });
});
