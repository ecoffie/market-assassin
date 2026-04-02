/**
 * Briefing Delivery Sender
 *
 * Handles sending briefings via email and SMS.
 * Uses nodemailer for email, Twilio for SMS.
 */

import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import {
  GeneratedBriefing,
  DeliveryResult,
  BriefingDeliveryRecord,
  SMSMessage,
} from './types';
import { generateEmailTemplate } from './email-template';

const FROM_EMAIL = process.env.SMTP_USER || 'alerts@govcongiants.com';
const FROM_NAME = 'GovCon Giants';

/**
 * Get Twilio client
 */
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  return twilio(accountSid, authToken);
}

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
  const template = generateEmailTemplate(briefing, toEmail);

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
 * Send briefing via SMS using Twilio
 */
export async function sendBriefingSMS(
  briefing: GeneratedBriefing,
  phoneNumber: string
): Promise<DeliveryResult> {
  const twilioClient = getTwilioClient();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!twilioClient) {
    console.error('[BriefingSender] Twilio not configured (missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN)');
    return {
      success: false,
      method: 'sms',
      error: 'SMS service not configured',
    };
  }

  if (!fromNumber && !messagingServiceSid) {
    console.error('[BriefingSender] No TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID configured');
    return {
      success: false,
      method: 'sms',
      error: 'SMS sender not configured',
    };
  }

  // Normalize phone number (ensure E.164 format)
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) {
    console.error(`[BriefingSender] Invalid phone number: ${phoneNumber}`);
    return {
      success: false,
      method: 'sms',
      error: 'Invalid phone number format',
    };
  }

  const smsMessage = generateSMSMessage(briefing);

  try {
    // Use Messaging Service SID if available, otherwise use phone number
    const messageOptions: {
      body: string;
      to: string;
      from?: string;
      messagingServiceSid?: string;
    } = {
      body: smsMessage.body,
      to: normalizedPhone,
    };

    if (messagingServiceSid) {
      messageOptions.messagingServiceSid = messagingServiceSid;
    } else {
      messageOptions.from = fromNumber;
    }

    const message = await twilioClient.messages.create(messageOptions);

    // Record the delivery
    await recordDelivery({
      id: `delivery-${briefing.id}-sms`,
      userId: briefing.userId,
      briefingId: briefing.id,
      deliveryMethod: 'sms',
      status: 'sent',
      messageId: message.sid,
      sentAt: new Date().toISOString(),
    });

    console.log(`[BriefingSender] SMS sent to ${normalizedPhone}: ${message.sid}`);

    return {
      success: true,
      method: 'sms',
      messageId: message.sid,
      deliveredAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[BriefingSender] Error sending SMS:`, error);

    // Record failed delivery
    await recordDelivery({
      id: `delivery-${briefing.id}-sms`,
      userId: briefing.userId,
      briefingId: briefing.id,
      deliveryMethod: 'sms',
      status: 'failed',
      sentAt: new Date().toISOString(),
      error: String(error),
    });

    return {
      success: false,
      method: 'sms',
      error: String(error),
    };
  }
}

/**
 * Normalize phone number to E.164 format
 * Handles common US formats: (555) 123-4567, 555-123-4567, 5551234567, +15551234567
 */
function normalizePhoneNumber(phone: string): string | null {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Already in E.164 format
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    return cleaned;
  }

  // Has + but not +1 (international)
  if (cleaned.startsWith('+')) {
    return cleaned.length >= 10 ? cleaned : null;
  }

  // US number without country code
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  // US number with leading 1
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  return null;
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
