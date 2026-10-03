import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { blockedOutcome, classifyCallOutcome, errorOutcome } from './call-outcome';
import { classifyBillingOutcome, errorCodeBillingOutcome } from './credit-integrity';

describe('classifyCallOutcome — structured fields only', () => {
  it('maps every outcome class', () => {
    expect(classifyCallOutcome({ _meta: { grounded: true, degraded: false } }).outcome).toBe('grounded');
    // Partial data with a degraded dependency is still grounded; the degraded column keeps the flag.
    expect(classifyCallOutcome({ _meta: { grounded: true, degraded: true } })).toMatchObject({ outcome: 'grounded', degraded: true });
    expect(classifyCallOutcome({ _meta: { grounded: false, degraded: false } }).outcome).toBe('no_result');
    expect(classifyCallOutcome({ _meta: { grounded: false, degraded: true } }).outcome).toBe('degraded');
    expect(classifyCallOutcome({ ok: false, error: 'naics_required' }).outcome).toBe('refused');
    expect(classifyCallOutcome({ count: 3, items: [1, 2, 3] }).outcome).toBe('grounded');
    expect(classifyCallOutcome({ count: 0, items: [] }).outcome).toBe('no_result');
    expect(classifyCallOutcome({ anything: true }).outcome).toBe('unclassified');
    expect(classifyCallOutcome(null).outcome).toBe('unclassified');
    expect(errorOutcome()).toMatchObject({ outcome: 'error', errorCode: 'tool_exception' });
    expect(blockedOutcome('insufficient_credits')).toMatchObject({ outcome: 'blocked', errorCode: 'insufficient_credits' });
  });

  it('never stores prose or user input as error_code', () => {
    expect(classifyCallOutcome({ ok: false, error: 'The user typed: cyber stuff in Florida' }).errorCode).toBeNull();
    expect(classifyCallOutcome({ ok: false, error: 'unknown_tool:some_requested_name' }).errorCode).toBe('unknown_tool');
    expect(blockedOutcome('x'.repeat(200)).errorCode).toBeNull();
  });

  it('a tool-declared measurement failure wins over grounded', () => {
    // market-report: grounded on optional sections while the REQUIRED measurement failed.
    const t = classifyCallOutcome({ _meta: { grounded: true, billing_outcome: 'nonbillable_system_failure' } });
    expect(t).toMatchObject({ outcome: 'degraded', billingOutcome: 'nonbillable_system_failure' });
  });
});

describe('credit integrity — the full inventory of tier-1/tier-2 refusal codes', () => {
  /**
   * Read the codes straight from the source so a NEW `ok: false` code cannot ship
   * unclassified. Every one of them must be non-billable.
   */
  const src = ['src/lib/chat/tier1-tools.ts', 'src/lib/chat/tier2-tools.ts']
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  const codes = [...new Set([...src.matchAll(/ok:\s*false,[^}]*?error:\s*'([a-z_]+)'/gs)].map((m) => m[1]))];

  it('found the refusal codes', () => {
    expect(codes.length).toBeGreaterThanOrEqual(6);
  });

  const EXPECTED: Record<string, string> = {
    keyword_required: 'nonbillable_invalid_input',
    naics_required: 'nonbillable_invalid_input',
    company_name_required: 'nonbillable_invalid_input',
    naics_or_psc_required: 'nonbillable_invalid_input',
    unknown_set_aside: 'nonbillable_invalid_input',
    sam_unavailable: 'nonbillable_system_failure',
    rate_limited: 'nonbillable_system_failure',
    lookup_failed: 'nonbillable_system_failure',
  };

  it('every code in the source is classified and none is billable', () => {
    for (const code of codes) {
      expect(EXPECTED[code], `new refusal code "${code}" — add it to EXPECTED`).toBeDefined();
      expect(errorCodeBillingOutcome(code)).toBe(EXPECTED[code]);
      expect(classifyBillingOutcome({ ok: false, error: code })).toBe(EXPECTED[code]);
    }
  });

  it('an ok:true result with an error-looking field is still billable', () => {
    expect(classifyBillingOutcome({ ok: true, error: 'keyword_required', count: 2 })).toBe('billable_success');
  });
});
