import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const RESET_SUCCESS_MESSAGE = 'If an MI account exists for that email, a reset link is on the way.';

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function getBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service role is not configured');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function generatePasswordResetLink(email: string, redirectTo: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('not found') || message.includes('user')) {
      return null;
    }
    throw new Error(error.message);
  }

  return data?.properties?.action_link || null;
}

function buildResetEmailHtml(resetUrl: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #064e3b, #059669); color: #ffffff; padding: 34px 32px; border-radius: 16px 16px 0 0;">
        <div style="font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.85;">GovCon Giants</div>
        <h1 style="font-size: 30px; line-height: 1.15; margin: 10px 0 0;">Market Intelligence</h1>
        <p style="font-size: 16px; line-height: 1.5; margin: 10px 0 0; opacity: 0.9;">Federal opportunity alerts, briefings, forecasts, and capture intelligence.</p>
      </div>
      <div style="border: 1px solid #d1d5db; border-top: 0; border-radius: 0 0 16px 16px; padding: 32px;">
        <h2 style="font-size: 24px; margin: 0 0 14px; color: #0f172a;">Reset your MI password</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 22px; color: #334155;">
          We received a request to reset your Market Intelligence password. Use the secure link below to create a new password.
        </p>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 26px; color: #334155;">
          After resetting, you will sign in with email and password. Two-factor verification is optional for extra protection.
        </p>
        <p style="margin: 30px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #059669; color: white; padding: 15px 24px; border-radius: 10px; text-decoration: none; font-weight: 700;">
            Reset MI password
          </a>
        </p>
        <p style="font-size: 14px; line-height: 1.5; color: #64748b; margin: 26px 0 0;">
          If the button does not work, paste this link into your browser:<br>
          <a href="${resetUrl}" style="color: #059669; word-break: break-all;">${resetUrl}</a>
        </p>
        <p style="font-size: 14px; line-height: 1.5; color: #64748b; margin: 24px 0 0;">
          If you did not request this reset, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const redirectTo = `${getBaseUrl(request)}/mi-beta/reset-password`;
    const resetUrl = await generatePasswordResetLink(email, redirectTo);

    if (resetUrl) {
      await sendEmail({
        to: email,
        from: `GovCon Giants Market Intelligence <${process.env.EMAIL_FROM || 'alerts@govcongiants.com'}>`,
        subject: 'Reset your Market Intelligence password',
        html: buildResetEmailHtml(resetUrl),
        text: `Reset your Market Intelligence password: ${resetUrl}`,
        emailType: 'mi_password_reset',
        eventSource: 'mi_beta_auth',
        tags: {
          type: 'mi_password_reset',
        },
        metadata: {
          email,
        },
      });
    }

    return NextResponse.json({ success: true, message: RESET_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[MI Password Reset] Failed to send reset link:', error);
    return NextResponse.json({ success: false, error: 'Unable to send reset link' }, { status: 500 });
  }
}
