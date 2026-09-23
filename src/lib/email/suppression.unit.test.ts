import { describe, it, expect } from 'vitest';
import {
  applyDeliveryEvent,
  classifyDeliveryEvent,
  evaluateTransientHistory,
  HEALTHCHECK_ADDRESS_RE,
  normalizeRecipient,
  TRANSIENT_MIN_BOUNCES,
  type DeliveryEventInput,
  type HistoryEvent,
  type SuppressionRecord,
  type SuppressionStore,
} from './suppression';

/**
 * In-memory store with the SAME semantics as the Supabase one:
 *   - email_suppressions keyed on user_email, insert-if-absent
 *   - email_provider_events unique on provider_event_id (a replay is a no-op)
 * The webhook inserts the event row BEFORE applying suppression, so the harness does too.
 */
function memoryStore() {
  const suppressions = new Map<string, SuppressionRecord>();
  const events = new Map<string, HistoryEvent & { email: string }>();
  const store: SuppressionStore = {
    async insertIfAbsent(record) {
      if (suppressions.has(record.user_email)) return false;
      suppressions.set(record.user_email, record);
      return true;
    },
    async recentHistory(email, sinceIso) {
      return [...events.values()].filter((e) => e.email === email && e.occurredAt >= sinceIso);
    },
  };
  const deliver = async (input: DeliveryEventInput, now: Date) => {
    if (input.providerEventId && !events.has(input.providerEventId) && input.recipient) {
      events.set(input.providerEventId, {
        email: input.recipient,
        eventId: input.providerEventId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        bounceType: ((input.data.bounce as Record<string, string>) || {}).type || null,
      });
    }
    return applyDeliveryEvent(store, input, now);
  };
  return { store, suppressions, events, deliver };
}

const NOW = new Date('2026-09-23T12:00:00Z');
const ADDR = 'buyer@example-corp.com';

function ev(
  id: string,
  type: string,
  at: string,
  bounce?: { type: string; subType?: string; message?: string },
  to = ADDR,
): DeliveryEventInput {
  return {
    eventType: type,
    data: { to: [to], ...(bounce ? { bounce } : {}) },
    recipient: to,
    providerEventId: id,
    providerMessageId: `msg_${id}`,
    emailType: 'daily_alert',
    occurredAt: at,
  };
}
const transient = { type: 'Transient', subType: 'General', message: '4.4.7 Unable to lookup DNS' };

describe('classifyDeliveryEvent — what one provider event means', () => {
  it('hard (Permanent) bounce → suppress immediately', () => {
    expect(classifyDeliveryEvent('email.bounced', { bounce: { type: 'Permanent' } })).toEqual({
      action: 'suppress', reason: 'hard_bounce',
    });
  });
  it('complaint → suppress immediately', () => {
    expect(classifyDeliveryEvent('email.complained', {})).toEqual({ action: 'suppress', reason: 'complaint' });
  });
  it('provider-suppressed (event or bounce subtype) → suppress', () => {
    expect(classifyDeliveryEvent('email.suppressed', {})).toEqual({ action: 'suppress', reason: 'provider_suppressed' });
    expect(classifyDeliveryEvent('email.bounced', { bounce: { type: 'Transient', subType: 'Suppressed' } }))
      .toEqual({ action: 'suppress', reason: 'provider_suppressed' });
  });
  it('transient / undetermined bounce → only evaluated, never suppressed on sight', () => {
    expect(classifyDeliveryEvent('email.bounced', { bounce: transient }).action).toBe('evaluate_transient');
    expect(classifyDeliveryEvent('email.bounced', { bounce: { type: 'Undetermined' } }).action).toBe('evaluate_transient');
  });
  it('delivered / delayed / opened / sent never touch suppression', () => {
    for (const t of ['email.delivered', 'email.delivery_delayed', 'email.opened', 'email.clicked', 'email.sent']) {
      expect(classifyDeliveryEvent(t, {}).action).toBe('none');
    }
  });
});

