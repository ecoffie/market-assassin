/**
 * Admin: send a TEST MCP credit email through the real provider (prod Resend).
 *
 * GET /api/admin/mcp-credit-test-email?password=...&to=you@example.com&kind=topup[&send=true]
 *   kind = topup | auto_recharge | subscription | welcome  (default topup)
 *   send omitted / !=true  → PREVIEW (returns subject + html, sends nothing)
 *   send=true              → actually sends via sendEmail (transactional)
 *
 * Uses the EXACT production renderers (renderCreditReceipt / renderCreditWelcome) so a
 * test send is byte-for-byte what a real purchase produces. This is the "verify a test
 * send" hook — RESEND_API_KEY is a Sensitive var that only exists in the deployed env,
 * so delivery can only be exercised in prod.
 */
import { NextRequest, NextResponse } from 'next/server';
import { renderCreditReceipt, renderCreditWelcome, type CreditReceiptKind } from '@/lib/mcp/credit-emails';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type Kind = CreditReceiptKind | 'welcome';

function render(kind: Kind): { subject: string; html: string; text: string; emailType: string; eventSource: string } {
  switch (kind) {
    case 'welcome': {
      const r = renderCreditWelcome({ credits: 100 });
      return { ...r, emailType: 'mcp_credit_welcome', eventSource: 'mcp_signup_grant' };
    }
    case 'auto_recharge': {
      const r = renderCreditReceipt({ email: '', kind: 'auto_recharge', credits: 2000, newBalance: 2085, amountUsd: 49, reference: 'pi_test_3Q7xY2' });
      return { ...r, emailType: 'mcp_credit_receipt', eventSource: 'mcp_auto_recharge' };
    }
    case 'subscription': {
      const r = renderCreditReceipt({ email: '', kind: 'subscription', credits: 2400, newBalance: 2400, amountUsd: 59, reference: 'TEST-0007', planLabel: 'Starter', interval: 'month' });
      return { ...r, emailType: 'mcp_credit_receipt', eventSource: 'mcp_subscription' };
    }
    case 'topup':
    default: {
      const r = renderCreditReceipt({ email: '', kind: 'topup', credits: 5000, newBalance: 5120, amountUsd: 99, reference: 'cs_test_a1B2c3D4' });
      return { ...r, emailType: 'mcp_credit_receipt', eventSource: 'mcp_topup' };
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const to = searchParams.get('to')?.toLowerCase().trim();
  const kindRaw = (searchParams.get('kind') || 'topup') as Kind;
  const kind: Kind = ['topup', 'auto_recharge', 'subscription', 'welcome'].includes(kindRaw) ? kindRaw : 'topup';
  const doSend = searchParams.get('send') === 'true';

  const r = render(kind);

  if (!doSend) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      kind,
      subject: r.subject,
      note: 'Add &to=<email>&send=true to actually send via the prod provider.',
      html: r.html,
    });
  }

  if (!to) {
    return NextResponse.json({ success: false, error: 'to_required', message: 'Pass &to=<email> to send.' }, { status: 400 });
  }

  const sent = await sendEmail({
    to,
    subject: r.subject,
    html: r.html,
    text: r.text,
    emailType: r.emailType,
    eventSource: r.eventSource,
    transactional: true,
  });

  return NextResponse.json({
    success: sent,
    mode: 'send',
    kind,
    to,
    subject: r.subject,
    message: sent ? `Sent ${kind} test email to ${to}` : `Provider rejected the send to ${to} (check logs)`,
  });
}
