/**
 * Fire an ops alert only when the SITUATION CHANGES — not every time a cron notices a
 * known, unresolved condition.
 *
 * WHY
 * Every ops check here fires on `findings.length > 0`, with no threshold and no memory.
 * A condition that is real but not urgent — 3 subscribers missing a settings row, a job
 * that failed once — therefore re-alerts on every single run, forever, until someone
 * fixes it. That is how a channel becomes noise, and a noisy channel is one nobody reads
 * when the real outage lands.
 *
 * WHAT THIS DOES
 * Hashes the alert's identity (a caller-supplied fingerprint of WHICH things are
 * affected) and records it. A repeat of the SAME fingerprint stays silent until either:
 *   - the fingerprint changes (someone new is affected → genuinely new information), or
 *   - REMIND_AFTER_HOURS elapses (so a long-lived problem resurfaces occasionally
 *     instead of vanishing entirely).
 *
 * It never suppresses a NEW condition, and it never suppresses forever.
 *
 * Storage is a single row per alert key in `ops_alert_state`. A read/write failure fails
 * OPEN (alert is sent) — losing the dedup is an annoyance, losing the alert is not.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

/** A still-unresolved condition resurfaces this often, so it cannot be forgotten. */
export const REMIND_AFTER_HOURS = 72;

export interface AlertGate {
  /** Should the caller send? */
  send: boolean;
  /** Why — for logging, so a silent run is explainable. */
  reason: 'new' | 'changed' | 'reminder' | 'suppressed' | 'no-store';
}

export function fingerprint(parts: Array<string | number>): string {
  return crypto.createHash('sha256').update(parts.map(String).sort().join('|')).digest('hex').slice(0, 32);
}

/**
 * @param key   stable identifier for the CHECK (e.g. 'unonboarded-payers')
 * @param print fingerprint of the current finding set (see fingerprint())
 */
export async function shouldSendAlert(
  sb: SupabaseClient,
  key: string,
  print: string,
): Promise<AlertGate> {
  let existing: { fingerprint: string | null; last_sent_at: string | null } | null = null;
  try {
    const { data, error } = await sb
      .from('ops_alert_state')
      .select('fingerprint, last_sent_at')
      .eq('alert_key', key)
      .maybeSingle();
    // Fail OPEN: if we cannot read the state, send. A missed alert is worse than a dupe.
    if (error) return { send: true, reason: 'no-store' };
    existing = data;
  } catch {
    return { send: true, reason: 'no-store' };
  }

  const now = Date.now();
  const record = async (reason: AlertGate['reason']): Promise<AlertGate> => {
    try {
      await sb.from('ops_alert_state').upsert(
        { alert_key: key, fingerprint: print, last_sent_at: new Date(now).toISOString() },
        { onConflict: 'alert_key' },
      );
    } catch {
      // Non-fatal: worst case the next run re-sends.
    }
    return { send: true, reason };
  };

  if (!existing) return record('new');
  if (existing.fingerprint !== print) return record('changed'); // different people affected
  const lastMs = existing.last_sent_at ? new Date(existing.last_sent_at).getTime() : 0;
  if (now - lastMs >= REMIND_AFTER_HOURS * 3600_000) return record('reminder');
  return { send: false, reason: 'suppressed' };
}
