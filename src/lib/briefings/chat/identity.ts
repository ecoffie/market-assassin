/**
 * Phone-to-Email Identity Resolution
 *
 * Links phone numbers to GovCon user accounts.
 * Flow: User texts "LINK email@example.com" → code sent to email → user texts code back → linked.
 * Uses Vercel KV for fast lookups.
 */

import { kv } from '@vercel/kv';
import nodemailer from 'nodemailer';
import type { PhoneLinkRecord } from './types';

/**
 * Resolve a phone number to a user email
 * Returns the email if the phone is linked and verified
 */
export async function resolveUserByPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const record = await kv.get<PhoneLinkRecord>(`phone:${normalized}`);
  if (record && record.verified) {
    return record.email;
  }

  return null;
}

/**
 * Start the phone linking process
 * Generates a 6-digit code, stores it in KV, and emails it to the user
 */
export async function linkPhoneToEmail(
  phone: string,
  email: string
): Promise<{ success: boolean; error?: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number format' };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if this email has briefing access
  const briefingAccess = await kv.get(`briefings:${normalizedEmail}`);
  if (!briefingAccess) {
    return {
      success: false,
      error: 'This email does not have briefing access. Purchase a qualifying product at shop.govcongiants.org',
    };
  }

  // Generate 6-digit verification code
  const code = generateVerificationCode();

  // Store the pending link in KV (expires in 15 minutes)
  const record: PhoneLinkRecord = {
    phone: normalized,
    email: normalizedEmail,
    verificationCode: code,
    verified: false,
    createdAt: new Date().toISOString(),
  };

  await kv.set(`phone:pending:${normalized}`, record, { ex: 900 }); // 15 min expiry

  // Send verification code to email
  const emailSent = await sendVerificationEmail(normalizedEmail, code);
  if (!emailSent) {
    return { success: false, error: 'Failed to send verification email' };
  }

  return { success: true };
}

/**
 * Verify a phone link with the code from email
 */
export async function verifyPhoneLink(
  phone: string,
  code: string
): Promise<{ success: boolean; email?: string; error?: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number' };
  }

  // Get the pending link
  const pending = await kv.get<PhoneLinkRecord>(`phone:pending:${normalized}`);
  if (!pending) {
    return { success: false, error: 'No pending link found. Text LINK your@email.com to start.' };
  }

  // Check the code
  if (pending.verificationCode !== code.trim()) {
    return { success: false, error: 'Invalid code. Check your email and try again.' };
  }

  // Mark as verified and store permanent link
  const verifiedRecord: PhoneLinkRecord = {
    ...pending,
    verified: true,
    verifiedAt: new Date().toISOString(),
  };

  // Store permanent phone→email mapping (no expiry)
  await kv.set(`phone:${normalized}`, verifiedRecord);

  // Also store reverse lookup email→phone
  await kv.set(`phone:reverse:${pending.email}`, normalized);

  // Clean up pending record
  await kv.del(`phone:pending:${normalized}`);

  return { success: true, email: pending.email };
}

/**
 * Unlink a phone number
 */
export async function unlinkPhone(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const record = await kv.get<PhoneLinkRecord>(`phone:${normalized}`);
  if (record) {
    await kv.del(`phone:${normalized}`);
    await kv.del(`phone:reverse:${record.email}`);
    return true;
  }

  return false;
}

/**
 * Generate a 6-digit verification code
 */
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send verification code via email
 */
async function sendVerificationEmail(email: string, code: string): Promise<boolean> {
  const smtpPassword = process.env.SMTP_PASSWORD;
  if (!smtpPassword) {
    console.error('[ChatIdentity] SMTP not configured');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'alerts@govcongiants.com',
      pass: smtpPassword,
    },
  });

  try {
    await transporter.sendMail({
      from: `"GovCon Giants" <${process.env.SMTP_USER || 'alerts@govcongiants.com'}>`,
      to: email,
      subject: `Your GovCon Briefing Bot Code: ${code}`,
      text: `Your verification code is: ${code}\n\nText this code back to the GovCon Giants number to link your account.\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a2e;">GovCon Briefing Bot</h2>
          <p>Your verification code is:</p>
          <div style="background: #f0f0f0; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">${code}</span>
          </div>
          <p>Text this code back to the GovCon Giants number to link your account.</p>
          <p style="color: #666; font-size: 13px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    console.log(`[ChatIdentity] Verification code sent to ${email}`);
    return true;
  } catch (error) {
    console.error(`[ChatIdentity] Failed to send verification email:`, error);
    return false;
  }
}

/**
 * Normalize phone to E.164 format
 */
function normalizePhone(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+1') && cleaned.length === 12) return cleaned;
  if (cleaned.startsWith('+') && cleaned.length >= 10) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;

  return null;
}
