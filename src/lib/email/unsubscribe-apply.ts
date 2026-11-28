/**
 * The unsubscribe write + page, shared by /api/unsubscribe (signed links) and the legacy /api/alerts/unsubscribe.
 * The address is always a VERIFIED one (a valid signature, or an authenticated session) — never a bare ?email=.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MINDY_SITE_URL } from '@/lib/mindy/email-branding';
import { UNSUBSCRIBE_PATH, unsubscribeUrl } from './unsubscribe';
import { sendEmail } from '@/lib/send-email';
import { MINDY_PREFERENCES_URL } from '@/lib/mindy/email-branding';

type Db = Pick<SupabaseClient, 'from'>;

/**
 * 1. email_suppressions row (reason 'unsubscribe') — sendEmail's guard blocks every non-transactional stream for it.
 *    insert-if-absent: an existing suppression (bounce, complaint) keeps its own reason.
 * 2. alerts + briefings off on the settings row, when one exists (no row is created for an address we never mailed).
 * Idempotent: a second click is a no-op that still reports success.
 */
export async function applyUnsubscribe(
  db: Db, email: string, ctx: { emailType?: string | null; via: string },
): Promise<{ ok: true; settingsRows: number | null } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  // Remember the cadence the user had, so turning alerts back on restores it instead of leaving 'paused'.
  const { data: prior } = await db.from('user_notification_settings').select('alert_frequency').eq('user_email', email).maybeSingle();
  const prev = (prior as { alert_frequency?: string | null } | null)?.alert_frequency;
  const previous_alert_frequency = prev && prev !== 'paused' ? prev : null;
  const { error: supErr } = await db.from('email_suppressions').upsert(
    { user_email: email, reason: 'unsubscribe', source: ctx.via, email_type: ctx.emailType ?? null, event_at: now, metadata: { via: ctx.via, previous_alert_frequency } },
    { onConflict: 'user_email', ignoreDuplicates: true },
  );
  if (supErr) return { ok: false, error: `suppression write failed: ${supErr.message}` };
  const { count, error } = await db.from('user_notification_settings')
    .update({ alerts_enabled: false, alert_frequency: 'paused', briefings_enabled: false, updated_at: now }, { count: 'exact' })
    .eq('user_email', email);
  if (error) return { ok: false, error: `settings update failed: ${error.message}` };
  return { ok: true, settingsRows: count ?? null }; // null = count unknown, never 0
}

/**
 * Re-subscribe: an AUTHENTICATED owner turning alerts or briefings back on clears THEIR OWN 'unsubscribe' suppression,
 * so the choice in preferences actually takes effect. Bounce / complaint / provider suppressions are never cleared
 * here — those are facts about the mailbox, not a preference.
 */
/** Default cadence when alerts are turned back on and no earlier cadence is known. */
export const RESUBSCRIBE_DEFAULT_FREQUENCY = 'daily';

/**
 * The cadence to restore when alerts are re-enabled after an unsubscribe: the one stored at unsubscribe time, else
 * the default. Never 'paused' — re-enabling must actually send.
 */
export async function frequencyToRestore(db: Db, email: string): Promise<string> {
  try {
    const { data } = await db.from('email_suppressions').select('metadata').eq('user_email', email.trim().toLowerCase()).eq('reason', 'unsubscribe').maybeSingle();
    const prev = (data as { metadata?: { previous_alert_frequency?: string | null } } | null)?.metadata?.previous_alert_frequency;
    return prev && prev !== 'paused' ? prev : RESUBSCRIBE_DEFAULT_FREQUENCY;
  } catch {
    return RESUBSCRIBE_DEFAULT_FREQUENCY;
  }
}

