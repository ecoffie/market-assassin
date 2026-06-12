/**
 * Passwordless sign-in via Supabase magic link — Canva-style "email me a link".
 * Shared by /api/auth/mi-magic-link/request so routes and crons behave identically.
 */
import { createClient } from '@supabase/supabase-js';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
import { sendEmail } from '@/lib/send-email';
import { ensureAuthUserForEmail, findAuthUserByEmail, isKnownMindyAccount } from '@/lib/mindy/known-accounts';

export const MAGIC_LINK_SUCCESS_MESSAGE =
  'If that email has Mindy access, a sign-in link is on the way. Check your inbox and click the link to open Mindy.';

export function getMagicLinkRedirectUrl(): string {
  const origin =
    process.env.MINDY_AUTH_REDIRECT_ORIGIN ||
    process.env.SUPABASE_AUTH_REDIRECT_ORIGIN ||
    'https://getmindy.ai';
  return `${origin.replace(/\/$/, '')}/app`;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Supabase service role is not configured');
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function generateMagicLinkSignIn(email: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const redirectTo = getMagicLinkRedirectUrl();

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  const url = data?.properties?.action_link;
  if (error || !url) {
    throw new Error(error?.message || 'Unable to generate sign-in link');
  }

  return url;
}

export function buildMagicLinkEmailHtml(signInUrl: string): string {
  return `
    <div style="margin:0; padding:0; background:#f4f4f8;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Your secure Mindy sign-in link.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#0b1020; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(30,23,80,0.18);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%); color:#ffffff; text-align:center;">
            ${renderMindyEmailLogo(58)}
            <h1 style="font-size:32px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Mindy</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#e9e3ff;">
              Your 24/7 federal market intelligence analyst.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <div style="display:inline-block; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
              Sign in
            </div>
            <h2 style="font-size:28px; line-height:1.2; margin:18px 0 12px; color:#0f172a; font-weight:800;">Open Mindy</h2>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              Click the button below to sign in. No password needed — this secure link opens your Mindy workspace directly.
            </p>

            <div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:14px; padding:22px; margin:26px 0;">
              <a href="${signInUrl}" style="display:block; text-align:center; background:linear-gradient(135deg,#3b82f6 0%,#7c3aed 100%); color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
                Open Mindy
              </a>
            </div>

            <p style="font-size:14px; line-height:1.6; margin:0 0 16px; color:#64748b;">
              This link expires after a short time. If it stops working, go to <strong style="color:#334155;">getmindy.ai/app</strong> and request a fresh one.
            </p>

            <div style="border-top:1px solid #e2e8f0; padding-top:20px; margin-top:24px;">
              <p style="font-size:13px; line-height:1.6; color:#64748b; margin:0 0 8px;">
                Button not working? Paste this link into your browser:
              </p>
              <a href="${signInUrl}" style="color:#6d28d9; font-size:13px; line-height:1.5; word-break:break-all;">${signInUrl}</a>
            </div>

            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:24px 0 0;">
              If you did not request this, you can ignore this email.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Send a magic sign-in link when the email has Mindy access or an auth account.
 * Returns entitled:false for unknown emails so the UI can route to free signup.
 */
export async function sendMagicLinkSignIn(email: string): Promise<{ entitled: boolean }> {
  const known = await isKnownMindyAccount(email);
  const hasAuthUser = Boolean(await findAuthUserByEmail(email));

  if (!known && !hasAuthUser) {
    return { entitled: false };
  }

  await ensureAuthUserForEmail(email);
  const signInUrl = await generateMagicLinkSignIn(email);

  await sendEmail({
    to: email,
    subject: 'Your Mindy sign-in link',
    html: buildMagicLinkEmailHtml(signInUrl),
    text: `Open Mindy: ${signInUrl}`,
    emailType: 'mindy_magic_link',
    eventSource: 'mindy_auth',
    tags: { type: 'mindy_magic_link' },
    metadata: { email },
  });

  return { entitled: true };
}
