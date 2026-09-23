/**
 * Mailbox suppression — the provider feedback loop that makes Resend delivery
 * events LOAD-BEARING (deliverability P0, 2026-09-23).
 *
 * TWO DIFFERENT THINGS, deliberately kept apart:
 *
 *   MAILBOX SUPPRESSION  (`email_suppressions`, this module)
 *     A fact about the ADDRESS: it hard-bounced, complained, sits on Resend's
 *     suppression list, or has failed on enough separate days that it is dead.
 *     Blocks every NON-transactional send to it (alerts, briefings, marketing)
 *     inside `sendEmail()`'s guard. User-initiated transactional mail (password
 *     reset, 2FA, receipts) still bypasses it: the person just asked for that
 *     message, and Resend's own suppression list remains the backstop.
 *
 *   PRODUCT ALERT PREFERENCE  (`user_notification_settings.alerts_enabled`)
 *     A choice about ONE PRODUCT STREAM. It only removes a user from the alert
 *     crons' audiences. It never reaches `sendEmail()`, so turning alerts off can
 *     never block a password reset or security code.
 *
 * Why this exists: before this module the Resend webhook only mirrored status onto
 * `email_provider_sends`, and `email_suppressions` held 1 row. Measured Sep 8–23:
 * 52 of 72 hard-bounced addresses were mailed again, a complainer received 29 more
 * daily alerts, and 62 addresses already on Resend's list were attempted ~60×/day.
 */

export type SuppressionReason =
  | 'hard_bounce'
  | 'complaint'
  | 'provider_suppressed'
  | 'repeated_transient_bounce'
  | 'synthetic_address';

/**
 * REPEATED TRANSIENT BOUNCE RULE.
 *
 * A single transient bounce (full mailbox, greylisting, a DNS blip, a receiving
 * server that is down for an afternoon) must never kill a real mailbox. A dead
 * domain, by contrast, fails the SAME way EVERY day: measured, the 257 synthetic
 * healthcheck profiles produced a "4.4.7 Unable to lookup DNS" transient bounce on
 * every single daily send, and ~300 real dead addresses did the same.
 *
 * So an address is suppressed only when ALL of these hold, evaluated over the
 * trailing TRANSIENT_WINDOW_DAYS:
 *   - at least TRANSIENT_MIN_BOUNCES distinct transient/undetermined bounce events,
 *   - spread over at least TRANSIENT_MIN_DISTINCT_DAYS distinct UTC days
 *     (three retries in one bad afternoon do not count as three strikes),
 *   - and NOT ONE `email.delivered` event for the address since the earliest of
 *     those bounces (any successful delivery proves the mailbox is alive).
 *
 * Distinct events are keyed by provider_event_id, so a replayed webhook can never
 * add a strike.
 */
export const TRANSIENT_MIN_BOUNCES = 3;
export const TRANSIENT_MIN_DISTINCT_DAYS = 3;
export const TRANSIENT_WINDOW_DAYS = 14;

/** The obsolete health-check population: `healthcheck-<digits>@test.govcongiants.com|org`. */
export const HEALTHCHECK_ADDRESS_RE = /^healthcheck-\d+@test\.govcongiants\.(com|org)$/;

export function normalizeRecipient(value: unknown): string | null {
  if (Array.isArray(value)) return normalizeRecipient(value[0]);
  if (typeof value !== 'string') return null;
  const match = value.match(/<([^>]+)>/);
  const email = (match?.[1] || value).trim().toLowerCase();
  return email.includes('@') ? email : null;
}

export interface BounceDetail {
  type: string | null;      // Resend: 'Permanent' | 'Transient' | 'Undetermined'
  subType: string | null;   // e.g. 'General', 'MailboxFull', 'Suppressed'
  message: string | null;   // provider diagnostic text
}

export function readBounce(data: Record<string, unknown>): BounceDetail {
  const bounce = (data.bounce && typeof data.bounce === 'object' ? data.bounce : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    type: str(bounce.type),
    subType: str(bounce.subType) || str(bounce.subtype) || str(bounce.sub_type),
    message: str(bounce.message) || str(bounce.diagnosticCode),
  };
}

