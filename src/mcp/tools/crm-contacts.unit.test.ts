import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCrmConnection = vi.fn();
const upsertContactsBatch = vi.fn();
vi.mock('@/lib/crm/connections', () => ({ getCrmConnection: (...a: unknown[]) => getCrmConnection(...a) }));
vi.mock('@/lib/ghl/contacts', async () => ({
  CONTACT_INVALID_ERROR: 'contact needs an email or a valid phone',
  upsertContactsBatch: (...a: unknown[]) => upsertContactsBatch(...a),
}));

import { addContactsToCrm } from './crm-contacts';
import { classifyBillingOutcome, isBillable } from '@/lib/mcp/credit-integrity';

const conn = { token: 't', locationId: 'L', provider: 'ghl' };

beforeEach(() => {
  getCrmConnection.mockReset();
  upsertContactsBatch.mockReset();
});

describe('add_contacts_to_crm — no-op billing', () => {
  it('not connected → not billable, never calls GHL', async () => {
    getCrmConnection.mockResolvedValue(null);
    const r = await addContactsToCrm({ userEmail: 'u@x.com', contacts: [{ email: 'a@b.com' }] });
    expect(r.connected).toBe(false);
    expect(r._meta.billing_outcome).toBe('nonbillable_not_configured');
    expect(isBillable(classifyBillingOutcome(r))).toBe(false);
    expect(upsertContactsBatch).not.toHaveBeenCalled();
  });

  it('empty contact list → not billable', async () => {
    getCrmConnection.mockResolvedValue(conn);
    upsertContactsBatch.mockResolvedValue({ created: 0, updated: 0, failed: 0, degraded: false, rows: [] });
    const r = await addContactsToCrm({ userEmail: 'u@x.com', contacts: [] });
    expect(r._meta.billing_outcome).toBe('nonbillable_invalid_input');
    expect(isBillable(classifyBillingOutcome(r))).toBe(false);
  });

  it('every row rejected locally (no email/phone) → not billable', async () => {
    getCrmConnection.mockResolvedValue(conn);
    upsertContactsBatch.mockResolvedValue({
      created: 0, updated: 0, failed: 2, degraded: false,
      rows: [
        { input: {}, status: 'failed', error: 'contact needs an email or a valid phone' },
        { input: {}, status: 'failed', error: 'contact needs an email or a valid phone' },
      ],
    });
    const r = await addContactsToCrm({ userEmail: 'u@x.com', contacts: [{}, {}] });
    expect(isBillable(classifyBillingOutcome(r))).toBe(false);
  });

  it('a real write is still billable', async () => {
    getCrmConnection.mockResolvedValue(conn);
    upsertContactsBatch.mockResolvedValue({
      created: 1, updated: 0, failed: 0, degraded: false,
      rows: [{ input: { email: 'a@b.com' }, status: 'created', id: 'c1' }],
    });
    const r = await addContactsToCrm({ userEmail: 'u@x.com', contacts: [{ email: 'a@b.com' }] });
    expect(r._meta.billing_outcome).toBeUndefined();
    expect(classifyBillingOutcome(r)).toBe('billable_success');
  });
});
