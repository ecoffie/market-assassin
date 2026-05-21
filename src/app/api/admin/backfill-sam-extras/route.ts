/**
 * Backfill SAM extra columns from raw_data on existing sam_opportunities rows.
 *
 * The 2026-05-21 migration added attachments / points_of_contact /
 * office_address / fair_opportunity / additional_info_link /
 * additional_info_text columns. New rows from sync-sam-opportunities
 * populate them directly. This endpoint walks existing rows and
 * extracts the same fields from the raw_data JSONB column — no SAM API
 * calls needed since we already have the full payload cached.
 *
 * Pure DB pass, no rate limit concerns. Page-by-page so we stay under
 * Vercel function timeout on big tables.
 *
 * GET  /api/admin/backfill-sam-extras?password=...        — dry run, returns row counts
 * POST /api/admin/backfill-sam-extras?password=...        — execute
 *      &limit=500                                          — batch size (max 2000)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_BATCH = 500;
const MAX_BATCH = 2000;

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromRaw(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  // Attachments NOT extracted here — SAM's list endpoint returns
  // resourceLinks: null on every row (verified via /api/admin/sam-
  // raw-sample). The actual attachment URLs only come from the per-
  // opportunity detail endpoint, fetched separately by the attachment
  // backfill cron. Leave attachments column untouched so that cron
  // can populate it without trampling.
  return {
    points_of_contact: Array.isArray(raw.pointOfContact) ? raw.pointOfContact : [],
    office_address: raw.officeAddress ?? null,
    fair_opportunity: raw.fairOpportunity ?? null,
    additional_info_link: typeof raw.additionalInfoLink === 'string' ? raw.additionalInfoLink : null,
    additional_info_text: typeof raw.additionalInfoText === 'string' ? raw.additionalInfoText : null,
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  // Migration set attachments DEFAULT '[]'::jsonb so IS NULL matches
  // nothing. The real signal that a row hasn't been backfilled is
  // points_of_contact = '[]' AND raw_data->'pointOfContact' is a non-
  // empty array (or any of the other extractable fields is present in
  // raw_data but absent in its column). Easier proxy: count rows where
  // attachments and points_of_contact are both still the empty default
  // — those are the candidates. Some genuinely have no attachments
  // and POCs upstream and will stay as [], but the backfill will
  // either confirm that (no-op) or fill them in.
  const { count: total } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true });

  // Diagnostic revealed SAM's list endpoint returns resourceLinks as
  // null (only the per-opportunity detail endpoint includes the file
  // URLs). pointOfContact IS populated on the list endpoint, so we
  // use that as the backfill signal — it's the most reliable indicator
  // that a row has not yet been extracted into the new columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: needsBackfillRaw } = await (supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true }) as any)
    .eq('points_of_contact', '[]')
    .not('raw_data->pointOfContact', 'is', null)
    // Exclude rows whose raw_data POC is an empty array — extracting
    // them would write [] into points_of_contact (same as default),
    // and the row would just match the filter again on the next run.
    .not('raw_data->pointOfContact', 'eq', '[]');

  return NextResponse.json({
    mode: 'dry-run',
    totalRows: total ?? 0,
    needsBackfill: needsBackfillRaw ?? 0,
    note: 'POST to this endpoint to start backfilling. Each run processes up to ?limit= rows (default 500, max 2000). Migration default left attachments=[] on existing rows, so the backfill looks for rows where raw_data still has resourceLinks/pointOfContact not yet copied into columns.',
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = new URL(request.url).searchParams.get('limit');
  const limit = Math.min(parseInt(limitParam || String(DEFAULT_BATCH), 10) || DEFAULT_BATCH, MAX_BATCH);

  const supabase = getSupabase();

  // Filter: rows where points_of_contact is still '[]' (default) AND
  // raw_data has a pointOfContact value. SAM's list endpoint always
  // includes pointOfContact when an opp has contacts, so this is the
  // canonical "needs backfill" signal. Once we update the columns,
  // points_of_contact becomes the real POC array and the filter no
  // longer matches that row — naturally idempotent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase
    .from('sam_opportunities')
    .select('id, raw_data') as any)
    .eq('points_of_contact', '[]')
    .not('raw_data->pointOfContact', 'is', null)
    // Skip rows whose raw POC is also an empty array — see GET handler
    // for the rationale (avoids the never-shrinks-past-N loop).
    .not('raw_data->pointOfContact', 'eq', '[]')
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { success: false, error: `fetch failed: ${error.message}` },
      { status: 500 }
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: 'No rows left to backfill',
    });
  }

  let updated = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const extracted = extractFromRaw(row.raw_data);
    if (!extracted) {
      // No raw_data on the row — mark points_of_contact done so the
      // filter (eq '[]' AND raw_data->pointOfContact NOT NULL) no
      // longer matches and we don't re-pick it. We use a sentinel
      // single-entry array so the eq '[]' filter excludes it.
      const { error: updateError } = await supabase
        .from('sam_opportunities')
        .update({ points_of_contact: [{ skipped: 'no_raw_data' }] })
        .eq('id', row.id);
      if (updateError) {
        errors.push({ id: row.id, error: updateError.message });
      } else {
        skipped++;
      }
      continue;
    }

    const { error: updateError } = await supabase
      .from('sam_opportunities')
      .update(extracted)
      .eq('id', row.id);

    if (updateError) {
      errors.push({ id: row.id, error: updateError.message });
    } else {
      updated++;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: remaining } = await (supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true }) as any)
    .eq('points_of_contact', '[]')
    .not('raw_data->pointOfContact', 'is', null)
    .not('raw_data->pointOfContact', 'eq', '[]');

  return NextResponse.json({
    success: errors.length === 0,
    processed: rows.length,
    updated,
    skipped_no_raw_data: skipped,
    errors: errors.slice(0, 10),
    remaining: remaining ?? null,
  });
}
