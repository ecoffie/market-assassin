import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
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
    <!doctype html>
    <html>
      <body style="margin:0; padding:0; background:#f4f7fb;">
        <span style="display:none !important; visibility:hidden; max-height:0; max-width:0; opacity:0; overflow:hidden; color:transparent;">
          Create a new password for Mindy.
        </span>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:#f4f7fb; margin:0; padding:0;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:640px; background:#ffffff; border-collapse:separate; border-spacing:0; font-family:Arial,Helvetica,sans-serif; color:#0f172a;">
                <tr>
                  <td align="center" bgcolor="#1e3a8a" style="background:#1e3a8a; background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%); padding:26px 24px; color:#ffffff;">
                    ${renderMindyEmailLogo(48)}
                    <div style="font-size:30px; line-height:1.12; margin:0 0 8px; font-weight:800;">Mindy</div>
                    <div style="font-size:15px; line-height:1.45; margin:0 auto; color:#e9e3ff; max-width:430px;">Federal opportunity alerts, briefings, forecasts, and capture intelligence.</div>
                  </td>
                </tr>
                <tr>
                  <td bgcolor="#ffffff" style="background:#ffffff; padding:28px 24px 34px;">
                    <div style="display:inline-block; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
                      Password reset
                    </div>
                    <h1 style="font-size:24px; line-height:1.25; margin:18px 0 12px; color:#0f172a; font-weight:800;">Choose a new Mindy password</h1>
                    <p style="font-size:16px; line-height:1.6; margin:0 0 22px; color:#334155;">
                      We received a request to reset your Mindy password. Use the secure button below to create a new password.
                    </p>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px;">
                      <tr>
                        <td style="padding:22px;">
                          <p style="font-size:14px; line-height:1.5; margin:0 0 18px; color:#475569;">
                            This link opens the Mindy reset page and lets you set a new password for email/password sign-in.
                          </p>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                            <tr>
                              <td align="center" bgcolor="#7c3aed" style="background:#7c3aed; background:linear-gradient(135deg,#3b82f6 0%,#7c3aed 100%); border-radius:10px;">
                                <a href="${resetUrl}" style="display:block; text-align:center; color:#ffffff; padding:16px 22px; text-decoration:none; font-size:16px; font-weight:800;">
                                  Reset Mindy password
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size:14px; line-height:1.6; margin:24px 0 16px; color:#64748b;">
                      After resetting, return to <strong style="color:#334155;">getmindy.ai/app</strong> and sign in with your email and new password.
                    </p>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-top:1px solid #e2e8f0; margin-top:24px;">
                      <tr>
                        <td style="padding-top:20px;">
                          <p style="font-size:13px; line-height:1.6; color:#64748b; margin:0 0 8px;">
                            Button not working? Paste this secure link into your browser:
                          </p>
                          <a href="${resetUrl}" style="color:#6d28d9; font-size:13px; line-height:1.5; word-break:break-all;">${resetUrl}</a>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size:13px; line-height:1.6; color:#64748b; margin:24px 0 0;">
                      If you did not request this reset, you can ignore this email. Your existing password will stay unchanged.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
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
        from: `"${process.env.MINDY_FROM_NAME || "Mindy"}" <${process.env.EMAIL_FROM || 'hello@getmindy.ai'}>`,
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
