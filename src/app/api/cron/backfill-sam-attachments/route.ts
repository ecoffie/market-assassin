/**
 * Cron: Backfill SAM attachments (resourceLinks) on existing rows.
 *
 * SAM's list endpoint (/opportunities/v2 search) returns resourceLinks
 * as null on every row — only the per-opportunity detail endpoint
 * includes the actual file URLs. So unlike the pointOfContact /
 * officeAddress / additionalInfoLink fields (which the list endpoint
 * already populated and the static backfill admin endpoint pulls out
 * of raw_data), attachments require one SAM API call per opportunity.
 *
 * Plan:
 *   - Pull a batch of rows where attachments = '[]' AND we haven't
 *     yet attempted a detail fetch (tracked by attachments column
 *     being '[]' AND raw_data->'noticeId' present so we have an ID
 *     to fetch).
 *   - Hit SAM's opportunities search filtered by that single
 *     noticeId. The response always includes resourceLinks (an
 *     array of file URLs) plus a few other detail-only fields.
 *   - Write the resolved attachments array back into the row.
 *     Sentinel mark (single-entry array with `_no_attachments`) for
 *     opps that genuinely have no attachments so we don't retry them.
 *   - 200ms gap between requests so we don't burst the per-minute
 *     SAM quota.
 *
 * Schedule: vercel.json runs this once daily (UTC 5:00). 50 opps
 * per run × 30 days = 1,500 rows/month per SAM key. We have 4 keys
 * rotating so the budget is comfortable.
 *
 * Manual trigger:
 *   curl 'https://getmindy.ai/api/cron/backfill-sam-attachments?password=galata-assassin-2026&limit=100'
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey } from '@/lib/sam/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PER_RUN = 50;
const SAM_REQUEST_DELAY_MS = 200;
const SAM_OPPS_URL = 'https://api.sam.gov/opportunities/v2/search';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function authorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization') || '';
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  if (request.headers.get('x-vercel-cron')) return true;
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAttachments(noticeId: string, apiKey: string): Promise<any[] | null> {
  // SAM requires postedFrom/postedTo on every opportunities search.
  // Use a wide window so any active opp is in scope. We're scoping
  // by noticeId so the window doesn't actually narrow results.
  const today = new Date();
  const posted_to = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
  const past = new Date(today);
  past.setFullYear(past.getFullYear() - 2);
  const posted_from = `${String(past.getMonth() + 1).padStart(2, '0')}/${String(past.getDate()).padStart(2, '0')}/${past.getFullYear()}`;

  const url = new URL(SAM_OPPS_URL);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('noticeId', noticeId);
  url.searchParams.set('postedFrom', posted_from);
  url.searchParams.set('postedTo', posted_to);
  url.searchParams.set('limit', '1');

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const payload = await res.json().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opp = (payload as any)?.opportunitiesData?.[0];
  if (!opp) return null;

  // SAM returns resourceLinks as an array of URL strings, or null when
  // there are no attachments. Some notices instead use a nested
  // attachments array — handle both shapes.
  if (Array.isArray(opp.resourceLinks) && opp.resourceLinks.length > 0) {
    // SAM URLs look like
    //   https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{fileId}/download
    // so url.split('/').pop() is always "download" — useless as a
    // label. Pull the {fileId} segment (the one before "download") and
    // fall back to a numbered "Document N" label so users see something
    // distinct per file.
    return opp.resourceLinks.map((url: string, i: number) => {
      let fileId: string | undefined;
      try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        // Last segment is usually "download"; the one before is the file id.
        const last = parts[parts.length - 1];
        if (last && last.toLowerCase() !== 'download') {
          fileId = last;
        } else if (parts.length >= 2) {
          fileId = parts[parts.length - 2];
        }
      } catch { /* leave fileId undefined if URL parse fails */ }
      const label = fileId && fileId.length <= 24
        ? `Document ${i + 1} (${fileId})`
        : `Document ${i + 1}`;
      return { url, name: label, fileId: fileId || null };
    });
  }
  if (Array.isArray(opp.attachments) && opp.attachments.length > 0) {
    return opp.attachments;
  }
  // SAM returned the opp but no attachments — that's a real "no
  // attachments" answer, distinct from "couldn't fetch". Returning [].
  return [];
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Math.min(
    parseInt(new URL(request.url).searchParams.get('limit') || String(MAX_PER_RUN), 10) || MAX_PER_RUN,
    200
  );

  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'SAM API key not configured' },
      { status: 500 }
    );
  }

  const supabase = getSupabase();

  // Pull rows we haven't yet attempted. Filter: attachments is the
  // empty default '[]'. We also require the row to be active and have
  // a notice_id so the SAM detail fetch can scope. Order newest first
  // — those are most likely to be browsed by users.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase
    .from('sam_opportunities')
    .select('id, notice_id') as any)
    .eq('attachments', '[]')
    .eq('active', true)
    .not('notice_id', 'is', null)
    .order('posted_date', { ascending: false })
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
      message: 'No rows left to fetch attachments for',
      processed: 0,
    });
  }

  let withAttachments = 0;
  let withoutAttachments = 0;
  let failed = 0;
  const failures: Array<{ noticeId: string; reason: string }> = [];

  for (const row of rows) {
    const attachments = await fetchAttachments(row.notice_id, apiKey);

    if (attachments === null) {
      // Fetch failure (SAM down, rate limit, opp archived, etc).
      // Don't mark the row so we can retry on the next run.
      failed++;
      failures.push({ noticeId: row.notice_id, reason: 'SAM detail fetch failed' });
      await sleep(SAM_REQUEST_DELAY_MS);
      continue;
    }

    // Write back. If empty, use a sentinel single-entry array so the
    // eq '[]' filter no longer matches (avoids retrying forever) but
    // the UI can detect "intentionally no attachments" by the sentinel
    // shape.
    const toWrite = attachments.length > 0
      ? attachments
      : [{ _no_attachments: true }];

    const { error: updateError } = await supabase
      .from('sam_opportunities')
      .update({ attachments: toWrite })
      .eq('id', row.id);

    if (updateError) {
      failed++;
      failures.push({ noticeId: row.notice_id, reason: `db update: ${updateError.message}` });
    } else if (attachments.length > 0) {
      withAttachments++;
    } else {
      withoutAttachments++;
    }

    await sleep(SAM_REQUEST_DELAY_MS);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: remaining } = await (supabase
    .from('sam_opportunities')
    .select('id', { count: 'exact', head: true }) as any)
    .eq('attachments', '[]')
    .eq('active', true);

  return NextResponse.json({
    success: failed === 0,
    processed: rows.length,
    withAttachments,
    withoutAttachments,
    failed,
    remaining: remaining ?? null,
    failures: failures.slice(0, 10),
  });
}
