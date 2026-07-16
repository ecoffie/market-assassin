/**
 * MCP credit emails — transactional receipts + the free-credit welcome.
 *
 * Sent when credits are actually granted (call ONLY on applied===true so Stripe
 * re-deliveries / idempotent no-ops don't re-send). Every send is fire-safe: a
 * failure is logged and swallowed so it can NEVER block the credit grant (the
 * ledger is the source of truth, the email is a courtesy).
 *
 * Style is a clean branded RECEIPT (à la Perplexity/OpenAI credit receipts), NOT
 * the plain-letter marketing format — receipts should look like receipts. Mindy
 * navy→purple header, a line-item block, the post-grant balance, one button to the
 * account page. `transactional: true` so it bypasses the global marketing send cap.
 */
import { sendEmail } from '@/lib/send-email';

const ACCOUNT_URL = 'https://getmindy.ai/mcp/account';
const SUPPORT_EMAIL = 'support@getmindy.ai';

export type CreditReceiptKind = 'topup' | 'auto_recharge' | 'subscription';

export interface CreditReceiptParams {
  email: string;
  kind: CreditReceiptKind;
  credits: number;
  newBalance: number;
  /** USD charged (dollars, not cents). Omit only if genuinely unknown. */
  amountUsd?: number | null;
  /** Stripe reference — session id / invoice number / payment-intent id. */
  reference?: string | null;
  /** Subscription only: e.g. "Starter". */
  planLabel?: string | null;
  /** Subscription only. */
  interval?: 'month' | 'year' | null;
}

function nowUtc(): string {
  // e.g. "2026-07-16 13:14:52 UTC"
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function fmtUsd(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `$${n.toFixed(2)}`;
}

function kindCopy(kind: CreditReceiptKind, params: CreditReceiptParams): { subject: string; lead: string } {
  const c = params.credits.toLocaleString();
  switch (kind) {
    case 'auto_recharge':
      return {
        subject: 'Your Mindy credits were auto-recharged',
        lead: `Your balance ran low, so we automatically topped it up with <strong>${c} credits</strong> using your card on file. They're ready to use now.`,
      };
    case 'subscription': {
      const plan = params.planLabel ? `${params.planLabel} ` : '';
      const per = params.interval === 'year' ? 'annual' : 'monthly';
      return {
        subject: `Your Mindy ${plan}credits renewed`,
        lead: `Thanks for your ${per} ${plan}subscription. <strong>${c} credits</strong> have been added to your account and are ready to use.`,
      };
    }
    case 'topup':
    default:
      return {
        subject: 'Your Mindy credits are ready',
        lead: `Thank you for your purchase. <strong>${c} credits</strong> are now available in your account.`,
      };
  }
}

/** Build the label/value rows for the receipt block. */
function receiptRows(params: CreditReceiptParams): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Date', nowUtc()]];
  if (params.kind === 'subscription' && params.planLabel) {
    const per = params.interval === 'year' ? '/yr' : '/mo';
    rows.push(['Plan', `${params.planLabel} (${per})`]);
  }
  rows.push(['Credits added', params.credits.toLocaleString()]);
  const amount = fmtUsd(params.amountUsd);
  if (amount) rows.push(['Amount paid', amount]);
  if (params.reference) rows.push(['Reference', params.reference]);
  rows.push(['New balance', `${params.newBalance.toLocaleString()} credits`]);
  return rows;
}

