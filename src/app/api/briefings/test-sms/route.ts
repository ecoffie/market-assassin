/**
 * Test SMS Delivery
 *
 * Sends a test SMS to verify Twilio configuration.
 * Protected by admin password.
 */

import { NextResponse } from 'next/server';
import twilio from 'twilio';

const ADMIN_PASSWORD = 'galata-assassin-2026';

export async function POST(request: Request) {
  const body = await request.json();
  const { password, phone } = body;

  // Verify admin access
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!phone) {
    return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  // Check configuration
  const config = {
    accountSid: accountSid ? `${accountSid.slice(0, 6)}...` : 'NOT SET',
    authToken: authToken ? '***configured***' : 'NOT SET',
    fromNumber: fromNumber || 'NOT SET',
    messagingServiceSid: messagingServiceSid || 'NOT SET',
  };

  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    return NextResponse.json({
      error: 'Twilio not configured',
      config,
      missingVars: [
        !accountSid && 'TWILIO_ACCOUNT_SID',
        !authToken && 'TWILIO_AUTH_TOKEN',
        (!fromNumber && !messagingServiceSid) && 'TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
      ].filter(Boolean),
    }, { status: 500 });
  }

  // Normalize phone number
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    return NextResponse.json({
      error: 'Invalid phone number format',
      received: phone,
      hint: 'Use format: (555) 123-4567, 555-123-4567, or +15551234567',
    }, { status: 400 });
  }

  try {
    const client = twilio(accountSid, authToken);

    // Use Messaging Service SID if available, otherwise use phone number
    const messageOptions: {
      body: string;
      to: string;
      from?: string;
      messagingServiceSid?: string;
    } = {
      body: 'GovCon Giants Test: Your SMS briefings are configured correctly! Reply STOP to opt out.',
      to: normalizedPhone,
    };

    if (messagingServiceSid) {
      messageOptions.messagingServiceSid = messagingServiceSid;
    } else {
      messageOptions.from = fromNumber;
    }

    const message = await client.messages.create(messageOptions);

    console.log(`[TestSMS] Sent to ${normalizedPhone}: ${message.sid}`);

    return NextResponse.json({
      success: true,
      messageId: message.sid,
      to: normalizedPhone,
      from: messagingServiceSid ? `MessagingService:${messagingServiceSid}` : fromNumber,
      status: message.status,
    });
  } catch (error) {
    console.error('[TestSMS] Error:', error);

    return NextResponse.json({
      error: 'Failed to send SMS',
      details: String(error),
      config,
    }, { status: 500 });
  }
}

/**
 * GET /api/briefings/test-sms?password=xxx
 * Returns Twilio configuration status (no SMS sent)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  const hasSender = !!(fromNumber || messagingServiceSid);

  return NextResponse.json({
    configured: !!(accountSid && authToken && hasSender),
    accountSid: accountSid ? `${accountSid.slice(0, 6)}...${accountSid.slice(-4)}` : null,
    authToken: authToken ? '***configured***' : null,
    fromNumber: fromNumber || null,
    messagingServiceSid: messagingServiceSid || null,
    senderType: messagingServiceSid ? 'MessagingService' : (fromNumber ? 'PhoneNumber' : null),
    missingVars: [
      !accountSid && 'TWILIO_ACCOUNT_SID',
      !authToken && 'TWILIO_AUTH_TOKEN',
      !hasSender && 'TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
    ].filter(Boolean),
  });
}

function normalizePhoneNumber(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    return cleaned;
  }

  if (cleaned.startsWith('+')) {
    return cleaned.length >= 10 ? cleaned : null;
  }

  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  return null;
}
