/**
 * Briefing Delivery Sender
 *
 * Handles sending briefings via EMAIL (nodemailer).
 * SMS is NOT here — all outbound SMS goes through GoHighLevel
 * (src/lib/ghl/sms.ts, sendViaGHL), which is our A2P-10DLC-compliant sender.
 * The old Twilio SMS path was removed 2026-07-01 (it was dead code + an
 * unregistered number carriers would filter).
 */

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import {
  GeneratedBriefing,
  DeliveryResult,
  BriefingDeliveryRecord,
} from './types';
import { generateEmailTemplate } from './email-template';
import { createEmailTrackingToken } from '@/lib/engagement';
import { MINDY_FROM_NAME } from '@/lib/mindy/email-branding';

const FROM_EMAIL = process.env.EMAIL_FROM || process.env.SMTP_USER || 'alerts@govcongiants.com';
const FROM_NAME = MINDY_FROM_NAME;

/**
 * Create nodemailer transporter
 */
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'alerts@govcongiants.com',
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

/**
 * Send briefing via email
 */
export async function sendBriefingEmail(
  briefing: GeneratedBriefing,
  toEmail: string
): Promise<DeliveryResult> {
  const smtpPassword = process.env.SMTP_PASSWORD;

  if (!smtpPassword) {
    console.error('[BriefingSender] SMTP password not configured');
    return {
      success: false,
      method: 'email',
      error: 'Email service not configured',
    };
  }

  const transporter = getTransporter();

  // Create email tracking token
  const tokenResult = await createEmailTrackingToken(toEmail, 'daily_briefing', briefing.briefingDate);
  const trackingToken = tokenResult?.token;

  const template = generateEmailTemplate(briefing, toEmail, trackingToken);

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: toEmail,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody,
    });

    // Record the delivery
    await recordDelivery({
      id: `delivery-${briefing.id}-email`,
      userId: briefing.userId,
      briefingId: briefing.id,
      deliveryMethod: 'email',
      status: 'sent',
      messageId: info.messageId,
      sentAt: new Date().toISOString(),
    });

    console.log(`[BriefingSender] Email sent to ${toEmail}: ${info.messageId}`);

    return {
      success: true,
      method: 'email',
      messageId: info.messageId,
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
