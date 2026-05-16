import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const RESET_SUCCESS_MESSAGE = 'If a Mindy account exists for that email, a reset link is on the way.';

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function getSupabaseAuthRedirectUrl(path: string): string {
  const authRedirectOrigin = process.env.MINDY_AUTH_REDIRECT_ORIGIN || process.env.SUPABASE_AUTH_REDIRECT_ORIGIN || 'https://getmindy.ai';
  return `${authRedirectOrigin.replace(/\/$/, '')}${path}`;
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
    <div style="margin:0; padding:0; background:#f4f7fb;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Create a new password for Mindy.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#07111f; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(15,23,42,0.16);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#062f2a 0%,#0b7a5a 55%,#10b981 100%); color:#ffffff;">
            <div style="font-size:13px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; opacity:0.82;">Mindy</div>
            <h1 style="font-size:32px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Mindy</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#d7ffef;">
              Federal opportunity alerts, briefings, forecasts, and capture intelligence.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <div style="display:inline-block; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
              Password reset
            </div>
            <h2 style="font-size:28px; line-height:1.2; margin:18px 0 12px; color:#0f172a; font-weight:800;">Choose a new Mindy password</h2>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              We received a request to reset your Mindy password. Use the secure button below to create a new password.
            </p>

            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:22px; margin:26px 0;">
              <p style="font-size:14px; line-height:1.5; margin:0 0 18px; color:#475569;">
                This link opens the Mindy reset page and lets you set a new password for email/password sign-in.
              </p>
              <a href="${resetUrl}" style="display:block; text-align:center; background:#059669; color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
                Reset Mindy password
              </a>
            </div>

            <p style="font-size:14px; line-height:1.6; margin:0 0 16px; color:#64748b;">
              After resetting, return to <strong style="color:#334155;">getmindy.ai/app</strong> and sign in with your email and new password.
            </p>

            <div style="border-top:1px solid #e2e8f0; padding-top:20px; margin-top:24px;">
              <p style="font-size:13px; line-height:1.6; color:#64748b; margin:0 0 8px;">
                Button not working? Paste this secure link into your browser:
              </p>
              <a href="${resetUrl}" style="color:#047857; font-size:13px; line-height:1.5; word-break:break-all;">${resetUrl}</a>
            </div>

            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:24px 0 0;">
              If you did not request this reset, you can ignore this email. Your existing password will stay unchanged.
            </p>
          </div>
        </div>
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

    const redirectTo = getSupabaseAuthRedirectUrl('/app/reset-password');
    const resetUrl = await generatePasswordResetLink(email, redirectTo);

    if (resetUrl) {
      await sendEmail({
        to: email,
        from: `Mindy <${process.env.EMAIL_FROM || 'hello@getmindy.ai'}>`,
        subject: 'Reset your Mindy password',
        html: buildResetEmailHtml(resetUrl),
        text: `Reset your Mindy password: ${resetUrl}`,
        emailType: 'mi_password_reset',
        eventSource: 'mindy_auth',
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
