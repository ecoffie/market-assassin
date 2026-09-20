import { describe, it, expect } from 'vitest';
import { spendingDetailGrounded } from './agency-spending-detail';
import type { AgencySpendingDetailResult } from '@/lib/usaspending/agency-spending-detail';

function base(): AgencySpendingDetailResult {
  return {
    agency: 'Naval Sea Systems Command',
    toptier_code: '097',
    fiscal_year: 2025,
    window: { start_date: '2024-10-01', end_date: '2025-09-30' },
    total_obligated: null,
    sub_agencies: [],
    set_aside_breakdown: [],
    small_business_share: null,
    requested_identity: {
      command: 'NAVSEA',
      service: 'Department of the Navy',
      parent: 'Department of Defense',
    },
    spending: {
      scope: 'PARENT_SERVICE',
      scope_name: 'Department of the Navy',
      total: 176_557_193_879,
    },
    command_spending: { status: 'NOT_ESTABLISHED' },
    degraded: false,
    trace: [],
  };
}

describe('spendingDetailGrounded — NAVSEA grain', () => {
  it('grounds parent-service dollars without treating them as NAVSEA total_obligated', () => {
    const res = base();
    expect(spendingDetailGrounded(res)).toBe(true);
    expect(res.total_obligated).toBeNull();
    expect(res.agency).toBe('Naval Sea Systems Command');
    expect(res.spending.total).toBe(176_557_193_879);
  });

  it('does not ground parent-service dollars when the total is missing', () => {
    const res = base();
    res.spending = { ...res.spending, total: null };
    expect(spendingDetailGrounded(res)).toBe(false);
  });

  it('does not ground an unknown agency', () => {
    const res = base();
    res.agency = null;
    res.requested_identity = { command: null, service: null, parent: null };
    res.spending = { scope: 'NOT_ESTABLISHED', scope_name: null, total: null };
    res.command_spending = { status: 'NOT_APPLICABLE' };
    expect(spendingDetailGrounded(res)).toBe(false);
  });
});
