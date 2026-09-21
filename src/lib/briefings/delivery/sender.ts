/**
 * Briefing Delivery Sender
 *
 * Handles sending briefings via EMAIL through the shared sendEmail() helper
 * (Resend, verified sender mail.getmindy.ai) — the SAME transport the daily
 * briefing crons use. The old nodemailer/Office365 SMTP path was removed
 * 2026-07-18: prod EMAIL_FROM is a getmindy.ai address, but Office365
 * authenticated as alerts@govcongiants.com, so every send here 554'd with
 * SendAsDenied. Only the admin send-live-briefing test endpoint used this
 * path, so it silently always failed.
 *
 * SMS is NOT here — all outbound SMS goes through GoHighLevel
 * (src/lib/ghl/sms.ts, sendViaGHL), which is our A2P-10DLC-compliant sender.
 * The old Twilio SMS path was removed 2026-07-01 (it was dead code + an
 * unregistered number carriers would filter).
 */

import { createClient } from '@supabase/supabase-js';
import {
  GeneratedBriefing,
  DeliveryResult,
  BriefingDeliveryRecord,
} from './types';
import { generateEmailTemplate } from './email-template';
import { createEmailTrackingToken } from '@/lib/engagement';
import { sendEmail } from '@/lib/send-email';

/**
 * Send briefing via email (Resend, through the shared sendEmail helper).
 */
export async function sendBriefingEmail(
  briefing: GeneratedBriefing,
  toEmail: string
): Promise<DeliveryResult> {
  // Create email tracking token
  const tokenResult = await createEmailTrackingToken(toEmail, 'daily_briefing', briefing.briefingDate);
  const trackingToken = tokenResult?.token;

  const template = generateEmailTemplate(briefing, toEmail, trackingToken);

  try {
    // transactional: this is the manual admin test path (send-live-briefing) —
    // bypass the per-recipient daily cap so an admin can always fire a test copy,
    // matching the daily-alerts fixture test behavior.
    const sent = await sendEmail({
      to: toEmail,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody,
      emailType: 'daily_briefing',
      eventSource: 'briefing',
      transactional: true,
    });

    if (!sent) {
      console.error(`[BriefingSender] sendEmail returned false for ${toEmail}`);
      return {
        success: false,
        method: 'email',
        error: 'Email not sent (suppressed or provider error — see logs)',
      };
    }

    // Record the delivery
    await recordDelivery({
      id: `delivery-${briefing.id}-email`,
      userId: briefing.userId,
      briefingId: briefing.id,
      deliveryMethod: 'email',
      status: 'sent',
      sentAt: new Date().toISOString(),
    });

    console.log(`[BriefingSender] Email sent to ${toEmail} via Resend`);

    return {
      success: true,
      method: 'email',
      deliveredAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[BriefingSender] Error sending email:`, error);
    return {
      success: false,
      method: 'email',
      error: String(error),
    };
  }
}

/**
 * Record delivery in database
 */
async function recordDelivery(record: BriefingDeliveryRecord): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return;
  }

  try {
    await supabase.from('briefing_deliveries').insert({
      id: record.id,
      user_id: record.userId,
      briefing_id: record.briefingId,
      delivery_method: record.deliveryMethod,
      status: record.status,
      message_id: record.messageId,
      sent_at: record.sentAt,
      error: record.error,
    });
  } catch (error) {
    console.error(`[BriefingSender] Error recording delivery:`, error);
  }
}

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

/**
 * Send briefing to user by email. (SMS delivery was removed — outbound SMS now
 * goes through GHL via sendViaGHL; this path is email-only.)
 */
export async function deliverBriefing(
  briefing: GeneratedBriefing,
  config: { email: string },
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const emailResult = await sendBriefingEmail(briefing, config.email);
  results.push(emailResult);
  return results;
}