export type EventDecision =
  | { action: 'suppress'; reason: SuppressionReason }
  | { action: 'evaluate_transient' }
  | { action: 'none' };

/**
 * What a single Resend event means for the recipient's mailbox. Pure.
 * `email.delivered` (and opens/clicks/sent/delayed) is ALWAYS 'none': delivery
 * evidence never lifts an existing suppression — un-suppressing is a human decision.
 */
export function classifyDeliveryEvent(eventType: string, data: Record<string, unknown>): EventDecision {
  switch (eventType) {
    case 'email.complained':
      return { action: 'suppress', reason: 'complaint' };
    case 'email.suppressed':
      return { action: 'suppress', reason: 'provider_suppressed' };
    case 'email.bounced': {
      const { type, subType } = readBounce(data);
      if (type === 'Permanent') return { action: 'suppress', reason: 'hard_bounce' };
      // Resend reports a send it refused because the address is already on its list
      // as a bounce with subType 'Suppressed' — that is the provider telling us it
      // will never deliver there.
      if (subType === 'Suppressed' || subType === 'OnAccountSuppressionList') {
        return { action: 'suppress', reason: 'provider_suppressed' };
      }
      return { action: 'evaluate_transient' };
    }
    default:
      return { action: 'none' };
  }
}

export interface HistoryEvent {
  eventId: string | null;
  eventType: string;          // 'email.bounced' | 'email.delivered'
  occurredAt: string;         // ISO
  bounceType: string | null;
}

export interface TransientVerdict {
  suppress: boolean;
  bounces: number;
  distinctDays: number;
  deliveredSinceFirstBounce: boolean;
}

/** Apply the repeated-transient rule to an address's recent event history. Pure. */
export function evaluateTransientHistory(events: HistoryEvent[], now: Date = new Date()): TransientVerdict {
  const windowStart = now.getTime() - TRANSIENT_WINDOW_DAYS * 86_400_000;
  const seen = new Set<string>();
  const bounces: HistoryEvent[] = [];
  const deliveries: number[] = [];

  for (const e of events) {
    const t = Date.parse(e.occurredAt);
    if (!Number.isFinite(t) || t < windowStart || t > now.getTime() + 60_000) continue;
    const key = e.eventId || `${e.eventType}|${e.occurredAt}`;
    if (seen.has(key)) continue; // a replayed webhook is the same strike, not a new one
    seen.add(key);
    if (e.eventType === 'email.delivered') deliveries.push(t);
    else if (e.eventType === 'email.bounced' && e.bounceType !== 'Permanent') bounces.push(e);
  }

  const firstBounce = bounces.reduce((m, b) => Math.min(m, Date.parse(b.occurredAt)), Infinity);
  const deliveredSinceFirstBounce = deliveries.some((t) => t >= firstBounce);
  const distinctDays = new Set(bounces.map((b) => b.occurredAt.slice(0, 10))).size;
  const suppress =
    bounces.length >= TRANSIENT_MIN_BOUNCES &&
    distinctDays >= TRANSIENT_MIN_DISTINCT_DAYS &&
    !deliveredSinceFirstBounce;

  return { suppress, bounces: bounces.length, distinctDays, deliveredSinceFirstBounce };
}

