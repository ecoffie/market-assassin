import { describe, it, expect } from 'vitest';
import {
  getIntegrityStatusBlock,
  getMeasurementIntegrity,
  CLAIM_LEDGER,
  CLAIM_ROUTES_UNVERIFIED,
} from './measurement-integrity';

/**
 * THE STATUS BLOCK MUST NOT BECOME THE BUG IT REPORTS ON.
 *
 * Eric asked for a permanent at-a-glance block so a future session can tell in one look
 * whether the measurement system is still trustworthy. That creates a new hazard: a
 * summary widget is exactly the kind of thing that keeps printing a confident number
 * after the thing underneath it stopped being true.
 *
 * These tests pin the two properties that keep it honest:
 *   1. `lastAudit` is DERIVED from the ledger, never hardcoded.
 *   2. an unreadable gate baseline renders `unknown`, never a plausible number.
 * Plus the complacency guard: adding an unverified claim route must visibly break 10/10.
 */

describe('the status block reports what Eric asked to see', () => {
  it('renders the exact six lines', () => {
    const lines = getIntegrityStatusBlock(118).lines;
    expect(lines[0]).toBe('Decision Metrics Integrity');
    expect(lines[1]).toMatch(/^ {2}Claim-producing routes: \d+\/\d+ verified$/);
    expect(lines[2]).toMatch(/^ {2}Unverified claim routes: \d+$/);
    expect(lines[3]).toMatch(/^ {2}Operational risks: \d+$/);
    expect(lines[4]).toMatch(/^ {2}Known truncation findings: /);
    expect(lines[5]).toMatch(/^ {2}Last integrity audit: /);
  });

  it('agrees with the ledger it summarises', () => {
    const s = getMeasurementIntegrity();
    const b = getIntegrityStatusBlock(118);
    expect(b.claimRoutes).toBe(`${s.verified}/${s.total} verified`);
    expect(b.unverifiedClaimRoutes).toBe(s.unverified.length);
    expect(b.operationalRisks).toBe(s.operationalRisks);
  });
});

describe('rule 1 — the audit date is derived, never typed', () => {
  it('equals the newest verifiedOn in the ledger', () => {
    const newest = CLAIM_LEDGER.map(c => c.verifiedOn)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop();
    expect(getIntegrityStatusBlock(118).lastAudit).toBe(newest);
  });

  it('is a real ISO date, so a stale hand-typed string is visible', () => {
    expect(getIntegrityStatusBlock(118).lastAudit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('rule 2 — never print a number we did not measure', () => {
  it('renders unknown when the gate baseline is unreadable (-1)', () => {
    const b = getIntegrityStatusBlock(-1);
    expect(b.knownTruncationFindings).toBe('unknown');
    expect(b.lines[4]).toBe('  Known truncation findings: unknown');
  });

  it('passes a real count straight through', () => {
    expect(getIntegrityStatusBlock(118).knownTruncationFindings).toBe(118);
  });
});

describe('the complacency guard — verified is EARNED, not permanent', () => {
  it('is all-verified only while nothing sits unverified', () => {
    const b = getIntegrityStatusBlock(118);
    expect(b.allClaimsVerified).toBe(CLAIM_ROUTES_UNVERIFIED.length === 0);
  });

  it('every ledger entry marked verified passed ALL FOUR checks', () => {
    // Pagination alone is not verification — feature-usage failed 3 of 4 and would
    // have passed a pagination-only review while reporting zero for every feature.
    for (const c of CLAIM_LEDGER.filter(c => c.status === 'verified')) {
      expect(new Set(c.passed), `${c.route} is marked verified`).toEqual(
        new Set(['runs', 'complete', 'current', 'honest']),
      );
      expect(c.verifiedOn, `${c.route} needs a verification date`).toBeTruthy();
    }
  });
});
