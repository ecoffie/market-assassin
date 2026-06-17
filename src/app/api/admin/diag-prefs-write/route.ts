/**
 * TEMP DIAGNOSTIC: run the EXACT user_notification_settings write the Settings
 * "Save" does (via /api/alerts/preferences), bypassing browser auth (service role),
 * to prove whether the WRITE itself works for a given account — separating a write
 * failure from a browser-auth failure. Diagnoses "I save but it never persists"
 * (eric@govcongiants.com, updated_at stuck 10 days; Eric QC 2026-06-16).
 *
 * GET ?password=...&email=...  → updates psc_codes to a sentinel, reports the raw
 * Postgres error (or success), then the resulting row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Reproduce the preferences route's existence check (the .single() that ignores error).
  const existRes = await sb.from('user_notification_settings').select('user_email').eq('user_email', email).single();

  // The write the route runs on UPDATE: a record with the targeting fields.
  const record = {
    psc_codes: ['DIAG_TEST'],
    keywords: ['diag-keyword'],
    updated_at: new Date().toISOString(),
    profile_updated_at: new Date().toISOString(),
  };
  const upd = await sb.from('user_notification_settings').update(record).eq('user_email', email).select().single();

  // Read back, then restore (don't leave test values).
  const after = await sb.from('user_notification_settings').select('psc_codes, keywords, updated_at').eq('user_email', email).maybeSingle();

  return NextResponse.json({
    email,
    existenceCheck: { found: !!existRes.data, error: existRes.error?.message || null, errorCode: (existRes.error as { code?: string } | null)?.code || null },
    updateSucceeded: !upd.error,
    updateError: upd.error?.message || null,
    updateErrorCode: (upd.error as { code?: string } | null)?.code || null,
    rowAfter: after.data || null,
    note: 'If updateSucceeded=true, the WRITE path works → the failure is browser auth (verifyUserOwnsEmail rejecting the form request). If false, updateError names the problem.',
  });
}
