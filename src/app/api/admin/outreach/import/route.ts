/**
 * Bulk-import outreach contacts from CSV.
 *
 * POST /api/admin/outreach/import?password=...
 *   Content-Type: text/csv  (or application/json with { csv: "..." })
 *
 * Matches the shape of /Users/ericcoffie/Market Assasin/
 * ANNELLE-SIKANDER-QUALIFIED-CUSTOMER-OUTREACH.csv:
 *   Priority,Wave,Email,Name,Segment,Products / Signal,
 *   Qualification Reason,Primary Ask,Owner,Status,Last Touch,
 *   Next Action,Notes
 *
 * Rules:
 *   - Email is required; rows missing it are skipped.
 *   - Upsert by lowercase email so re-running the import is idempotent
 *     and updates existing rows in place.
 *   - "Priority" is mapped to score so the highest-priority rows float
 *     to the top of the contacts list.
 *   - "Products / Signal" + "Qualification Reason" join into a single
 *     `notes` row (note_type='import_seed') per contact so the original
 *     qualification context survives.
 *   - Source is hardcoded to 'csv_import' so we can distinguish from
 *     contacts that arrive via Stripe webhook or manual add.
 *
 * Returns row counts: imported / updated / skipped (and the first 10
 * skip reasons for debugging).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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

// Tiny CSV parser that handles quoted fields with commas + newlines.
// Standard library doesn't include one and pulling in `papaparse`
// just for this seems heavy. Single-line state machine.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* skip — handled by \n */ }
      else cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function parseDate(input: string | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Accept either raw CSV body or { csv } JSON. Easier from curl
  // pipes vs hand-pasted in a tool.
  let csvText = '';
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('text/csv') || ct.includes('text/plain')) {
    csvText = await request.text();
  } else {
    try {
      const body = await request.json();
      csvText = typeof body.csv === 'string' ? body.csv : '';
    } catch {
      return NextResponse.json({ error: 'Send CSV as text/csv body or { csv } JSON' }, { status: 400 });
    }
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSV needs a header row and at least one data row' }, { status: 400 });
  }

  // Build a header → index map so column order doesn't matter.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const iPriority = idx('Priority');
  const iWave = idx('Wave');
  const iEmail = idx('Email');
  const iName = idx('Name');
  const iSegment = idx('Segment');
  const iProducts = idx('Products / Signal');
  const iReason = idx('Qualification Reason');
  const iAsk = idx('Primary Ask');
  const iOwner = idx('Owner');
  const iStatus = idx('Status');
  const iLastTouch = idx('Last Touch');
  const iNextAction = idx('Next Action');
  const iNotes = idx('Notes');

  if (iEmail === -1) {
    return NextResponse.json({ error: 'CSV missing required Email column' }, { status: 400 });
  }

  const supabase = getSupabase();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const skips: Array<{ row: number; reason: string }> = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = (row[iEmail] || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skipped++;
      if (skips.length < 10) skips.push({ row: r, reason: 'invalid email' });
      continue;
    }

    const priorityRaw = iPriority >= 0 ? (row[iPriority] || '').trim() : '';
    const priority = priorityRaw ? parseInt(priorityRaw, 10) : null;
    // Priority 1 is highest, so flip into a score where higher = better.
    // PRD scoring tiers go up to ~100, so use 100 - priority for a
    // monotonic mapping; cap at 0.
    const score = priority && Number.isFinite(priority)
      ? Math.max(0, 100 - priority)
      : null;

    const wave = iWave >= 0 ? (row[iWave] || '').trim() : '';
    const segment = iSegment >= 0 ? (row[iSegment] || '').trim() : '';
    const owner = iOwner >= 0 ? (row[iOwner] || '').trim() : '';
    const status = iStatus >= 0 ? (row[iStatus] || '').trim() : '';
    const askField = iAsk >= 0 ? (row[iAsk] || '').trim() : '';
    const nextAction = iNextAction >= 0 ? (row[iNextAction] || '').trim() : '';
    const lastTouchIso = iLastTouch >= 0 ? parseDate(row[iLastTouch]) : null;

    const payload: Record<string, unknown> = {
      email,
      name: iName >= 0 ? (row[iName] || '').trim() || null : null,
      segment: segment || null,
      score,
      source: 'csv_import',
      owner: owner || null,
      status: status || 'queued',
      recommended_ask: askField || null,
      next_action: nextAction || null,
      last_contacted_at: lastTouchIso,
    };

    const { data, error } = await supabase
      .from('internal_outreach_contacts')
      .upsert(payload, { onConflict: 'email' })
      .select('id, created_at, updated_at')
      .single();

    if (error) {
      skipped++;
      if (skips.length < 10) skips.push({ row: r, reason: error.message });
      continue;
    }
    if (!data) {
      skipped++;
      continue;
    }

    // "Imported" vs "updated" inferred from whether updated_at differs
    // from created_at — a fresh insert has them equal (within a few ms).
    const created = new Date(data.created_at).getTime();
    const updatedTs = new Date(data.updated_at).getTime();
    if (Math.abs(updatedTs - created) < 1000) imported++;
    else updated++;

    // Persist the original qualification context as the first note so
    // the rich CSV content (Products / Signal + Qualification Reason +
    // free-text Notes) isn't lost. Idempotent-ish: re-runs add another
    // note_type='import_seed' row, but those are append-only by design.
    // Skipped if the CSV row had nothing to add.
    const products = iProducts >= 0 ? (row[iProducts] || '').trim() : '';
    const reason = iReason >= 0 ? (row[iReason] || '').trim() : '';
    const freeNotes = iNotes >= 0 ? (row[iNotes] || '').trim() : '';
    const summaryParts = [
      wave ? `Wave: ${wave}` : null,
      products ? `Products / Signal: ${products}` : null,
      reason ? `Qualification: ${reason}` : null,
      freeNotes ? `Notes: ${freeNotes}` : null,
    ].filter(Boolean);
    if (summaryParts.length > 0) {
      const { error: noteError } = await supabase
        .from('internal_outreach_notes')
        .insert({
          contact_id: data.id,
          owner: owner || null,
          note_type: 'import_seed',
          summary: summaryParts.join('\n'),
        });
      if (noteError) console.warn(`[outreach/import] row ${r} note insert failed:`, noteError.message);
    }
  }

  return NextResponse.json({
    success: true,
    total_rows: rows.length - 1,
    imported,
    updated,
    skipped,
    skips,
  });
}
