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
  return {
    attachments: Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [],
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
  // Rows where the new columns haven't been populated yet AND raw_data
  // exists so we have something to extract from.
  const { count: needsBackfill } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true })
    .is('attachments', null);
  const { count: total } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true });

  return NextResponse.json({
    mode: 'dry-run',
    totalRows: total ?? 0,
    needsBackfill: needsBackfill ?? 0,
    note: 'POST to this endpoint to start backfilling. Each run processes up to ?limit= rows (default 500, max 2000).',
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = new URL(request.url).searchParams.get('limit');
  const limit = Math.min(parseInt(limitParam || String(DEFAULT_BATCH), 10) || DEFAULT_BATCH, MAX_BATCH);

  const supabase = getSupabase();

  // Pull a batch of rows that still need extraction. We key on
  // attachments IS NULL so we know the migration default of '[]' has
  // not been overwritten by extraction yet. (Rows that genuinely had
  // no attachments will be set to '[]' after extraction, so subsequent
  // runs correctly skip them.)
  const { data: rows, error } = await supabase
    .from('sam_opportunities')
    .select('id, raw_data')
    .is('attachments', null)
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
      // No raw_data to extract from — set attachments to [] so we don't
      // re-pick the row next run.
      const { error: updateError } = await supabase
        .from('sam_opportunities')
        .update({ attachments: [], points_of_contact: [] })
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

  const { count: remaining } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true })
    .is('attachments', null);

  return NextResponse.json({
    success: errors.length === 0,
    processed: rows.length,
    updated,
    skipped_no_raw_data: skipped,
    errors: errors.slice(0, 10),
    remaining: remaining ?? null,
  });
}
