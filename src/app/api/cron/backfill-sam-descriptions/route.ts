/**
 * Cron: Backfill SAM.gov description text for opportunity rows.
 *
 * Most sam_opportunities rows store the description as a SAM API URL
 * pointer (e.g. https://api.sam.gov/.../noticedesc?noticeid=...)
 * instead of the actual prose. The /app market-intel UI surfaces a
 * "Load full description" button that lazy-resolves each one on demand,
 * but a steady drip of background backfill eliminates that wait over
 * time so future page loads land on inline text.
 *
 * Schedule: hourly (see vercel.json). Each run resolves at most
 * MAX_PER_RUN rows so we stay well under the per-key SAM quota
 * (1,000/day per key, 10/min). With multiple keys rotated and 50/run
 * × 24 runs/day = 1,200/day distributed across keys, we're safe.
 *
 * GET /api/cron/backfill-sam-descriptions
 *   ?password=galata-assassin-2026  (manual trigger from a browser)
 *   ?limit=50                       (override MAX_PER_RUN)
 *
 * Vercel cron requests carry a special header (x-vercel-cron), and
 * also pass through the project-wide CRON_SECRET via Authorization.
 * Either is accepted alongside the admin password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey } from '@/lib/sam/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vercel function timeout (seconds). Stay under 60s for hobby/pro;
// each SAM fetch is ~300ms, so 50 rows ~ 15s + overhead.
export const maxDuration = 60;

const MAX_PER_RUN = 50;
const MAX_DESCRIPTION_LENGTH = 50000;
// Tiny gap between SAM calls so we don't burst the per-minute limit.
const SAM_REQUEST_DELAY_MS = 150;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function authorized(request: NextRequest): boolean {
  // Vercel Cron sends the project's CRON_SECRET in Authorization.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') || '';
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  // Vercel's own cron user agent header (best effort).
  if (request.headers.get('x-vercel-cron')) return true;
  // Manual trigger from a browser or curl.
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveDescription(url: string, apiKey: string): Promise<string | null> {
  let upstream: URL;
  try {
    upstream = new URL(url);
    if (!upstream.searchParams.has('api_key')) {
      upstream.searchParams.set('api_key', apiKey);
    }
  } catch {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await res.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = payload as any;
      const text = typeof p.description === 'string'
        ? p.description
        : typeof p.body === 'string'
        ? p.body
        : typeof p.text === 'string'
        ? p.text
        : null;
      if (text) return text.trim().slice(0, MAX_DESCRIPTION_LENGTH);
    }
  }
  const text = await res.text().catch(() => '');
  return text ? text.trim().slice(0, MAX_DESCRIPTION_LENGTH) : null;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = new URL(request.url).searchParams.get('limit');
  const limit = Math.min(parseInt(limitParam || String(MAX_PER_RUN), 10) || MAX_PER_RUN, 200);

  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'SAM API key not configured' },
      { status: 500 }
    );
  }

  const supabase = getSupabase();

  // Pull a batch of rows whose description column still holds an http URL.
  // Order by created_at desc so newer opps get inline text first — those
  // are most likely to be browsed by users.
  const { data: rows, error: fetchError } = await supabase
    .from('sam_opportunities')
    .select('id, notice_id, description')
    .ilike('description', 'http%')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (fetchError) {
    return NextResponse.json(
      { success: false, error: `Fetch failed: ${fetchError.message}` },
      { status: 500 }
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No URL-only descriptions left to backfill',
      processed: 0,
      resolved: 0,
      failed: 0,
    });
  }

  let resolved = 0;
  let failed = 0;
  const failures: Array<{ noticeId: string; reason: string }> = [];

  for (const row of rows) {
    const url = typeof row.description === 'string' ? row.description.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      // Sanity check — shouldn't happen because of the ILIKE filter.
      failed++;
      continue;
    }

    const text = await resolveDescription(url, apiKey);
    if (!text) {
      failed++;
      failures.push({ noticeId: row.notice_id, reason: 'fetch returned empty or non-OK' });
      // Brief pause even on failure so we don't burst on a SAM outage.
      await sleep(SAM_REQUEST_DELAY_MS);
      continue;
    }

    const { error: updateError } = await supabase
      .from('sam_opportunities')
      .update({ description: text })
      .eq('id', row.id);

    if (updateError) {
      failed++;
      failures.push({ noticeId: row.notice_id, reason: `db update: ${updateError.message}` });
    } else {
      resolved++;
    }

    await sleep(SAM_REQUEST_DELAY_MS);
  }

  // How many URL-only descriptions are left so we can see when this is done.
  const { count: remaining } = await supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true })
    .ilike('description', 'http%');

  return NextResponse.json({
    success: true,
    processed: rows.length,
    resolved,
    failed,
    remaining: remaining ?? null,
    failures: failures.slice(0, 10), // first 10 for visibility
  });
}
