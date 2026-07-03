import { kv } from '@vercel/kv';

/**
 * Signup fallback queue — never lose a free-alert signup to a DB outage.
 *
 * WHY: mi-signup calls `supabase.auth.admin.generateLink` to mint the setup
 * link; that talks to the same Postgres that went down on 2026-06-30, so the
 * whole signup POST hung 30s and failed — a prospect who tries to sign up for
 * free alerts during an outage is lost forever (they don't come back). Account
 * creation genuinely needs the DB, so we can't complete it offline — but we CAN
 * capture the email durably and finish once the DB is back.
 *
 * DESIGN: the queue lives in Vercel KV (Upstash) — a SEPARATE service from
 * Supabase, so it survives the outage it exists to cover. On recovery, the
 * drain endpoint replays each queued email through the real signup path and
 * removes it. All KV ops degrade safely (per the project KV-resilience rule):
 * an enqueue failure is logged, never thrown, so it can't itself break signup.
 */

const QUEUE_KEY = 'signup:pending'; // a KV list (LPUSH / LRANGE / LREM)

export interface PendingSignup {
  email: string;
  referralCode?: string;
  source?: string;
  queuedAt: string; // ISO
}

/**
 * Durably capture a signup that couldn't complete (DB unreachable). Best-effort:
 * returns true if queued, false if KV itself failed — never throws.
 */
export async function enqueuePendingSignup(entry: Omit<PendingSignup, 'queuedAt'>): Promise<boolean> {
  const payload: PendingSignup = { ...entry, queuedAt: new Date().toISOString() };
  try {
    await kv.lpush(QUEUE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('[signup-queue] enqueue failed:', (err as Error)?.message);
    return false;
  }
}

/** How many signups are waiting to be completed (0 on KV failure). */
export async function pendingSignupCount(): Promise<number> {
  try {
    return await kv.llen(QUEUE_KEY);
  } catch {
    return 0;
  }
}

/**
 * Pop up to `max` pending signups for the drain job to replay. Returns the
 * parsed entries and removes them from the queue. On KV failure returns [].
 */
export async function drainPendingSignups(max = 100): Promise<PendingSignup[]> {
  const out: PendingSignup[] = [];
  try {
    for (let i = 0; i < max; i++) {
      const raw = await kv.rpop<string>(QUEUE_KEY);
      if (!raw) break;
      try {
        // @vercel/kv may auto-deserialize JSON; handle both string and object.
        const parsed: PendingSignup = typeof raw === 'string' ? JSON.parse(raw) : (raw as PendingSignup);
        if (parsed?.email) out.push(parsed);
      } catch {
        // A single unparseable entry is dropped rather than blocking the drain.
        console.warn('[signup-queue] dropped unparseable queue entry');
      }
    }
  } catch (err) {
    console.error('[signup-queue] drain failed:', (err as Error)?.message);
  }
  return out;
}

/**
 * Re-queue an entry that failed to complete during a drain (so a transient
 * error doesn't discard the prospect). Best-effort.
 */
export async function requeuePendingSignup(entry: PendingSignup): Promise<void> {
  try {
    await kv.lpush(QUEUE_KEY, JSON.stringify(entry));
  } catch (err) {
    console.error('[signup-queue] requeue failed:', (err as Error)?.message);
  }
}