describe('applyDeliveryEvent — the webhook contract', () => {
  it('hard-bounced recipient is suppressed with provider reason, status and timestamp preserved', async () => {
    const h = memoryStore();
    const out = await h.deliver(
      ev('e1', 'email.bounced', '2026-09-23T09:00:00Z', { type: 'Permanent', subType: 'General', message: '550 5.1.1 no such user' }),
      NOW,
    );
    expect(out).toMatchObject({ suppressed: true, newlyWritten: true, reason: 'hard_bounce' });
    expect(h.suppressions.get(ADDR)).toMatchObject({
      reason: 'hard_bounce',
      source: 'resend_webhook',
      provider: 'resend',
      provider_event_id: 'e1',
      provider_message_id: 'msg_e1',
      bounce_type: 'Permanent',
      bounce_subtype: 'General',
      diagnostic: '550 5.1.1 no such user',
      event_at: '2026-09-23T09:00:00Z',
      email_type: 'daily_alert',
    });
  });

  it('complained recipient is suppressed immediately', async () => {
    const h = memoryStore();
    const out = await h.deliver(ev('c1', 'email.complained', '2026-09-23T09:00:00Z'), NOW);
    expect(out).toMatchObject({ suppressed: true, reason: 'complaint' });
    expect(h.suppressions.get(ADDR)?.reason).toBe('complaint');
  });

  it('webhook replay is idempotent: same event twice → one row, second call writes nothing', async () => {
    const h = memoryStore();
    const e = ev('c1', 'email.complained', '2026-09-23T09:00:00Z');
    const first = await h.deliver(e, NOW);
    const second = await h.deliver(e, NOW);
    expect(first.newlyWritten).toBe(true);
    expect(second.newlyWritten).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(h.suppressions.size).toBe(1);
  });

  it('the FIRST transient bounce does not kill a legitimate mailbox', async () => {
    const h = memoryStore();
    const out = await h.deliver(ev('t1', 'email.bounced', '2026-09-23T09:00:00Z', transient), NOW);
    expect(out.suppressed).toBe(false);
    expect(h.suppressions.size).toBe(0);
  });

  it('three transient bounces in ONE day (retries in a bad afternoon) do not suppress', async () => {
    const h = memoryStore();
    for (const [i, hh] of ['08', '09', '10'].entries()) {
      await h.deliver(ev(`t${i}`, 'email.bounced', `2026-09-23T${hh}:00:00Z`, transient), NOW);
    }
    expect(h.suppressions.size).toBe(0);
  });

  it('repeated transient bounces on 3 distinct days with no delivery → suppress', async () => {
    const h = memoryStore();
    await h.deliver(ev('t1', 'email.bounced', '2026-09-21T09:00:00Z', transient), NOW);
    await h.deliver(ev('t2', 'email.bounced', '2026-09-22T09:00:00Z', transient), NOW);
    const out = await h.deliver(ev('t3', 'email.bounced', '2026-09-23T09:00:00Z', transient), NOW);
    expect(out).toMatchObject({ suppressed: true, newlyWritten: true, reason: 'repeated_transient_bounce' });
    expect(out.transient).toMatchObject({ bounces: 3, distinctDays: 3, deliveredSinceFirstBounce: false });
  });

  it('a delivery between transient bounces proves the mailbox alive → no suppression', async () => {
    const h = memoryStore();
    await h.deliver(ev('t1', 'email.bounced', '2026-09-20T09:00:00Z', transient), NOW);
    await h.deliver(ev('d1', 'email.delivered', '2026-09-21T09:00:00Z'), NOW);
    await h.deliver(ev('t2', 'email.bounced', '2026-09-22T09:00:00Z', transient), NOW);
    const out = await h.deliver(ev('t3', 'email.bounced', '2026-09-23T09:00:00Z', transient), NOW);
    expect(out.suppressed).toBe(false);
    expect(h.suppressions.size).toBe(0);
  });

  it('replayed transient events are ONE strike each — replays cannot manufacture a suppression', async () => {
    const h = memoryStore();
    const e1 = ev('t1', 'email.bounced', '2026-09-21T09:00:00Z', transient);
    const e2 = ev('t2', 'email.bounced', '2026-09-22T09:00:00Z', transient);
    for (let i = 0; i < 5; i++) { await h.deliver(e1, NOW); await h.deliver(e2, NOW); }
    expect(h.suppressions.size).toBe(0);
  });

  it('bounces outside the 14-day window do not count', async () => {
    const h = memoryStore();
    await h.deliver(ev('old1', 'email.bounced', '2026-08-01T09:00:00Z', transient), NOW);
    await h.deliver(ev('old2', 'email.bounced', '2026-08-02T09:00:00Z', transient), NOW);
    const out = await h.deliver(ev('t3', 'email.bounced', '2026-09-23T09:00:00Z', transient), NOW);
    expect(out.suppressed).toBe(false);
  });

  it('delivered mail never un-suppresses a suppressed mailbox', async () => {
    const h = memoryStore();
    await h.deliver(ev('c1', 'email.complained', '2026-09-22T09:00:00Z'), NOW);
    const out = await h.deliver(ev('d1', 'email.delivered', '2026-09-23T09:00:00Z'), NOW);
    expect(out.decision).toBe('none');
    expect(h.suppressions.get(ADDR)?.reason).toBe('complaint');
  });

  it('a later event never overwrites the original suppression reason', async () => {
    const h = memoryStore();
    await h.deliver(ev('p1', 'email.bounced', '2026-09-22T09:00:00Z', { type: 'Permanent' }), NOW);
    const out = await h.deliver(ev('c1', 'email.complained', '2026-09-23T09:00:00Z'), NOW);
    expect(out.newlyWritten).toBe(false);
    expect(h.suppressions.get(ADDR)?.reason).toBe('hard_bounce');
  });

  it('store failures propagate (the webhook must non-2xx so Resend redelivers)', async () => {
    const failing: SuppressionStore = {
      insertIfAbsent: async () => { throw new Error('db down'); },
      recentHistory: async () => [],
    };
    await expect(applyDeliveryEvent(failing, ev('c1', 'email.complained', '2026-09-23T09:00:00Z'), NOW))
      .rejects.toThrow('db down');
  });
});

