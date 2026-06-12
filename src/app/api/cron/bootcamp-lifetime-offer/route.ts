import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { isCampaignExcludedEmail } from '@/lib/mindy/campaign-exclusions';
import {
  BOOTCAMP_LIFETIME_EMAIL_TYPE,
  bootcampLifetimeSubject,
  bootcampLifetimeHtml,
} from '@/lib/mindy/bootcamp-lifetime-offer';

/**
 * GET /api/cron/bootcamp-lifetime-offer
 *
 * Post-bootcamp lifetime-offer blast. Sends the $1,497 Ultimate Giant Bundle
 * offer to bootcamp leads (user_notification_settings.invitation_source =
 * 'bootcamp-batch-enroll') who are NOT already paying customers, ONCE each
 * (deduped on email_type). One-time campaign — run it after June 27.
 *
 * Skips anyone who already has briefings/Pro access (no point pitching lifetime
 * to a current subscriber/lifetime owner) and the comp/testimonial list.
 *
 * Modes:
 *   ?mode=preview (default)            → audience + sample, no sends.
 *   ?mode=execute                      → send.
 *   ?limit=N (default 200, max 500)    → cap sends per run (run repeatedly to drain).
 *   ?deadline=June%2030                → urgency label in the email (default 'this week').
 *
 * Dispatcher-fired or manual. Marketing emailType → respects daily cap + suppression.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
function norm(e: unknown): string {
  return typeof e === 'string' ? e.toLowerCase().trim() : '';
}

async function fetchAllRows<T>(supabase: SupabaseClient, table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 120000; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) break;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  const authed = password === ADMIN_PASSWORD || (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) || isDispatch;
  if (!authed) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const execute = url.searchParams.get('mode') === 'execute';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
  const deadline = (url.searchParams.get('deadline') || 'this week').slice(0, 40);
  const testEmail = url.searchParams.get('testEmail');
  const supabase = sb();

  // Test render: send ONE email to the given address (bypasses audience/dedup),
  // so we can verify it looks right before the real blast.
  if (testEmail) {
    const ok = await sendEmail({
      to: testEmail,
      subject: bootcampLifetimeSubject(),
      html: bootcampLifetimeHtml(deadline),
      emailType: BOOTCAMP_LIFETIME_EMAIL_TYPE + '_test',
      transactional: true, // admin render-check — bypass the daily cap so it always delivers
    });
    return NextResponse.json({ success: true, mode: 'test', to: testEmail, sent: ok });
  }

  // 1) Bootcamp leads (tagged invitation_source). Page past the 1000 cap.
  const leads = new Set<string>();
  for (let from = 0; from < 120000; from += 1000) {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, invitation_source, briefings_enabled')
      .eq('invitation_source', 'bootcamp-batch-enroll')
      .range(from, from + 999);
    if (error) break;
    for (const r of (data || []) as Array<{ user_email?: string; briefings_enabled?: boolean }>) {
      // Skip current Pro/lifetime owners — don't pitch lifetime to a subscriber.
      if (r.briefings_enabled === true) continue;
      const e = norm(r.user_email);
      if (e && !isCampaignExcludedEmail(e)) leads.add(e);
    }
    if (!data || data.length < 1000) break;
  }

  // 2) Anyone who already has access via user_profiles flags or a paid
  //    classification — exclude them too (belt + suspenders beyond briefings_enabled).
  const owners = new Set<string>();
  const profiles = await fetchAllRows<{ email?: string; access_briefings?: boolean }>(
    supabase, 'user_profiles', 'email, access_briefings',
  );
  for (const p of profiles) if (p.access_briefings === true) owners.add(norm(p.email));

  // 3) Already-sent this offer (dedup).
  const sent = new Set<string>();
  for (let from = 0; from < 120000; from += 1000) {
    const { data, error } = await supabase
      .from('email_provider_sends')
      .select('user_email, email_type')
      .eq('email_type', BOOTCAMP_LIFETIME_EMAIL_TYPE)
      .range(from, from + 999);
    if (error) break;
    for (const r of (data || []) as Array<{ user_email?: string }>) sent.add(norm(r.user_email));
    if (!data || data.length < 1000) break;
  }

  const queue = [...leads].filter((e) => !owners.has(e) && !sent.has(e)).sort();
  const slice = queue.slice(0, limit);

  if (!execute) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      bootcampLeads: leads.size,
      excludedOwners: [...leads].filter((e) => owners.has(e)).length,
      alreadySent: [...leads].filter((e) => sent.has(e)).length,
      eligibleRemaining: queue.length,
      wouldSend: slice.length,
      deadline,
      sampleRecipients: slice.slice(0, 10),
    });
  }

  // 4) EXECUTE.
  const subject = bootcampLifetimeSubject();
  const html = bootcampLifetimeHtml(deadline);
  let sentCount = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const email of slice) {
    try {
      const ok = await sendEmail({ to: email, subject, html, emailType: BOOTCAMP_LIFETIME_EMAIL_TYPE });
      if (ok) sentCount++;
      else failures.push({ email, error: 'blocked or failed (cap/suppression/provider)' });
    } catch (err) {
      failures.push({ email, error: err instanceof Error ? err.message : 'send failed' });
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    sent: sentCount,
    failed: failures.length,
    eligibleRemaining: Math.max(0, queue.length - sentCount),
    failures: failures.slice(0, 10),
  });
}
