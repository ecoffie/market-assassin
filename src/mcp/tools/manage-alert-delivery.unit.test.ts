import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

const requestEmailLink = vi.fn();
const assertSelectableDeliveryEmail = vi.fn();
const listDeliveryEmailCandidates = vi.fn();
const getAlertDeliverySettings = vi.fn();
const setAlertDeliveryEmail = vi.fn();
const resolveAlertDeliveryEmail = vi.fn();
const alertDestinationKind = vi.fn();

vi.mock('@/lib/mindy/linked-emails', () => ({
  requestEmailLink: (...args: unknown[]) => requestEmailLink(...args),
}));

vi.mock('@/lib/mindy/alert-delivery', () => ({
  assertSelectableDeliveryEmail: (...args: unknown[]) => assertSelectableDeliveryEmail(...args),
  listDeliveryEmailCandidates: (...args: unknown[]) => listDeliveryEmailCandidates(...args),
  getAlertDeliverySettings: (...args: unknown[]) => getAlertDeliverySettings(...args),
  setAlertDeliveryEmail: (...args: unknown[]) => setAlertDeliveryEmail(...args),
  resolveAlertDeliveryEmail: (...args: unknown[]) => resolveAlertDeliveryEmail(...args),
  alertDestinationKind: (...args: unknown[]) => alertDestinationKind(...args),
}));

import { manageAlertDelivery } from './manage-alert-delivery';

describe('manageAlertDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDeliveryEmailCandidates.mockResolvedValue({
      account_email: 'cassy@ex.com',
      linked: [{ email: 'cheneault@excellri.com', verified_at: '2026-09-14T00:00:00Z' }],
      pending: [],
    });
    getAlertDeliverySettings.mockResolvedValue({ alert_recipient_email: null });
    resolveAlertDeliveryEmail.mockImplementation(
      (owner: string, s: { alert_recipient_email?: string | null } | null) =>
        (s?.alert_recipient_email || owner).toLowerCase(),
    );
    alertDestinationKind.mockImplementation(
      (owner: string, s: { alert_recipient_email?: string | null } | null) =>
        s?.alert_recipient_email && s.alert_recipient_email !== owner
          ? 'delivery_email'
          : 'account_email',
    );
  });

  it('list returns status without mutating', async () => {
    const r = await manageAlertDelivery({ userEmail: 'cassy@ex.com', action: 'list' });
    expect(r._meta.changed).toBe(false);
    expect(r.linked[0].email).toBe('cheneault@excellri.com');
    expect(setAlertDeliveryEmail).not.toHaveBeenCalled();
  });

  it('request_verify starts OTP and does not select', async () => {
    requestEmailLink.mockResolvedValue({ ok: true });
    const r = await manageAlertDelivery({
      userEmail: 'cassy@ex.com',
      action: 'request_verify',
      email: 'cheneault@excellri.com',
    });
    expect(requestEmailLink).toHaveBeenCalledWith('cassy@ex.com', 'cheneault@excellri.com');
    expect(setAlertDeliveryEmail).not.toHaveBeenCalled();
    expect(r._meta.changed).toBe(true);
    expect(r.message).toMatch(/Verification code sent/i);
  });

  it('set rejects unverified addresses', async () => {
    assertSelectableDeliveryEmail.mockResolvedValue({ ok: false, reason: 'unverified' });
    const r = await manageAlertDelivery({
      userEmail: 'cassy@ex.com',
      action: 'set',
      email: 'cheneault@excellri.com',
    });
    expect(r._meta.grounded).toBe(false);
    expect(setAlertDeliveryEmail).not.toHaveBeenCalled();
    expect(r.message).toMatch(/Verify/i);
  });

  it('set persists a verified linked address', async () => {
    assertSelectableDeliveryEmail.mockResolvedValue({ ok: true, reason: 'verified_linked' });
    setAlertDeliveryEmail.mockResolvedValue({ ok: true });
    getAlertDeliverySettings.mockResolvedValue({
      alert_recipient_email: 'cheneault@excellri.com',
    });
    const r = await manageAlertDelivery({
      userEmail: 'cassy@ex.com',
      action: 'set',
      email: 'cheneault@excellri.com',
    });
    expect(setAlertDeliveryEmail).toHaveBeenCalledWith('cassy@ex.com', 'cheneault@excellri.com');
    expect(r._meta.changed).toBe(true);
    expect(r.selected).toBe('cheneault@excellri.com');
  });

  it('clear restores account email', async () => {
    setAlertDeliveryEmail.mockResolvedValue({ ok: true });
    const r = await manageAlertDelivery({ userEmail: 'cassy@ex.com', action: 'clear' });
    expect(setAlertDeliveryEmail).toHaveBeenCalledWith('cassy@ex.com', null);
    expect(r._meta.changed).toBe(true);
  });
});
