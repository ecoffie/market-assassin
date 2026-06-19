/**
 * Hard delete a Mindy user — Supabase Auth identity + every table row keyed
 * by user_email. Used to let someone start over after a broken onboarding
 * or to scrub testing accounts.
 *
 * Auth: admin password via ?password=... query param.
 *
 * GET  ?password=...&email=...     → dry-run, lists rows that would delete
 * POST ?password=...&email=...     → actually delete
 *
 * Returns counts per table + Supabase Auth deletion status.
 *
 * DESTRUCTIVE — no undo. Confirm with a dry-run first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Every table that's keyed by user_email. Add to this list when new
// user-scoped tables are added.
const USER_EMAIL_TABLES = [
  'user_notification_settings',
  'user_business_profiles',
  'user_pipeline',
  'user_teaming_partners',
  'user_referrals',
  'user_engagement',
  'user_engagement_scores',
  'user_alert_settings',      // legacy, may have been dropped — DELETE silently ignores
  'user_briefing_profile',    // legacy, may have been dropped
  'mi_beta_user_settings',
  'mi_beta_team_members',
  'mi_beta_activity',
  'alert_log',
  'briefing_log',
  'briefing_feedback',
  'signup_events',
  'opportunity_shares',
  'purchases',
] as const;

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface TableResult {
  table: string;
  rows: number;
  error?: string;
}

async function countRows(supabase: ReturnType<typeof getSupabase>, table: string, email: string): Promise<TableResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase.from(table) as any)
      .select('*', { count: 'exact', head: true })
      .eq('user_email', email);
    if (error) return { table, rows: 0, error: error.message };
    return { table, rows: count || 0 };
  } catch (err) {
    return { table, rows: 0, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function deleteRows(supabase: ReturnType<typeof getSupabase>, table: string, email: string): Promise<TableResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase.from(table) as any)
      .delete({ count: 'exact' })
      .eq('user_email', email);
    if (error) return { table, rows: 0, error: error.message };
    return { table, rows: count || 0 };
  } catch (err) {
    return { table, rows: 0, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function deleteSupabaseAuthUser(supabase: ReturnType<typeof getSupabase>, email: string) {
  try {
    // Look up the auth user by email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (listError) {
      return { deleted: false, error: listError.message };
    }
    const user = list?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
    if (!user) {
      return { deleted: false, error: 'No Supabase Auth user with this email' };
    }
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return { deleted: false, userId: user.id, error: deleteError.message };
    }
    return { deleted: true, userId: user.id };
  } catch (err) {
    return { deleted: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const tableCounts = await Promise.all(USER_EMAIL_TABLES.map(t => countRows(supabase, t, email)));
  const totalRows = tableCounts.reduce((sum, r) => sum + r.rows, 0);

  return NextResponse.json({
    mode: 'dry-run',
    email,
    tableCounts,
    totalRows,
    note: 'POST to this endpoint with the same email to actually delete.',
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Delete table rows first, then the auth user — if the auth deletion
  // somehow fails halfway, we'd rather have the orphan auth row than
  // orphan profile data.
  const tableDeletes = await Promise.all(USER_EMAIL_TABLES.map(t => deleteRows(supabase, t, email)));
  const totalRowsDeleted = tableDeletes.reduce((sum, r) => sum + r.rows, 0);
  const tableErrors = tableDeletes.filter(r => r.error);

  const authResult = await deleteSupabaseAuthUser(supabase, email);

  return NextResponse.json({
    mode: 'executed',
    email,
    tableDeletes,
    totalRowsDeleted,
    tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
    supabaseAuth: authResult,
    success: tableErrors.length === 0 && (authResult.deleted || authResult.error === 'No Supabase Auth user with this email'),
  });
}
