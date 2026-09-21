import { describe, it, expect } from 'vitest';
import { PAID_LEDGER_REASONS } from './extraction-guard';

describe('MCP extraction guard — paid ledger reasons', () => {
  it('recognizes app-tier Pro/Team grants (Path A checkout writes these, not pro_monthly)', () => {
    expect(PAID_LEDGER_REASONS).toContain('app_tier_pro');
    expect(PAID_LEDGER_REASONS).toContain('app_tier_team');
    expect(PAID_LEDGER_REASONS).toContain('stripe_topup');
    expect(PAID_LEDGER_REASONS).toContain('pro_monthly');
    expect(PAID_LEDGER_REASONS).toContain('admin_grant');
  });
});
