/**
 * Briefing Delivery Sender
 *
 * Handles sending briefings via email (and SMS in the future).
 * Uses nodemailer for email delivery.
 */

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import {
  GeneratedBriefing,
  DeliveryResult,
  BriefingDeliveryRecord,
  SMSMessage,
} from './types';
import { generateEmailTemplate } from './email-template';

const FROM_EMAIL = process.env.SMTP_USER || 'hello@govconedu.com';
const FROM_NAME = 'GovCon Giants';

/**
 * Create nodemailer transporter
 */
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || 'hello@govconedu.com',
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
  const template = generateEmailTemplate(briefing);

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
 * Generate SMS message from briefing (truncated for SMS limits)
 */
export function generateSMSMessage(briefing: GeneratedBriefing): SMSMessage {
  const MAX_SMS_LENGTH = 160;

  const urgentCount = briefing.summary.urgentAlerts;
  const totalItems = briefing.totalItems;

  let body = `GovCon Briefing: `;

  if (urgentCount > 0) {
    body += `${urgentCount} urgent alert${urgentCount > 1 ? 's' : ''}, `;
  }

  body += `${totalItems} total items. `;

  // Add first item headline if space allows
  const firstItem = briefing.topItems[0]?.items[0];
  if (firstItem) {
    const headline = firstItem.title.substring(0, 60);
    body += `Top: ${headline}`;
  }

  body += ' View: shop.govcongiants.org/briefings';

  const truncated = body.length > MAX_SMS_LENGTH;

  return {
    body: body.substring(0, MAX_SMS_LENGTH),
    truncated,
  };
}

/**
 * Send briefing via SMS (placeholder - implement with Twilio later)
 */
export async function sendBriefingSMS(
  briefing: GeneratedBriefing,
  phoneNumber: string
): Promise<DeliveryResult> {
  // TODO: Implement Twilio integration for SMS
  console.log(`[BriefingSender] SMS delivery not yet implemented`);

  return {
    success: false,
    method: 'sms',
    error: 'SMS delivery not yet implemented',
  };
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
 * Send briefing to user based on their preferences
 */
export async function deliverBriefing(
  briefing: GeneratedBriefing,
  config: {
    email: string;
    phone?: string;
    method: 'email' | 'sms' | 'both';
  }
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  if (config.method === 'email' || config.method === 'both') {
    const emailResult = await sendBriefingEmail(briefing, config.email);
    results.push(emailResult);
  }

  if ((config.method === 'sms' || config.method === 'both') && config.phone) {
    const smsResult = await sendBriefingSMS(briefing, config.phone);
    results.push(smsResult);
  }

  return results;
}
