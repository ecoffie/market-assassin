/**
 * Alert delivery — login email ≠ alert inbox.
 * Cassy wants alerts at work@ without re-keying the account.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { linked_email: string; verified_at: string | null; owner_email?: string };

let linkedRows: Row[] = [];
let queryError: { code?: string; message: string } | null = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const state: { owner?: string; linked?: string } = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        ilike: (col: string, val: string) => {
          if (col === 'owner_email') state.owner = val.toLowerCase();
          if (col === 'linked_email') state.linked = val.toLowerCase();
          return builder;
        },
        maybeSingle: async () => {
          if (queryError) return { data: null, error: queryError };
          const hit = linkedRows.find(
            (r) =>
              (!state.owner || r.owner_email === state.owner || !r.owner_email) &&
              (!state.linked || r.linked_email.toLowerCase() === state.linked),
          );
          return { data: hit || null, error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/mindy/linked-emails', () => ({
  normalizeEmail: (email: string) => (email || '').toLowerCase().trim(),
}));

import {
  resolveAlertDeliveryEmail,
  alertDestinationKind,
  assertSelectableDeliveryEmail,
} from './alert-delivery';

describe('resolveAlertDeliveryEmail', () => {
  it('falls back to owner when recipient is null/empty', () => {
    expect(resolveAlertDeliveryEmail('Cassy@Ex.com', null)).toBe('cassy@ex.com');
    expect(resolveAlertDeliveryEmail('cassy@ex.com', {})).toBe('cassy@ex.com');
    expect(resolveAlertDeliveryEmail('cassy@ex.com', { alert_recipient_email: null })).toBe(
      'cassy@ex.com',
    );
    expect(resolveAlertDeliveryEmail('cassy@ex.com', { alert_recipient_email: '  ' })).toBe(
      'cassy@ex.com',
    );
  });

  it('uses the selected delivery address when set', () => {
    expect(
      resolveAlertDeliveryEmail('cassy@ex.com', {
        alert_recipient_email: 'Cheneault@Excellri.com',
      }),
    ).toBe('cheneault@excellri.com');
  });
});

describe('alertDestinationKind', () => {
  it('reports account_email when unset or same as owner', () => {
    expect(alertDestinationKind('a@b.com', null)).toBe('account_email');
    expect(alertDestinationKind('a@b.com', { alert_recipient_email: 'a@b.com' })).toBe(
      'account_email',
    );
  });

  it('reports delivery_email when a different address is selected', () => {
    expect(
      alertDestinationKind('a@b.com', { alert_recipient_email: 'work@co.com' }),
    ).toBe('delivery_email');
  });
});

describe('assertSelectableDeliveryEmail', () => {
  beforeEach(() => {
    linkedRows = [];
    queryError = null;
  });

  it('allows the account email itself', async () => {
    const r = await assertSelectableDeliveryEmail('cassy@ex.com', 'Cassy@Ex.com');
    expect(r).toEqual({ ok: true, reason: 'account' });
  });

  it('rejects empty candidate (clear is a separate action)', async () => {
    const r = await assertSelectableDeliveryEmail('cassy@ex.com', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });

  it('allows a verified linked address', async () => {
    linkedRows = [
      {
        owner_email: 'cassy@ex.com',
        linked_email: 'cheneault@excellri.com',
        verified_at: '2026-09-14T00:00:00Z',
      },
    ];
    const r = await assertSelectableDeliveryEmail(
      'cassy@ex.com',
      'cheneault@excellri.com',
    );
    expect(r).toEqual({ ok: true, reason: 'verified_linked' });
  });

  it('rejects an unverified (pending) link', async () => {
    linkedRows = [
      {
        owner_email: 'cassy@ex.com',
        linked_email: 'cheneault@excellri.com',
        verified_at: null,
      },
    ];
    const r = await assertSelectableDeliveryEmail(
      'cassy@ex.com',
      'cheneault@excellri.com',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unverified');
  });

  it('rejects a random address with no link row', async () => {
    const r = await assertSelectableDeliveryEmail('cassy@ex.com', 'stranger@x.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('foreign');
  });
});
