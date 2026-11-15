import { describe, it, expect } from 'vitest';
import { overclaimsIncumbentAbsence } from './absence-wording';
import { incumbentFinding, INCUMBENT_ABSENCE_NOTES } from '@/lib/usaspending/solicitation-incumbent';

describe('overclaimsIncumbentAbsence', () => {
  it('flags the 2026-11-15 production sentence', () => {
    expect(overclaimsIncumbentAbsence('There are no prior awards reported for this solicitation, so it appears there is no incumbent at this time.')).toBe(true);
  });
  it.each([
    'There is no incumbent on this contract.',
    "There's no current incumbent.",
    'It seems there is no incumbent.',
    'No one currently holds this contract.',
    'This solicitation does not have an incumbent.',
    'This is a new requirement.',
    'It looks like a brand-new procurement.',
    'The work will be awarded without an incumbent.',
  ])('flags: %s', (s) => expect(overclaimsIncumbentAbsence(s)).toBe(true));
  it.each([
    "I couldn't identify an incumbent for this solicitation.",
    'No incumbent was found in USASpending for this solicitation number.',
    'There is no incumbent listed in the award records I searched.',
    'No incumbent could be confirmed: the closest prior award does not match the scope.',
    'Mindy could not identify an incumbent. The work may be new, or the prior contract may be recorded under another number.',
    'The incumbent is Acme Facility Services (70Z08724C0001).',
  ])('allows: %s', (s) => expect(overclaimsIncumbentAbsence(s)).toBe(false));
});

describe('incumbentFinding (always-on _meta for MCP and chat)', () => {
  it('maps lookup outcomes', () => {
    expect(incumbentFinding({ noticeFound: true, degraded: false, grounded: true, candidate: true })).toBe('identified');
    expect(incumbentFinding({ noticeFound: true, degraded: false, grounded: false, candidate: true })).toBe('candidate_not_confirmed');
    expect(incumbentFinding({ noticeFound: true, degraded: false, grounded: false, candidate: false })).toBe('not_found');
    expect(incumbentFinding({ noticeFound: true, degraded: true, grounded: false, candidate: false })).toBe('search_failed');
    expect(incumbentFinding({ noticeFound: false, degraded: true, grounded: false, candidate: false })).toBe('search_failed');
    expect(incumbentFinding({ noticeFound: false, degraded: false, grounded: false, candidate: false })).toBe('notice_not_found');
  });
  it('every non-identified finding has a note that forbids claiming absence', () => {
    for (const note of Object.values(INCUMBENT_ABSENCE_NOTES)) expect(note).toMatch(/never say there is no incumbent|do not say there is no incumbent/i);
    expect(INCUMBENT_ABSENCE_NOTES.not_found).toMatch(/not proof there is no incumbent/);
    // A note itself must not read as an absence claim.
    for (const note of Object.values(INCUMBENT_ABSENCE_NOTES)) expect(overclaimsIncumbentAbsence(note.replace(/never say there is no incumbent|do not say there is no incumbent|not proof there is no incumbent/gi, ''))).toBe(false);
  });
});
