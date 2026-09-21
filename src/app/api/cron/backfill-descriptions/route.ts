/**
 * /api/cron/backfill-descriptions
 *
 * Captures real notice BODY TEXT into sam_opportunities.description so body search
 * ("M7 in the body") works. The SAM list endpoint returns description as a LINK; our
 * sync stored the link, so every description was an unusable URL. This resolves the
 * link → text via the shared lib and overwrites description.
 *
 * Batched + resumable, dispatcher-fired (cron_jobs row), uses the prod SAM key
 * server-side. Each run claims a bounded batch of rows still holding a link/null
 * description, processes them with a concurrency pool under a soft time budget, and
 * returns `remaining` so the dispatcher window drains the corpus over several runs.
 * A row stops matching once it has real text → naturally resumable, no new column.
 *
 *   ?mode=preview        → counts only (default-safe; no fetches, no writes)
 *   ?mode=execute        → process one batch
 *   ?inactive=1          → target the inactive (recompete) corpus instead of active
 *   ?resweep=1           → re-claim the abandoned '' rows (description='' AND checked_at IS NULL) —
 *                          one-time recovery of transient-failure poison (needs description_checked_at)
 *   ?limit=N             → rows to claim this run (default 300)
 *   ?concurrency=N       → parallel fetches (default 12)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isDescriptionLink, fetchNoticeDescription } from '@/lib/sam/notice-description';
import { getAllDistinctSAMKeys } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Normal scope: rows whose description is still a URL pointer or NULL — never resolved yet.
const LINK_FILTER = 'description.like.http%,description.is.null';
// Re-sweep scope (?resweep=1): the '' rows the OLD design abandoned. '' used to mean BOTH "no prose"
// AND "gave up" (no stamp existed), so transient-failure poison never got retried. With
// description_checked_at, we re-claim ONLY unstamped '' rows (description='' AND checked_at IS NULL) —
// applied as two chained filters (an AND, so NOT an .or() string) — resolve their text or stamp them
// "checked, genuinely empty" so they stop re-fetching and stop burning the SAM 1,000/day quota.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { id: any; notice_id: string; raw_data: any };

// Sentinel: SAM daily quota hit (429). The caller stops the whole run — we must
// NOT burn the row with '' (that would falsely mark it done and lose it forever).
class RateLimitedError extends Error {}

// Key fail-over holder: shared across the concurrency pool. `.idx` advances when a key 429s so every
// worker moves to the next key together; RateLimitedError only throws once the LAST key is exhausted.
type KeyPool = { keys: string[]; idx: number };

async function processOne(supabase: ReturnType<typeof sb>, row: Row, pool: KeyPool): Promise<'text' | 'empty' | 'fail'> {
  const rawDesc = row.raw_data?.description;
  const link = isDescriptionLink(rawDesc) ? String(rawDesc) : row.notice_id;
  const now = new Date().toISOString();
  try {
    let text = '';
    // Try the current key; on a 429, advance the shared index and retry with the next key. Only when
    // EVERY key is throttled do we throw RateLimitedError (caller stops the run, row left for retry).
    for (;;) {
      try {
        text = await Promise.race([
          fetchNoticeDescription(link, pool.keys[pool.idx]),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 25_000)),
        ]);
        break;
      } catch (e) {
        if (e instanceof Error && /\b429\b/.test(e.message) && pool.idx < pool.keys.length - 1) {
          pool.idx++;         // this key's 1000/day is spent → next key
          continue;
        }
        throw e;
      }
    }
    // Stamp checked_at on EVERY resolved row (text or genuinely-empty) so a re-swept '' row is never
    // re-claimed again — the stamp, not '', is now the "done" signal.
    await supabase.from('sam_opportunities').update({ description: text || '', description_checked_at: now }).eq('id', row.id);
    return text ? 'text' : 'empty';
  } catch (e) {
    // 429 on the LAST key = all quotas exhausted. Do NOT write '' or stamp — leave the row so it's
    // re-claimed after the quota resets. Signal the caller to stop the run cleanly.
    if (e instanceof Error && /\b429\b/.test(e.message)) {
      throw new RateLimitedError('SAM 429 (all keys)');
    }
    // Genuine failure (404/timeout/hang) → store '' AND stamp checked_at so it's not re-claimed
    // (the stamp replaces the old ''-as-poison-marker; a NULL stamp still means "re-claimable").
    await supabase.from('sam_opportunities').update({ description: '', description_checked_at: now }).eq('id', row.id);
    return 'fail';
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'preview';
  const active = url.searchParams.get('inactive') !== '1';
  // Re-sweep mode: re-claim the abandoned '' rows (description='' AND checked_at IS NULL) instead of
  // the normal link/null scope. A one-time drain to recover transient-failure poison; genuine empties
  // get stamped and drop out. (Eric 2026-08-01.)
  const resweep = url.searchParams.get('resweep') === '1';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 300)));
  const concurrency = Math.max(1, Math.min(20, Number(url.searchParams.get('concurrency') || 12)));
  const supabase = sb();
  // Fail over across ALL SAM keys within a run (SAM_API_KEY + SAM_API_KEY_1/_2/_BACKUP) so the job
  // drains against the COMBINED daily quota, not one key's 1000/day. (Eric 2026-08-01.)
  const pool: KeyPool = { keys: getAllDistinctSAMKeys(), idx: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => resweep
    ? q.eq('active', active).eq('description', '').is('description_checked_at', null)   // AND (two filters)
    : q.eq('active', active).or(LINK_FILTER);

  // Always report how many still need backfill (cheap head count).
  const { count: remaining } = await scoped(
    supabase.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }),
  );

  if (mode !== 'execute') {
    return NextResponse.json({ success: true, mode: 'preview', target: active ? 'active' : 'inactive', scope: resweep ? 'resweep' : 'link', remaining: remaining || 0 });
  }
  if (pool.keys.length === 0) {
    return NextResponse.json({ success: false, error: 'No SAM API keys configured' }, { status: 500 });
  }

  const { data, error } = await scoped(
    supabase.from('sam_opportunities').select('id, notice_id, raw_data'),
  ).limit(limit);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  const rows = (data || []) as Row[];

  // Concurrency pool with a soft time budget so we return before the platform kills us.
  const deadline = Date.now() + 240_000; // 4 min soft budget (maxDuration 300)
  let i = 0, text = 0, empty = 0, fail = 0, processed = 0;
  // When SAM's daily quota (1000/day) is hit, ALL workers stop immediately — no
  // point hammering a 429 for the rest of the run, and we must not burn rows.
  let rateLimited = false;
  async function worker() {
    while (i < rows.length && Date.now() < deadline && !rateLimited) {
      const row = rows[i++];
      try {
        const r = await processOne(supabase, row, pool);
        processed++;
        if (r === 'text') text++; else if (r === 'empty') empty++; else fail++;
      } catch (e) {
        if (e instanceof RateLimitedError) { rateLimited = true; break; }
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  return NextResponse.json({
    success: true,
    mode: 'execute',
    target: active ? 'active' : 'inactive',
    scope: resweep ? 'resweep' : 'link',
    claimed: rows.length,
    processed,
    withText: text,
    empty,
    failed: fail,
    // True when EVERY SAM key's daily quota was exhausted — the unprocessed rows stay null (not
    // burned) and are re-claimed after the midnight-UTC reset.
    rateLimited,
    keysAvailable: pool.keys.length,
    keyUsed: pool.idx,     // 0-based index of the key in use when the run ended (fail-over progress)
    remainingAfter: Math.max(0, (remaining || 0) - processed),
  });
}
