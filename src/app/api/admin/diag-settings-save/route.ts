/**
 * TEMP DIAGNOSTIC: reproduce the workspace PATCH upsert into mi_beta_user_settings
 * with the EXACT shape the Settings save sends, and return the raw Postgres error.
 * Diagnoses "I saved my name/codes but it didn't persist" (Eric QC 2026-06-16):
 * ensureAppWorkspaceSchema only CREATEs IF NOT EXISTS (no ALTER ADD COLUMN), so a
 * column added to the definition AFTER the table was created is missing in prod →
 * the upsert fails on it → save silently fails.
 *
 * GET ?password=...&email=...  → attempts the upsert, reports error or success.
 * Writes ONLY harmless display fields (no targeting), then reports.
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

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // First: which columns does the table actually have? Select * limit 1.
  const probe = await supabase.from('mi_beta_user_settings').select('*').limit(1);
  const existingCols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : null;

  // Now reproduce the PATCH upsert field-by-field to find which column breaks.
  const fullUpdates: Record<string, unknown> = {
    workspace_id: email,
    user_email: email,
    company_name: null,
    display_name: null,
    role_title: null,
    naics_codes: [],
    target_agencies: [],
    email_frequency: 'daily',
    onboarding_completed: false,
    two_factor_required: true,
    updated_at: new Date().toISOString(),
  };
  const full = await supabase.from('mi_beta_user_settings').upsert(fullUpdates, { onConflict: 'user_email' }).select().maybeSingle();

  return NextResponse.json({
    success: !full.error,
    existingColumns: existingCols,
    probeError: probe.error?.message || null,
    fullUpsertError: full.error?.message || null,
    fullUpsertCode: (full.error as { code?: string } | null)?.code || null,
    note: 'fullUpsertError names the missing/bad column if the Settings save is failing here.',
  });
}
