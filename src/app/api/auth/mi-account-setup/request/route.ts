import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
import { sendEmail } from '@/lib/send-email';

const SETUP_SUCCESS_MESSAGE = 'If that email has Mindy access, an account setup link is on the way.';

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

function hasSetupEntitlement(access: Awaited<ReturnType<typeof verifyMIAccess>>): boolean {
  return access.tier !== 'none';
}

async function generateSetupLink(email: string, redirectTo: string): Promise<{ url: string; type: string }> {
  const supabase = getSupabaseAdmin();

  const invite = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });

  const inviteUrl = invite.data?.properties?.action_link;
  if (!invite.error && inviteUrl) {
    return { url: inviteUrl, type: 'invite' };
  }

  const recovery = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  const recoveryUrl = recovery.data?.properties?.action_link;
  if (!recovery.error && recoveryUrl) {
    return { url: recoveryUrl, type: 'recovery' };
  }

  throw new Error(recovery.error?.message || invite.error?.message || 'Unable to generate setup link');
}

function buildSetupEmailHtml(setupUrl: string): string {
  return `
    <div style="margin:0; padding:0; background:#f4f7fb;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Your Mindy account is ready.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#07111f; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(15,23,42,0.16);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#062f2a 0%,#0b7a5a 55%,#10b981 100%); color:#ffffff; text-align:center;">
            ${renderMindyEmailLogo(58)}
            <h1 style="font-size:32px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Mindy</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#d7ffef;">
              Federal opportunity alerts, briefings, forecasts, and capture intelligence.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <div style="display:inline-block; background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
              Account setup
            </div>
            <h2 style="font-size:28px; line-height:1.2; margin:18px 0 12px; color:#0f172a; font-weight:800;">Your Mindy access is ready</h2>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              Set your Mindy password first. After that, you will sign in with your email and password to access your Mindy workspace.
            </p>

            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:22px; margin:26px 0;">
              <p style="font-size:14px; line-height:1.5; margin:0 0 18px; color:#475569;">
                This secure setup link opens the Mindy password page for your account.
              </p>
              <a href="${setupUrl}" style="display:block; text-align:center; background:#059669; color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
                Set up my Mindy account
              </a>
            </div>

            <p style="font-size:14px; line-height:1.6; margin:0 0 16px; color:#64748b;">
              Two-factor verification is optional after setup. Your workspace lives at <strong style="color:#334155;">getmindy.ai/app</strong>.
            </p>

            <div style="border-top:1px solid #e2e8f0; padding-top:20px; margin-top:24px;">
              <p style="font-size:13px; line-height:1.6; color:#64748b; margin:0 0 8px;">
                Button not working? Paste this secure link into your browser:
              </p>
              <a href="${setupUrl}" style="color:#047857; font-size:13px; line-height:1.5; word-break:break-all;">${setupUrl}</a>
            </div>

            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:24px 0 0;">
              You received this because this email has access to Mindy.
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

    const access = await verifyMIAccess(email);
    if (!hasSetupEntitlement(access)) {
      return NextResponse.json({ success: true, message: SETUP_SUCCESS_MESSAGE });
    }

    const setupUrl = getSupabaseAuthRedirectUrl('/app/setup-password');
    const link = await generateSetupLink(email, setupUrl);

    await sendEmail({
      to: email,
      subject: 'Set up your Mindy account',
      html: buildSetupEmailHtml(link.url),
      text: `Set up your Mindy account: ${link.url}`,
      emailType: 'mi_account_setup',
      eventSource: 'mindy_auth',
      tags: {
        type: 'mi_account_setup',
        link: link.type,
      },
      metadata: {
        email,
        linkType: link.type,
        tier: access.tier,
        staffRole: access.staffRole || 'none',
      },
    });

    return NextResponse.json({ success: true, message: SETUP_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[MI Account Setup] Failed to send setup link:', error);
    return NextResponse.json({ success: false, error: 'Unable to send setup link' }, { status: 500 });
  }
}
