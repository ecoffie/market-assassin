import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { sendEmail } from '@/lib/send-email';
import { createSecureAccessUrl } from '@/lib/access-links';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const REMINDER_COOLDOWN_DAYS = 14;
const CURSOR_KEY = 'admin:profile-reminder:cursor';
const LAST_RUN_KEY = 'admin:profile-reminder:last-run';

function getReminderSentKey(email: string): string {
  return `admin:profile-reminder:last-sent:${email.toLowerCase().trim()}`;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function getCursorWindow<T>(items: T[], cursor: number, limit: number): T[] {
  if (items.length === 0) return [];
  const start = Math.min(Math.max(cursor, 0), items.length);
  return items.slice(start, start + limit);
}

/**
 * POST /api/admin/send-profile-reminders
 *
 * Sends profile completion emails to users with briefings_enabled but no NAICS codes.
 * These users need to complete their profile to receive targeted briefings.
 *
 * Query params:
 * - password: Admin password (required)
 * - mode: 'preview' (default), 'send', or 'execute'
 * - limit: Max users to send in execute mode (default: 50)
 * - batchSize: Emails per batch with delay (default: 10)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || '50');
  const batchSize = parseInt(searchParams.get('batchSize') || '10');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const emptyProfileUsers = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error: fetchError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, created_at, updated_at')
      .eq('is_active', true)
      .eq('briefings_enabled', true)
      .range(from, from + pageSize - 1);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    emptyProfileUsers.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  // Filter to only users with empty profiles (no NAICS, keywords, or agencies)
  const usersNeedingSetup = (emptyProfileUsers || []).filter(u => {
    const naics = u.naics_codes || [];
    const keywords = u.keywords || [];
    const agencies = u.agencies || [];
    return naics.length === 0 && keywords.length === 0 && agencies.length === 0;
  });

  const cooldownStartedAt = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const recentlyRemindedEmails = new Set<string>();

  const { data: recentProviderSends } = await supabase
    .from('email_provider_sends')
    .select('user_email')
    .eq('email_type', 'profile_reminder')
    .gte('sent_at', cooldownStartedAt)
    .limit(5000);

  for (const row of recentProviderSends || []) {
    if (row.user_email) {
      recentlyRemindedEmails.add(normalizeEmail(row.user_email));
    }
  }

  await Promise.all(
    usersNeedingSetup.map(async (user) => {
      const email = normalizeEmail(user.user_email);
      const lastSent = await kv.get<string>(getReminderSentKey(email));
      if (lastSent) {
        recentlyRemindedEmails.add(email);
      }
    })
  );

  const eligibleUsers = usersNeedingSetup.filter(
    user => !recentlyRemindedEmails.has(normalizeEmail(user.user_email))
  );
  const skippedRecentlyReminded = usersNeedingSetup.length - eligibleUsers.length;
  const rawCursor = await kv.get<string | number>(CURSOR_KEY);
  const cursor = Math.max(Number(rawCursor || 0) || 0, 0);
  const effectiveCursor = Math.min(cursor, eligibleUsers.length);
  const nextEligibleUsers = getCursorWindow(eligibleUsers, effectiveCursor, limit);

  if (mode === 'preview') {
    const response = {
      success: true,
      mode: 'preview',
      summary: {
        totalBriefingsUsers: emptyProfileUsers?.length || 0,
        usersWithEmptyProfiles: usersNeedingSetup.length,
        reminderCooldownDays: REMINDER_COOLDOWN_DAYS,
        skippedRecentlyReminded,
        eligibleToSend: eligibleUsers.length,
        cursor: effectiveCursor,
        cursorSkipped: effectiveCursor,
        remainingAfterSend: Math.max(eligibleUsers.length - effectiveCursor - nextEligibleUsers.length, 0),
        sendLimit: limit,
        wouldSendNow: nextEligibleUsers.map(u => ({
          email: u.user_email,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        })),
        sample: nextEligibleUsers.slice(0, 25).map(u => ({
          email: u.user_email,
          createdAt: u.created_at,
          updatedAt: u.updated_at,
        })),
      },
      message: 'Use mode=execute or mode=send to send profile reminder emails',
    };

    await kv.set(LAST_RUN_KEY, {
      action: 'preview-profile-reminders',
      ...response,
      completedAt: new Date().toISOString(),
    }, { ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 });

    return NextResponse.json(response);
  }

  if (!['send', 'execute'].includes(mode)) {
    return NextResponse.json(
      { success: false, error: 'Invalid mode. Use preview, send, or execute.' },
      { status: 400 }
    );
  }

  // Send mode
  const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = [];
  const toProcess = nextEligibleUsers;

  for (let i = 0; i < toProcess.length; i++) {
    const user = toProcess[i];

    try {
      // Create magic link with setup=true
      const accessUrl = await createSecureAccessUrl(user.user_email, 'briefings');
      const setupUrl = `${accessUrl}&setup=true`;

      const emailHtml = generateProfileReminderEmail(user.user_email, setupUrl);

      await sendEmail({
        to: user.user_email,
        subject: '🎯 Complete Your Profile to Get Personalized Opportunities',
        html: emailHtml,
        emailType: 'profile_reminder',
        tags: { campaign: 'profile_migration_apr2026' },
      });

      results.push({ email: user.user_email, status: 'sent' });
      await kv.set(getReminderSentKey(user.user_email), new Date().toISOString(), {
        ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60,
      });

      // Rate limit: pause every batchSize emails
      if ((i + 1) % batchSize === 0 && i < toProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (err) {
      results.push({
        email: user.user_email,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const nextCursor = effectiveCursor + toProcess.length;

  await kv.set(CURSOR_KEY, String(nextCursor), {
    ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60,
  });

  const response = {
    success: true,
    mode,
    summary: {
      totalBriefingsUsers: emptyProfileUsers?.length || 0,
      usersWithEmptyProfiles: usersNeedingSetup.length,
      reminderCooldownDays: REMINDER_COOLDOWN_DAYS,
      skippedRecentlyReminded,
      eligibleToSend: eligibleUsers.length,
      cursor: effectiveCursor,
      cursorSkipped: effectiveCursor,
      nextCursor,
      processed: toProcess.length,
      sent,
      failed,
      remaining: Math.max(eligibleUsers.length - nextCursor, 0),
    },
    results,
  };

  await kv.set(LAST_RUN_KEY, {
    action: 'send-profile-reminders',
    ...response,
    completedAt: new Date().toISOString(),
  }, { ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 });

  return NextResponse.json(response);
}

export async function GET(request: NextRequest) {
  return POST(request);
}

function generateProfileReminderEmail(email: string, setupUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                🎯 Get Personalized Opportunities
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                Tell us about your business in 2 minutes
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                Hi there,
              </p>
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                You have access to <strong>Market Intelligence</strong> - daily briefings with federal contracting opportunities matched to your business.
              </p>
              <p style="margin: 0 0 20px; color: #374151; font-size: 16px; line-height: 1.6;">
                But we need to know a bit about what you do first! Without your industry profile, we can't send you relevant opportunities.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${setupUrl}"
                       style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #ffffff; padding: 16px 40px; font-size: 18px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
                      Complete My Profile →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- What you'll get -->
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px; color: #1f2937; font-size: 16px; font-weight: 600;">
                  What you'll get:
                </h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #4b5563; font-size: 14px; line-height: 1.8;">
                  <li>Daily opportunities matched to your NAICS codes</li>
                  <li>Weekly deep dive analysis on expiring contracts</li>
                  <li>Pursuit briefs for high-value targets</li>
                  <li>Win probability scoring on every opportunity</li>
                </ul>
              </div>

              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                The setup takes about 2 minutes. Just describe your business in plain language, and we'll suggest the right industry codes.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                GovCon Giants • Federal Contracting Intelligence<br>
                <a href="mailto:service@govcongiants.com" style="color: #7c3aed;">service@govcongiants.com</a>
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