describe('evaluateTransientHistory', () => {
  it('threshold constant is what the rule states', () => {
    expect(TRANSIENT_MIN_BOUNCES).toBe(3);
  });
  it('permanent bounces are not transient strikes (they suppress on their own path)', () => {
    const v = evaluateTransientHistory(
      ['21', '22', '23'].map((d, i) => ({ eventId: `p${i}`, eventType: 'email.bounced', occurredAt: `2026-09-${d}T09:00:00Z`, bounceType: 'Permanent' })),
      NOW,
    );
    expect(v.bounces).toBe(0);
  });
});

describe('address helpers', () => {
  it('normalizeRecipient handles arrays, display names and case', () => {
    expect(normalizeRecipient(['Jane <Jane@Corp.COM>'])).toBe('jane@corp.com');
    expect(normalizeRecipient('not-an-email')).toBeNull();
  });
  it('HEALTHCHECK_ADDRESS_RE matches only the obsolete synthetic population', () => {
    expect(HEALTHCHECK_ADDRESS_RE.test('healthcheck-1783008019192@test.govcongiants.com')).toBe(true);
    expect(HEALTHCHECK_ADDRESS_RE.test('healthcheck-42@test.govcongiants.org')).toBe(true);
    expect(HEALTHCHECK_ADDRESS_RE.test('eric@getmindy.ai')).toBe(false);
    expect(HEALTHCHECK_ADDRESS_RE.test('healthcheck-1@govcongiants.com')).toBe(false);
    expect(HEALTHCHECK_ADDRESS_RE.test('someone@test.govcongiants.com')).toBe(false);
    expect(HEALTHCHECK_ADDRESS_RE.test('healthcheck-abc@test.govcongiants.com')).toBe(false);
  });
});
