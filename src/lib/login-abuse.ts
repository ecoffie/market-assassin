/**
 * Login-abuse detection — the "GuardDuty" signal for auth.
 *
 * Tracks failed login / 2FA attempts in short KV windows and fires ONE Slack
 * ops alert when a threshold trips (per email OR per IP), plus an audit_log
 * row. Best-effort: never throws, never blocks the auth response. If KV is
 * unavailable it degrades to "no tracking" (fails open — availability over
 * enforcement, matching rate-limit.ts).
 *
 * Two independent signals:
 *   - EMAIL: many failures against one account  → likely password/code guessing
 *   - IP:    one IP failing against many accounts → likely credential stuffing
 *
 * Alerts are de-duped: once a window trips, an alert:* marker (with the same
 * TTL) suppresses repeat Slack posts until the window rolls over — so an
 * attacker hammering the endpoint produces one alert, not hundreds.
 */
import { kv } from '@vercel/kv';
import { sendOpsAlert } from '@/lib/ops-alert';
import { recordAudit } from '@/lib/audit-log';

// Tunables. Conservative defaults — tune after watching real traffic.
const WINDOW_SECONDS = 15 * 60; // 15-minute rolling window
const EMAIL_THRESHOLD = 5; // ≥5 failures for one email in the window
const IP_THRESHOLD = 12; // ≥12 failures from one IP (across any emails)

function emailKey(email: string): string {
  return `loginfail:email:${email.toLowerCase()}`;
}
function ipKey(ip: string): string {
  return `loginfail:ip:${ip}`;
}
function alertKey(scope: string): string {
  return `loginfail:alerted:${scope}`;
}

async function bump(key: string): Promise<number> {
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, WINDOW_SECONDS);
  return count;
}

/** Fire a Slack alert + audit row at most once per window per scope. */
async function alertOnce(
  scope: string,
  subject: string,
  detail: Record<string, unknown>
): Promise<void> {
  // NX marker so concurrent requests only alert once; TTL matches the window.
  const marker = alertKey(scope);
  const set = await kv.set(marker, 1, { nx: true, ex: WINDOW_SECONDS });
  if (!set) return; // already alerted this window

  const lines = Object.entries(detail)
    .map(([k, v]) => `• *${k}:* ${v}`)
    .join('\n');

  await sendOpsAlert({
    subject,
    html: `<p>${subject}</p><p>${lines.replace(/\n/g, '<br>')}</p>`,
    text: `${subject}\n${lines}`,
    channel: 'security',
  });

  await recordAudit({
    action: 'login_abuse_detected',
    detail: { subject, ...detail },
  });
}

/**
 * Record ONE failed auth attempt. Call this at every login/2FA failure point.
 * Returns silently on any error (monitoring must never break auth).
 */
export async function recordFailedLogin(opts: {
  email?: string;
  ip?: string;
  reason: string; // e.g. 'bad_2fa_code', 'lockout', 'admin_password'
  route: string; // e.g. 'two-factor/verify'
}): Promise<void> {
  const { email, ip, reason, route } = opts;
  try {
    if (email) {
      const n = await bump(emailKey(email));
      if (n >= EMAIL_THRESHOLD) {
        await alertOnce(`email:${email.toLowerCase()}`, '🔐 Login abuse — repeated failures on one account', {
          email,
          failures: n,
          window: '15m',
          reason,
          route,
          ip: ip || 'unknown',
        });
      }
    }
    if (ip) {
      const n = await bump(ipKey(ip));
      if (n >= IP_THRESHOLD) {
        await alertOnce(`ip:${ip}`, '🔐 Login abuse — one IP failing across accounts', {
          ip,
          failures: n,
          window: '15m',
          reason,
          route,
          lastEmail: email || 'unknown',
        });
      }
    }
  } catch (err) {
    // Fail open — never block the auth path for a monitoring hiccup.
    console.error('[login-abuse] tracking failed:', (err as Error).message);
  }
}

/** Clear the per-email failure counter after a SUCCESSFUL login (optional hygiene). */
export async function clearFailedLogins(email: string): Promise<void> {
  try {
    await kv.del(emailKey(email));
  } catch {
    /* best-effort */
  }
}