function receiptHtml(params: CreditReceiptParams): string {
  const { subject, lead } = kindCopy(params.kind, params);
  const rows = receiptRows(params)
    .map(
      ([k, v], i) => `
      <tr>
        <td style="padding:11px 0;${i ? 'border-top:1px solid #eef0f4;' : ''}color:#5b6472;font-size:14px;">${k}</td>
        <td style="padding:11px 0;${i ? 'border-top:1px solid #eef0f4;' : ''}color:#12161d;font-size:14px;font-weight:600;text-align:right;">${v}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;">
        <tr><td style="background:linear-gradient(90deg,#1e3a8a,#7c3aed);padding:20px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-.01em;">Mindy</span>
          <span style="color:#c7d2fe;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;float:right;padding-top:6px;">MCP Credits</span>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 12px;font-size:23px;line-height:1.2;color:#12161d;">${subject}.</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3f4754;">${lead}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e9ee;border-radius:10px;padding:6px 16px;background:#fafbfc;">
            ${rows}
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 6px;"><tr><td style="border-radius:9px;background:#7c3aed;">
            <a href="${ACCOUNT_URL}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Manage credits &rarr;</a>
          </td></tr></table>
          <p style="margin:14px 0 0;font-size:13px;color:#8a92a0;">See your balance, usage, and billing history any time at <a href="${ACCOUNT_URL}" style="color:#7c3aed;text-decoration:none;">getmindy.ai/mcp/account</a>.</p>
        </td></tr>
        <tr><td style="padding:20px 28px 26px;border-top:1px solid #eef0f4;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa2b0;">
            Questions about this charge? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a>.<br>
            GovCon Giants AI · getmindy.ai
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function receiptText(params: CreditReceiptParams): string {
  const { subject, lead } = kindCopy(params.kind, params);
  const rows = receiptRows(params).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `${subject}\n\n${lead.replace(/<[^>]*>/g, '')}\n\n${rows}\n\nManage credits: ${ACCOUNT_URL}\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
}

/** Render the receipt (subject/html/text) without sending — used by the send fn + previews. */
export function renderCreditReceipt(params: CreditReceiptParams): { subject: string; html: string; text: string } {
  const { subject } = kindCopy(params.kind, params);
  return {
    subject: `${subject} — ${params.credits.toLocaleString()} credits`,
    html: receiptHtml(params),
    text: receiptText(params),
  };
}

/** Send a credit-purchase receipt. Never throws — logs + swallows on failure. */
export async function sendCreditReceiptEmail(params: CreditReceiptParams): Promise<void> {
  try {
    const r = renderCreditReceipt(params);
    await sendEmail({
      to: params.email,
      subject: r.subject,
      html: r.html,
      text: r.text,
      emailType: 'mcp_credit_receipt',
      eventSource: `mcp_${params.kind}`,
      transactional: true,
    });
  } catch (err) {
    console.error('[mcp:credit-emails] receipt send failed (non-fatal):', params.email, err);
  }
}

/** Render the welcome email (subject/html/text) without sending — used by the send fn + previews. */
export function renderCreditWelcome(params: { email?: string; credits: number }): { subject: string; html: string; text: string } {
    const c = params.credits.toLocaleString();
    const subject = `Welcome to Mindy — ${c} free MCP credits`;
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;">
      <tr><td style="background:linear-gradient(90deg,#1e3a8a,#7c3aed);padding:20px 28px;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;">Mindy</span>
        <span style="color:#c7d2fe;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;float:right;padding-top:6px;">MCP Credits</span>
      </td></tr>
      <tr><td style="padding:30px 28px;">
        <h1 style="margin:0 0 12px;font-size:23px;line-height:1.2;color:#12161d;">You've got ${c} free credits.</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3f4754;">Welcome to Mindy — the GovCon intelligence layer your AI agent can call directly. We've dropped <strong>${c} credits</strong> in your account to try it out.</p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#3f4754;">Point your agent at a real question:</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3f4754;">&rarr; <strong>Find contracts awarded in Florida for IT services</strong><br>&rarr; <strong>Who are the top contractors in NAICS 541512?</strong><br>&rarr; <strong>Draft a proposal for this solicitation</strong></p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0;"><tr><td style="border-radius:9px;background:#7c3aed;">
          <a href="${ACCOUNT_URL}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View my account &rarr;</a>
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:13px;color:#8a92a0;">A full proposal run uses about 100 credits — so your free grant is roughly one complete proposal, on us.</p>
      </td></tr>
      <tr><td style="padding:20px 28px 26px;border-top:1px solid #eef0f4;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9aa2b0;">Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#7c3aed;text-decoration:none;">${SUPPORT_EMAIL}</a><br>GovCon Giants AI · getmindy.ai</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    const text = `Welcome to Mindy — ${c} free MCP credits\n\nWe've dropped ${c} credits in your account to try it out. Point your agent at a real question:\n- Find contracts awarded in Florida for IT services\n- Who are the top contractors in NAICS 541512?\n- Draft a proposal for this solicitation\n\nView your account: ${ACCOUNT_URL}\n\nA full proposal run uses ~100 credits — roughly one complete proposal, on us.\n\nQuestions? ${SUPPORT_EMAIL}\nGovCon Giants AI · getmindy.ai`;
    return { subject, html, text };
}

/** Welcome email for the one-time free signup credits. Never throws. */
export async function sendCreditWelcomeEmail(params: { email: string; credits: number }): Promise<void> {
  try {
    const r = renderCreditWelcome(params);
    await sendEmail({
      to: params.email,
      subject: r.subject,
      html: r.html,
      text: r.text,
      emailType: 'mcp_credit_welcome',
      eventSource: 'mcp_signup_grant',
      transactional: true,
    });
  } catch (err) {
    console.error('[mcp:credit-emails] welcome send failed (non-fatal):', params.email, err);
  }
}
