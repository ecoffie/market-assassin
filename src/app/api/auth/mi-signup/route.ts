import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveMx } from 'dns/promises';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
import { sendEmail } from '@/lib/send-email';

export const runtime = 'nodejs';

const SUCCESS_MESSAGE = 'Check your inbox for a link to set up your account.';
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const MAX_SIGNUP_ATTEMPTS = 5;
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  'anonaddy.com',
  'dispostable.com',
  'fakeinbox.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'moakt.com',
  'sharklasers.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);
const signupAttempts = new Map<string, { count: number; resetAt: number }>();

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function getSupabaseAuthRedirectUrl(path: string): string {
  // Use mi.govcongiants.com as the beta redirect until getmindy.ai/app is ready.
  const authRedirectOrigin = process.env.MINDY_AUTH_REDIRECT_ORIGIN || process.env.SUPABASE_AUTH_REDIRECT_ORIGIN || 'https://mi.govcongiants.com';
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

function getClientKey(request: NextRequest, email: string): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || request.headers.get('x-real-ip') || 'unknown';
  return `${ip}:${email}`;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const attempt = signupAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    signupAttempts.set(key, { count: 1, resetAt: now + SIGNUP_WINDOW_MS });
    return false;
  }

  attempt.count += 1;
  signupAttempts.set(key, attempt);
  return attempt.count > MAX_SIGNUP_ATTEMPTS;
}

async function generateSetupLink(email: string, redirectTo: string): Promise<{ url: string; type: string }> {
  const supabase = getSupabaseAdmin();

  // Try invite first (for new users)
  const invite = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });

  const inviteUrl = invite.data?.properties?.action_link;
  if (!invite.error && inviteUrl) {
    return { url: inviteUrl, type: 'invite' };
  }

  // Fall back to recovery (for existing users)
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

async function validateSignupEmail(email: string): Promise<string | null> {
  const emailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
  if (!emailRegex.test(email)) {
    return 'Invalid email format';
  }

  const domain = email.split('@')[1];
  if (!domain || DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return 'Please use a permanent work email address';
  }

  if (process.env.MINDY_SKIP_MX_CHECK === 'true') {
    return null;
  }

  try {
    const records = await resolveMx(domain);
    if (!records.length) {
      return 'Please use an email address that can receive mail';
    }
  } catch (error) {
    console.warn('[Mindy Signup] Email domain MX check failed:', { domain, error });
    return 'Please use an email address that can receive mail';
  }

  return null;
}

function buildWelcomeEmailHtml(setupUrl: string): string {
  return `
    <div style="margin:0; padding:0; background:#f4f7fb;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Welcome to Mindy - Your AI-powered federal market intelligence assistant.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#07111f; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(15,23,42,0.16);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#7c3aed 0%,#a855f7 55%,#c084fc 100%); color:#ffffff; text-align:center;">
            ${renderMindyEmailLogo(58)}
            <div style="font-size:13px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; opacity:0.82;">Welcome to</div>
            <h1 style="font-size:36px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Mindy</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#e9d5ff;">
              Your AI-powered federal market intelligence assistant.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <div style="display:inline-block; background:#f3e8ff; color:#7c3aed; border:1px solid #ddd6fe; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
              Free Account
            </div>
            <h2 style="font-size:28px; line-height:1.2; margin:18px 0 12px; color:#0f172a; font-weight:800;">Set up your password</h2>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              Click below to create your password and start using Mindy. Your free account includes:
            </p>

            <ul style="font-size:15px; line-height:1.8; color:#334155; margin:0 0 22px; padding-left:20px;">
              <li><strong>Daily Federal Opportunities</strong> — matching your NAICS codes</li>
              <li><strong>Market Research</strong> — 4 standard reports, 5/month</li>
              <li><strong>Opportunity Search</strong> — real-time SAM.gov data</li>
            </ul>

            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:22px; margin:26px 0;">
              <p style="font-size:14px; line-height:1.5; margin:0 0 18px; color:#475569;">
                This secure link will set up your Mindy account.
              </p>
              <a href="${setupUrl}" style="display:block; text-align:center; background:#7c3aed; color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
                Create my password
              </a>
            </div>

            <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:10px; padding:16px; margin:24px 0;">
              <p style="font-size:14px; line-height:1.5; margin:0; color:#7c3aed;">
                <strong>Want AI-powered briefings?</strong> Upgrade to Mindy Pro for daily AI analysis, 7,700+ forecasts, and capture intelligence.
              </p>
            </div>

            <div style="border-top:1px solid #e2e8f0; padding-top:20px; margin-top:24px;">
              <p style="font-size:13px; line-height:1.6; color:#64748b; margin:0 0 8px;">
                Button not working? Paste this secure link into your browser:
              </p>
              <a href="${setupUrl}" style="color:#7c3aed; font-size:13px; line-height:1.5; word-break:break-all;">${setupUrl}</a>
            </div>

            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:24px 0 0;">
              You received this because you signed up for a free Mindy account.
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

    if (isRateLimited(getClientKey(request, email))) {
      return NextResponse.json({ success: false, error: 'Too many signup attempts. Please try again later.' }, { status: 429 });
    }

    const emailError = await validateSignupEmail(email);
    if (emailError) {
      return NextResponse.json({ success: false, error: emailError }, { status: 400 });
    }

    // Generate setup link
    const setupUrl = getSupabaseAuthRedirectUrl('/app/setup-password');
    const link = await generateSetupLink(email, setupUrl);

    // Send welcome email
    await sendEmail({
      to: email,
      subject: 'Welcome to Mindy — Set up your password',
      html: buildWelcomeEmailHtml(link.url),
      text: `Welcome to Mindy! Set up your password: ${link.url}`,
      emailType: 'mindy_free_signup',
      eventSource: 'mindy_signup',
      tags: {
        type: 'mindy_free_signup',
        link: link.type,
      },
      metadata: {
        email,
        linkType: link.type,
        tier: 'free',
      },
    });

    return NextResponse.json({ success: true, message: SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[Mindy Signup] Failed to create account:', error);
    return NextResponse.json({ success: false, error: 'Unable to create account' }, { status: 500 });
  }
}
