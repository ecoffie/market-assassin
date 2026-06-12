/**
 * /api/cron/setup-invite-batch
 *
 * Sends the "set up your Mindy account" email to ENTITLED users who have no
 * Supabase auth account yet (the 723 "need setup" cohort) — throttled + resumable
 * so it drains over several runs instead of blasting everyone at once. Dispatcher-
 * fired (cron_jobs row), NOT a vercel.json cron.
 *
 * SAFE BY DEFAULT — preview unless ?mode=execute:
 *   GET (no mode)        → PREVIEW: who would get invited, how many, sample emails.
 *   GET ?mode=execute    → send up to ?limit (default 50) invites this run.
 *   ?limit=N             → cap sends per run (throttle).
 *
 * Dedup: skips anyone who already has an auth account OR already received a
 * 'mi_account_setup' email (email_provider_sends). Resumable: each run picks the
 * next un-invited slice, so the dispatcher window drains the cohort over time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendSetupInvite } from '@/lib/mindy/account-setup';
import { isCampaignExcludedEmail } from '@/lib/mindy/campaign-exclusions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  const PAGE = 1000;
  for (let from = 0; from < 60000; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (error) break;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchAuthEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const emails = new Set<string>();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data?.users || []) {
      const e = norm(u.email);
      if (e) emails.add(e);
    }
    if ((data?.users || []).length < 1000) break;
  }
  return emails;
}

/** Entitled = appears in customer_classifications (valid briefings_access),
 *  user_profiles (any access flag), or user_notification_settings. Mirrors the
 *  mi-account-setup summary's "entitledCandidates". */
async function fetchEntitledEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  const now = Date.now();

  const classifications = await fetchAllRows<{ email?: string; briefings_access?: string; briefings_expiry?: string }>(
    supabase, 'customer_classifications', 'email, briefings_access, briefings_expiry',
  );
  const entitledAccess = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
  for (const r of classifications) {
    const e = norm(r.email);
    if (!e || !entitledAccess.has(r.briefings_access || '')) continue;
    if (r.briefings_expiry && new Date(r.briefings_expiry).getTime() <= now) continue;
    out.add(e);
  }

  const profiles = await fetchAllRows<Record<string, unknown> & { email?: string }>(
    supabase, 'user_profiles',
    'email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings',
  );
  const ACCESS_FLAGS = ['access_hunter_pro', 'access_assassin_standard', 'access_assassin_premium', 'access_recompete', 'access_contractor_db', 'access_content_standard', 'access_content_full_fix', 'access_briefings'];
  for (const r of profiles) {
    const e = norm(r.email);
    if (e && ACCESS_FLAGS.some((f) => r[f] === true)) out.add(e);
  }

  const settings = await fetchAllRows<{ user_email?: string; briefings_enabled?: boolean }>(
    supabase, 'user_notification_settings', 'user_email, briefings_enabled',
  );
  for (const r of settings) {
    const e = norm(r.user_email);
    if (e && r.briefings_enabled === true) out.add(e);
  }

  return out;
}

/** Emails that already received a setup invite (don't re-send). */
async function fetchAlreadyInvited(supabase: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const rows = await fetchAllRows<{ user_email?: string }>(
      supabase, 'email_provider_sends', 'user_email, email_type',
    );
    for (const r of rows as Array<{ user_email?: string; email_type?: string }>) {
      if (r.email_type === 'mi_account_setup') {
        const e = norm(r.user_email);
        if (e) out.add(e);
      }
    }
  } catch { /* table may not have email_type — treat as none invited */ }
  return out;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const execute = url.searchParams.get('mode') === 'execute';
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
  const supabase = sb();

  const [entitled, authEmails, invited] = await Promise.all([
    fetchEntitledEmails(supabase),
    fetchAuthEmails(supabase),
    fetchAlreadyInvited(supabase),
  ]);

  // Needs setup = entitled, NO auth account, NOT already invited, NOT comp/test.
  const queue: string[] = [];
  for (const e of entitled) {
    if (authEmails.has(e)) continue;       // already has login
    if (invited.has(e)) continue;          // already got a setup email
    if (isCampaignExcludedEmail(e)) continue; // comp/testimonial + advocate accounts
    queue.push(e);
  }
  queue.sort(); // deterministic order so runs drain predictably

  const slice = queue.slice(0, limit);

  if (!execute) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      entitledTotal: entitled.size,
      alreadyHaveLogin: [...entitled].filter((e) => authEmails.has(e)).length,
      alreadyInvited: [...entitled].filter((e) => invited.has(e)).length,
      needsSetupRemaining: queue.length,
      wouldSendThisRun: slice.length,
      limit,
      sampleRecipients: slice.slice(0, 15),
    });
  }

  // EXECUTE — send this run's slice, record per-email outcome.
  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const email of slice) {
    try {
      await sendSetupInvite(email, { tier: 'entitled' });
      sent++;
    } catch (err) {
      failures.push({ email, error: err instanceof Error ? err.message : 'send failed' });
    }
    // small spacing so we don't hammer Supabase admin + Resend
    await new Promise((r) => setTimeout(r, 120));
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    sent,
    failed: failures.length,
    remainingAfter: Math.max(0, queue.length - sent),
    failures: failures.slice(0, 20),
  });
}