export interface SuppressionRecord {
  user_email: string;
  reason: SuppressionReason;
  source: string;
  provider: string | null;
  provider_event_id: string | null;
  provider_message_id: string | null;
  email_type: string | null;
  bounce_type: string | null;
  bounce_subtype: string | null;
  diagnostic: string | null;
  event_at: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Storage seam. The production implementation is Supabase; tests use an in-memory
 * store with the same semantics, so the replay/idempotency contract is exercised.
 */
export interface SuppressionStore {
  /** Insert-if-absent keyed on user_email. Returns true only when a NEW row was written. */
  insertIfAbsent(record: SuppressionRecord): Promise<boolean>;
  /** Recent bounced/delivered events for one address (for the transient rule). */
  recentHistory(email: string, sinceIso: string): Promise<HistoryEvent[]>;
}

export interface DeliveryEventInput {
  eventType: string;
  data: Record<string, unknown>;
  recipient: string | null;
  providerEventId: string | null;
  providerMessageId: string | null;
  emailType: string | null;
  occurredAt: string;
}

export interface SuppressionOutcome {
  decision: EventDecision['action'];
  reason: SuppressionReason | null;
  suppressed: boolean;      // the address is (now) suppressed because of this event
  newlyWritten: boolean;    // this call wrote the row (false on replay / already suppressed)
  transient?: TransientVerdict;
}

/**
 * Turn one provider event into (at most one) idempotent suppression write.
 * Replaying the same event produces the same verdict and never a second row:
 * the store is insert-if-absent, and transient strikes are de-duplicated by
 * provider_event_id. Errors propagate — the webhook must return non-2xx so
 * Resend redelivers rather than silently losing a bounce.
 */
export async function applyDeliveryEvent(
  store: SuppressionStore,
  input: DeliveryEventInput,
  now: Date = new Date(),
): Promise<SuppressionOutcome> {
  const decision = classifyDeliveryEvent(input.eventType, input.data);
  const email = input.recipient;
  if (decision.action === 'none' || !email) {
    return { decision: decision.action, reason: null, suppressed: false, newlyWritten: false };
  }

  let reason: SuppressionReason;
  let transient: TransientVerdict | undefined;
  if (decision.action === 'suppress') {
    reason = decision.reason;
  } else {
    const since = new Date(now.getTime() - TRANSIENT_WINDOW_DAYS * 86_400_000).toISOString();
    const history = await store.recentHistory(email, since);
    // The triggering event may not be committed yet when history is read; include it.
    const bounce = readBounce(input.data);
    history.push({
      eventId: input.providerEventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      bounceType: bounce.type,
    });
    transient = evaluateTransientHistory(history, now);
    if (!transient.suppress) {
      return { decision: decision.action, reason: null, suppressed: false, newlyWritten: false, transient };
    }
    reason = 'repeated_transient_bounce';
  }

  const bounce = readBounce(input.data);
  const newlyWritten = await store.insertIfAbsent({
    user_email: email,
    reason,
    source: 'resend_webhook',
    provider: 'resend',
    provider_event_id: input.providerEventId,
    provider_message_id: input.providerMessageId,
    email_type: input.emailType,
    bounce_type: bounce.type,
    bounce_subtype: bounce.subType,
    diagnostic: bounce.message ? bounce.message.slice(0, 1000) : null,
    event_at: input.occurredAt,
    metadata: transient ? { transient } : {},
  });
  return { decision: decision.action, reason, suppressed: true, newlyWritten, transient };
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

export function supabaseSuppressionStore(supabase: SupabaseLike): SuppressionStore {
  return {
    async insertIfAbsent(record) {
      // truncation-ok: a single-row upsert; RETURNING is used only to tell insert from conflict.
      const { data, error } = await supabase
        .from('email_suppressions')
        .upsert(record, { onConflict: 'user_email', ignoreDuplicates: true }) // truncation-ok: single row
        .select('user_email');
      if (error) throw new Error(`email_suppressions write failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    async recentHistory(email, sinceIso) {
      const { data, error } = await supabase
        .from('email_provider_events')
        .select('provider_event_id, event_type, occurred_at, bounce_type:raw_payload->data->bounce->>type')
        .eq('user_email', email)
        .in('event_type', ['email.bounced', 'email.delivered'])
        .gte('occurred_at', sinceIso)
        .order('occurred_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(`email_provider_events history read failed: ${error.message}`);
      return (data || []).map((r: Record<string, unknown>) => ({
        eventId: (r.provider_event_id as string) || null,
        eventType: String(r.event_type),
        occurredAt: String(r.occurred_at),
        bounceType: (r.bounce_type as string) || null,
      }));
    },
  };
}

/**
 * Is this mailbox suppressed? FAILS CLOSED (returns true on a lookup error), same
 * asymmetry as the sendEmail guard: skipping one alert costs little, mailing a
 * complainer costs the reputation every Mindy email depends on.
 */
export async function isMailboxSuppressed(supabase: SupabaseLike, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('email_suppressions')
    .select('user_email')
    .eq('user_email', email.trim().toLowerCase())
    .maybeSingle();
  if (error) return true;
  return !!data;
}
