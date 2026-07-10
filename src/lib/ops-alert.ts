// Internal OPS alerts → Slack (not email).
//
// Eric moved all internal ops/health/watchdog notifications off email onto
// Slack (2026-07-01) — the cron watchdog + health-check emails were burying his
// inbox. This is a DROP-IN for `sendEmail({ to, subject, html })` in the ADMIN-
// alert routes only: same call shape, but it posts to Slack and ignores `to`.
//
// Customer-facing email (briefings, magic links, receipts, launch/apex) still
// uses sendEmail — do NOT swap those.
//
// Webhook: reuses the funnels SLACK_LEAD_WEBHOOK_URL (single channel) — set the
// same value in Mindy's env. If unset, it no-ops (never breaks a cron).

interface OpsAlertArgs {
  subject: string;
  html: string;
  // All of these are accepted for drop-in compat with sendEmail()/sendMail()
  // and IGNORED — Slack posts go to the webhook channel, not an address.
  to?: string;
  from?: string;
  text?: string;
  emailType?: string;
  transactional?: boolean;
  // Route to a dedicated channel. 'security' → SLACK_SECURITY_WEBHOOK_URL so
  // login-abuse / auth alerts don't drown in the lead+ops stream. Falls back
  // to the ops webhook when the security webhook isn't set yet (safe default).
  channel?: 'ops' | 'security';
}

// Pick the destination webhook by channel, with graceful fallback so a missing
// dedicated webhook never means a dropped alert.
function resolveWebhook(channel: 'ops' | 'security' | undefined): { url?: string; label: string } {
  const ops = process.env.SLACK_LEAD_WEBHOOK_URL || process.env.SLACK_OPS_WEBHOOK_URL;
  if (channel === 'security') {
    const sec = process.env.SLACK_SECURITY_WEBHOOK_URL;
    if (sec) return { url: sec, label: 'security' };
    return { url: ops, label: 'security→ops(fallback)' };
  }
  return { url: ops, label: 'ops' };
}

// Crude but dependency-free HTML → text for the Slack body.
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export async function sendOpsAlert(args: OpsAlertArgs): Promise<{ ok: boolean; error?: string }> {
  const { url, label } = resolveWebhook(args.channel);
  if (!url) {
    console.warn('[ops-alert] no Slack webhook set — alert dropped:', args.subject);
    return { ok: false, error: 'no webhook' };
  }
  const isSecurity = args.channel === 'security';
  const footer = isSecurity
    ? 'Mindy security alert · getmindy.ai'
    : 'Mindy ops alert · getmindy.ai';
  const body = htmlToText(args.html).slice(0, 2800); // Slack block text limit is 3000
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: *${args.subject}* (${label})`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: `🚨 ${args.subject}`.slice(0, 150), emoji: true } },
          { type: 'section', text: { type: 'mrkdwn', text: body || '_(no detail)_' } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
        ],
      }),
    });
    if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    console.error('[ops-alert] Slack post failed:', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
