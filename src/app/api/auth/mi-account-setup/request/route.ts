import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { sendEmail } from '@/lib/send-email';

const SETUP_SUCCESS_MESSAGE = 'If that email has Market Intelligence access, an account setup link is on the way.';

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
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
      <h1 style="font-size: 24px; margin-bottom: 12px;">Set up your Market Intelligence account</h1>
      <p style="font-size: 16px; line-height: 1.5;">
        Your GovCon Giants Market Intelligence access is ready. Set your password first, then sign in with email and password. Two-factor verification is optional for extra protection.
      </p>
      <p style="margin: 28px 0;">
        <a href="${setupUrl}" style="background: #059669; color: white; padding: 14px 22px; border-radius: 8px; text-decoration: none; font-weight: 700;">
          Set up my MI account
        </a>
      </p>
      <p style="font-size: 14px; line-height: 1.5; color: #6b7280;">
        If the button does not work, paste this link into your browser:<br>
        <a href="${setupUrl}" style="color: #059669;">${setupUrl}</a>
      </p>
      <p style="font-size: 14px; line-height: 1.5; color: #6b7280;">
        You received this because this email has access to GovCon Giants Market Intelligence.
      </p>
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

    const setupUrl = `${getBaseUrl(request)}/mi-beta/setup-password`;
    const link = await generateSetupLink(email, setupUrl);

    await sendEmail({
      to: email,
      subject: 'Set up your Market Intelligence account',
      html: buildSetupEmailHtml(link.url),
      text: `Set up your Market Intelligence account: ${link.url}`,
      emailType: 'mi_account_setup',
      eventSource: 'mi_beta_auth',
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
