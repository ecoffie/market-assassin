/**
 * Shared account-setup-email logic. ONE place that generates the Supabase setup
 * link + renders the email + sends it, so the single-request route
 * (/api/auth/mi-account-setup/request) AND the batch cron
 * (/api/cron/setup-invite-batch) behave identically. (Rule #7: extract per-record
 * logic into a shared lib so route + script reuse it.)
 */
import { createClient } from '@supabase/supabase-js';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';
import { sendEmail } from '@/lib/send-email';

export function getSetupRedirectUrl(): string {
  const origin =
    process.env.MINDY_AUTH_REDIRECT_ORIGIN ||
    process.env.SUPABASE_AUTH_REDIRECT_ORIGIN ||
    'https://getmindy.ai';
  return `${origin.replace(/\/$/, '')}/app/setup-password`;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Supabase service role is not configured');
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Generate a Supabase invite (preferred) or recovery setup link for the email. */
export async function generateSetupLink(email: string, redirectTo: string): Promise<{ url: string; type: string }> {
  const supabase = getSupabaseAdmin();

  const invite = await supabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });
  const inviteUrl = invite.data?.properties?.action_link;
  if (!invite.error && inviteUrl) return { url: inviteUrl, type: 'invite' };

  const recovery = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  const recoveryUrl = recovery.data?.properties?.action_link;
  if (!recovery.error && recoveryUrl) return { url: recoveryUrl, type: 'recovery' };

  throw new Error(recovery.error?.message || invite.error?.message || 'Unable to generate setup link');
}

// Mindy brand palette (matches the "M" mark #5928c2 + the other Mindy emails):
// Navy #1e3a8a → Purple #7c3aed gradient, purple #7c3aed accents, blue→purple CTA.
export function buildSetupEmailHtml(setupUrl: string): string {
  return `
    <div style="margin:0; padding:0; background:#f4f4f8;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Your Mindy account is ready.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#0b1020; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(30,23,80,0.18);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%); color:#ffffff; text-align:center;">
            ${renderMindyEmailLogo(58)}
            <h1 style="font-size:32px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Mindy</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#e9e3ff;">
              Federal opportunity alerts, briefings, forecasts, and capture intelligence.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <div style="display:inline-block; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; border-radius:999px; padding:7px 12px; font-size:12px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase;">
              Account setup
            </div>
            <h2 style="font-size:28px; line-height:1.2; margin:18px 0 12px; color:#0f172a; font-weight:800;">Your Mindy access is ready</h2>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              Set your Mindy password first. After that, you will sign in with your email and password to access your Mindy workspace.
            </p>

            <div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:14px; padding:22px; margin:26px 0;">
              <p style="font-size:14px; line-height:1.5; margin:0 0 18px; color:#475569;">
                This secure setup link opens the Mindy password page for your account.
              </p>
              <a href="${setupUrl}" style="display:block; text-align:center; background:linear-gradient(135deg,#3b82f6 0%,#7c3aed 100%); color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
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
              <a href="${setupUrl}" style="color:#6d28d9; font-size:13px; line-height:1.5; word-break:break-all;">${setupUrl}</a>
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

/**
 * Generate the setup link + send the account-setup email to one user.
 * Returns the link type used. Throws on link-generation / send failure so the
 * caller can record it.
 */
export async function sendSetupInvite(
  email: string,
  opts: { tier?: string; staffRole?: string } = {},
): Promise<{ linkType: string }> {
  const setupUrl = getSetupRedirectUrl();
  const link = await generateSetupLink(email, setupUrl);

  await sendEmail({
    to: email,
    subject: 'Set up your Mindy account',
    html: buildSetupEmailHtml(link.url),
    text: `Set up your Mindy account: ${link.url}`,
    emailType: 'mi_account_setup',
    eventSource: 'mindy_auth',
    tags: { type: 'mi_account_setup', link: link.type },
    metadata: {
      email,
      linkType: link.type,
      tier: opts.tier || 'unknown',
      staffRole: opts.staffRole || 'none',
    },
  });

  return { linkType: link.type };
}

/** The sharp zero-alert message — names the actual reason they're getting nothing
 *  (a default/placeholder profile), in Mindy brand colors. Same setup link. */
function buildZeroAlertNudgeHtml(setupUrl: string): string {
  return `
    <div style="margin:0; padding:0; background:#f4f4f8;">
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        Your Mindy alerts are empty because your profile still uses placeholder codes.
      </div>
      <div style="font-family: Arial, Helvetica, sans-serif; max-width:680px; margin:0 auto; padding:32px 18px; color:#0f172a;">
        <div style="background:#0b1020; border-radius:18px; overflow:hidden; box-shadow:0 18px 45px rgba(30,23,80,0.18);">
          <div style="padding:34px 34px 30px; background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%); color:#ffffff; text-align:center;">
            ${renderMindyEmailLogo(58)}
            <h1 style="font-size:30px; line-height:1.12; margin:12px 0 8px; font-weight:800;">Your alerts are coming up empty</h1>
            <p style="font-size:16px; line-height:1.5; margin:0; color:#e9e3ff;">
              Let's fix that in 60 seconds.
            </p>
          </div>

          <div style="background:#ffffff; padding:34px;">
            <p style="font-size:16px; line-height:1.65; margin:0 0 16px; color:#334155;">
              We've been scanning federal opportunities for you — but you haven't been
              matching any, because your profile is still on <strong>placeholder industry
              codes</strong> from sign-up, not the ones for <em>your</em> business.
            </p>
            <p style="font-size:16px; line-height:1.65; margin:0 0 22px; color:#334155;">
              Tell Mindy what you actually do (one sentence is enough) and she'll set your
              real codes + keywords. Then the matching opportunities start flowing.
            </p>

            <div style="background:#faf9ff; border:1px solid #ede9fe; border-radius:14px; padding:22px; margin:24px 0;">
              <a href="${setupUrl}" style="display:block; text-align:center; background:linear-gradient(135deg,#3b82f6 0%,#7c3aed 100%); color:#ffffff; padding:16px 22px; border-radius:10px; text-decoration:none; font-size:16px; font-weight:800;">
                Fix my profile &amp; get matches →
              </a>
            </div>

            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:18px 0 0;">
              Button not working? Paste this link into your browser:<br/>
              <a href="${setupUrl}" style="color:#6d28d9; font-size:13px; word-break:break-all;">${setupUrl}</a>
            </p>
            <p style="font-size:13px; line-height:1.6; color:#64748b; margin:18px 0 0;">
              You received this because this email has access to Mindy.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Send the zero-alert nudge: sharp "your alerts are empty → fix your profile" message,
 *  same secure setup link, distinct emailType so it's tracked separately. */
export async function sendZeroAlertNudge(email: string): Promise<{ linkType: string }> {
  const setupUrl = getSetupRedirectUrl();
  const link = await generateSetupLink(email, setupUrl);

  await sendEmail({
    to: email,
    subject: 'Your Mindy alerts are empty — 60-second fix',
    html: buildZeroAlertNudgeHtml(link.url),
    text: `Your Mindy alerts are empty because your profile uses placeholder codes. Fix it (and start matching opportunities) here: ${link.url}`,
    emailType: 'zero_alert_nudge',
    eventSource: 'mindy_growth',
    tags: { type: 'zero_alert_nudge', link: link.type },
    metadata: { email, linkType: link.type },
  });

  return { linkType: link.type };
}
