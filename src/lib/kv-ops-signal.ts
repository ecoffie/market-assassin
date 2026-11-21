/**
 * KV failure → ONE rate-limited ops signal per instance.
 *
 * Before this, the only trace of a KV outage / Upstash quota exhaustion was a
 * console.warn per request — nobody reads those. A failing KV silently degrades
 * rate limiting and paid access, so it must be visible.
 *
 * Per-instance, in-memory gate (KV itself is the thing that is down, and a
 * Supabase-backed dedup would add a DB write on the hot path): at most one
 * Slack alert per instance per KV_OPS_SIGNAL_INTERVAL_MS. Serverless fans out
 * to several instances, so a real outage may produce a handful of alerts — that
 * is the intended trade-off (some duplicates > silence).
 *
 * Never throws, never awaits on the caller's hot path.
 */
import { sendOpsAlert } from '@/lib/ops-alert';

export const KV_OPS_SIGNAL_INTERVAL_MS = 15 * 60 * 1000;

export type KvFailureKind = 'circuit_open' | 'quota_exceeded' | 'kv_error';

let lastSentAt = 0;

/** True when the error is Upstash's request-quota error. */
export function isKvQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /max requests limit/i.test(msg);
}

/**
 * Emit (at most once per interval per instance) an ops alert about KV failing.
 * Returns true if an alert was dispatched by this call.
 */
export function signalKvFailure(kind: KvFailureKind, detail: string): boolean {
  const now = Date.now();
  if (lastSentAt && now - lastSentAt < KV_OPS_SIGNAL_INTERVAL_MS) return false;
  lastSentAt = now;

  const subject =
    kind === 'quota_exceeded'
      ? 'Vercel KV quota exceeded (Upstash max requests limit)'
      : kind === 'circuit_open'
        ? 'Vercel KV circuit breaker OPEN'
        : 'Vercel KV errors';
  const html =
    `<p><strong>${subject}</strong></p>` +
    `<p>Detail: ${detail.replace(/[<>&]/g, ' ').slice(0, 500)}</p>` +
    '<p>Effect while KV is failing: rate limits fall back to per-instance in-memory windows; ' +
    'paid access is served from per-instance last-known values (24h), else denied. ' +
    'Users with no last-known value on a cold instance drop to Free.</p>' +
    '<p>Check: /api/admin/kv-health and the Upstash dashboard. At most one alert per instance per 15 min.</p>';

  try {
    void sendOpsAlert({ subject, html }).catch((e) => {
      console.warn('[kv-ops-signal] ops alert failed:', (e as Error)?.message);
    });
  } catch (e) {
    console.warn('[kv-ops-signal] ops alert threw:', (e as Error)?.message);
  }
  console.error(`[kv-ops-signal] ${kind}: ${detail}`);
  return true;
}

/** Test-only: reset the per-instance gate. */
export function __resetKvOpsSignalForTests(): void {
  lastSentAt = 0;
}
