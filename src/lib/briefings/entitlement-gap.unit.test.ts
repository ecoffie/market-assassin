import { describe, it, expect } from 'vitest';
import { findEntitlementGaps, formatEntitlementGap } from './entitlement-gap';

/** Minimal Supabase stub: only the calls this module makes. */
function stub(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        in: () => Promise.resolve({ data: rows, error: null }),
      };
      // `.eq()` terminates for user_profiles (no .in() after it).
      (api as { eq: unknown }).eq = () => Promise.resolve({ data: rows, error: null });
      (api as { select: unknown }).select = () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
        in: () => Promise.resolve({ data: rows, error: null }),
      });
      return api;
    },
  } as never;
}

const PAID = (email: string, cents: number, name = 'Mindy Ai') => ({ user_email: email, amount_paid: cents, product_name: name });

describe('findEntitlementGaps — the real 2026-07-31 accounts', () => {
  it('flags a paying, active, targeted customer who is not receiving', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'lisamarshall63@yahoo.com' }],
      user_notification_settings: [
        { user_email: 'lisamarshall63@yahoo.com', briefings_enabled: false, is_active: true, naics_codes: ['541330','541611','541990'], keywords: [], total_alerts_sent: 45 },
      ],
      purchases: [PAID('lisamarshall63@yahoo.com', 600000, 'Mindy Teams — Annual')],
    }));
    expect(r.actionable).toHaveLength(1);
    expect(r.actionable[0].email).toBe('lisamarshall63@yahoo.com');
    expect(r.actionable[0].paidCents).toBe(600000);
    expect(r.actionable[0].alertsSent).toBe(45);
  });

  it('EXCLUDES an opted-out account (is_active=false) — re-enabling is a spam complaint', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'ronnie.mccoy1@gmail.com' }],
      user_notification_settings: [
        { user_email: 'ronnie.mccoy1@gmail.com', briefings_enabled: false, is_active: false, naics_codes: ['541512'], keywords: ['cyber'], total_alerts_sent: 66 },
      ],
      purchases: [PAID('ronnie.mccoy1@gmail.com', 14900)],
    }));
    expect(r.actionable).toHaveLength(0);
    expect(r.optedOut).toBe(1);
  });

  it('EXCLUDES an untargeted account — a briefing would be generic', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'jagomez55@aol.com' }],
      user_notification_settings: [
        { user_email: 'jagomez55@aol.com', briefings_enabled: false, is_active: true, naics_codes: [], keywords: [], total_alerts_sent: 0 },
      ],
      purchases: [PAID('jagomez55@aol.com', 149000)],
    }));
    expect(r.actionable).toHaveLength(0);
    expect(r.untargeted).toBe(1);
  });

  it('EXCLUDES free users — a flag off is a preference, not a bug', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'free@example.com' }],
      user_notification_settings: [
        { user_email: 'free@example.com', briefings_enabled: false, is_active: true, naics_codes: ['541512'], keywords: ['x'], total_alerts_sent: 3 },
      ],
      purchases: [],
    }));
    expect(r.actionable).toHaveLength(0);
  });

  it('EXCLUDES a $1.49 test charge (below the floor)', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'test@example.com' }],
      user_notification_settings: [
        { user_email: 'test@example.com', briefings_enabled: false, is_active: true, naics_codes: ['541512'], keywords: ['x'], total_alerts_sent: 0 },
      ],
      purchases: [PAID('test@example.com', 149)],
    }));
    expect(r.actionable).toHaveLength(0);
  });

  it('is silent when everyone entitled is enabled (the post-fix state)', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'venkat.veera@xcelligen.com' }],
      user_notification_settings: [
        { user_email: 'venkat.veera@xcelligen.com', briefings_enabled: true, is_active: true, naics_codes: ['541512'], keywords: ['cyber'], total_alerts_sent: 2 },
      ],
      purchases: [PAID('venkat.veera@xcelligen.com', 14900)],
    }));
    expect(r.actionable).toHaveLength(0);
    expect(r.totalDiverged).toBe(0);
  });

  it('ranks by largest purchase — biggest exposure first', async () => {
    const r = await findEntitlementGaps(stub({
      user_profiles: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      user_notification_settings: [
        { user_email: 'a@x.com', briefings_enabled: false, is_active: true, naics_codes: ['1'], keywords: [], total_alerts_sent: 1 },
        { user_email: 'b@x.com', briefings_enabled: false, is_active: true, naics_codes: ['2'], keywords: [], total_alerts_sent: 1 },
      ],
      purchases: [PAID('a@x.com', 14900), PAID('b@x.com', 600000)],
    }));
    expect(r.actionable.map((x) => x.email)).toEqual(['b@x.com', 'a@x.com']);
  });

  it('never throws on empty / missing data', async () => {
    const r = await findEntitlementGaps(stub({ user_profiles: [], user_notification_settings: [], purchases: [] }));
    expect(r.actionable).toEqual([]);
    expect(formatEntitlementGap([])).toBe('');
  });
});