export async function clearUnsubscribeSuppression(db: Db, email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await db.from('email_suppressions').delete().eq('user_email', email.trim().toLowerCase()).eq('reason', 'unsubscribe');
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function esc(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export type UnsubscribePageState =
  | { state: 'confirm'; email: string; e: string; t: string; s?: string | null }
  | { state: 'done'; email: string }
  | { state: 'invalid' }
  | { state: 'error' }
  | { state: 'legacy_sent' };

const PREFS = MINDY_PREFERENCES_URL;

export function unsubscribePage(p: UnsubscribePageState): string {
  const body = (() => {
    switch (p.state) {
      case 'confirm':
        return `<h1>Unsubscribe from Mindy emails?</h1>
<p>You'll stop getting alerts, briefings and other Mindy emails at <span class="email">${esc(p.email)}</span>. Receipts and sign-in codes still arrive.</p>
<form method="post" action="${esc(UNSUBSCRIBE_PATH)}">
  <input type="hidden" name="e" value="${esc(p.e)}"><input type="hidden" name="t" value="${esc(p.t)}">${p.s ? `<input type="hidden" name="s" value="${esc(p.s)}">` : ''}
  <button type="submit">Unsubscribe</button>
</form>
<p class="small">Want fewer emails instead? <a href="${PREFS}">Manage preferences</a></p>`;
      case 'done':
        return `<h1>You're unsubscribed</h1>
<p><span class="email">${esc(p.email)}</span> won't get Mindy alerts, briefings or other Mindy emails. Receipts and sign-in codes still arrive.</p>
<p class="small">Changed your mind? <a href="${PREFS}">Manage preferences</a></p>`;
      case 'legacy_sent':
        return `<h1>Check your inbox</h1>
<p>If that address gets Mindy emails, we've sent it a one-click unsubscribe link. You can also <a href="${PREFS}">manage preferences</a> after signing in.</p>`;
      case 'invalid':
        return `<h1>This unsubscribe link isn't valid</h1>
<p>Use the Unsubscribe link at the bottom of any recent Mindy email, or <a href="${PREFS}">manage preferences</a> after signing in.</p>`;
      default:
        return `<h1>Something went wrong</h1>
<p>We couldn't complete the unsubscribe. Please try again, or <a href="${PREFS}">manage preferences</a>.</p>`;
    }
  })();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Unsubscribe - Mindy</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.1);padding:32px;max-width:420px;width:100%;text-align:center}
h1{color:#111827;font-size:22px;margin:0 0 12px}p{color:#4b5563;line-height:1.6;margin:0 0 16px}.small{font-size:14px}
.email{background:#f3f4f6;padding:2px 8px;border-radius:6px;font-family:monospace;word-break:break-all}
button{background:#1e3a8a;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:16px;cursor:pointer}a{color:#1e40af}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

const LEGACY_LINK_TYPE = 'unsubscribe_link';

/** Email the address its own signed unsubscribe link: only when we hold a settings row, at most once per 24 h. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendLegacyUnsubscribeLink(db: any, email: string): Promise<'sent' | 'no_row' | 'throttled'> {
  const { count: rows, error: rowErr } = await db.from('user_notification_settings').select('user_email', { count: 'exact', head: true }).eq('user_email', email);
  if (rowErr) throw new Error(rowErr.message);
  if (!rows) return 'no_row';
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recent, error: sentErr } = await db.from('email_provider_sends').select('*', { count: 'exact', head: true })
    .eq('user_email', email).eq('email_type', LEGACY_LINK_TYPE).gte('sent_at', since);
  if (sentErr) throw new Error(sentErr.message);
  if (recent) return 'throttled';
  const link = unsubscribeUrl(email, 'legacy_unsubscribe');
  await sendEmail({
    to: email,
    subject: 'Your Mindy unsubscribe link',
    html: `<p>Someone (probably you) asked to unsubscribe this address from Mindy emails.</p>
<p><a href="${link.replace(/&/g, '&amp;')}">Unsubscribe from Mindy emails</a></p>
<p style="color:#6b7280;font-size:13px">If this wasn't you, ignore this email and nothing changes.</p>`,
    text: `Someone (probably you) asked to unsubscribe this address from Mindy emails.\nUnsubscribe: ${link}\nIf this wasn't you, ignore this email and nothing changes.`,
    emailType: LEGACY_LINK_TYPE,
    transactional: true,
  });
  return 'sent';
}

