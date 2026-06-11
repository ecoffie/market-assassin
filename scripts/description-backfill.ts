/**
 * Description-body backfill — captures the REAL notice text into
 * sam_opportunities.description so body search ("M7 in the body") works.
 *
 * The SAM /search list endpoint returns `description` as a LINK
 * (.../noticedesc?noticeid=...); our sync stored that link, so every cached
 * description was an unusable URL → body search matched nothing. This reads
 * raw_data.description (the link), fetches the actual text, and overwrites
 * sam_opportunities.description with it.
 *
 * RESUMABLE WITHOUT A MIGRATION: a row is "done" once its description no longer
 * looks like an http link (it's real text), so re-running just claims the rows
 * still holding a link/null. No new column needed.
 *
 * Active first (biddable now), then --inactive (the 90-180d recompete corpus).
 *
 * Run:  npx tsx scripts/description-backfill.ts                 (active only)
 *       npx tsx scripts/description-backfill.ts --inactive      (then recompetes)
 *       CONCURRENCY=20 npx tsx scripts/description-backfill.ts  (faster)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { isDescriptionLink, fetchNoticeDescription } from '../src/lib/sam/notice-description';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const API_KEY = process.env.SAM_API_KEY || '';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '15', 10);
const PAGE = 300;
const includeInactive = process.argv.includes('--inactive');

if (!API_KEY) { console.error('Missing SAM_API_KEY'); process.exit(1); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { id: any; notice_id: string; raw_data: any };

async function processOne(row: Row): Promise<'text' | 'empty' | 'fail'> {
  const rawDesc = row.raw_data?.description;
  // The link to fetch: prefer raw_data.description (the noticedesc URL), else build
  // from notice_id.
  const link = isDescriptionLink(rawDesc) ? String(rawDesc) : row.notice_id;
  try {
    const text = await Promise.race([
      fetchNoticeDescription(link, API_KEY),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 30_000)),
    ]);
    // Store the real text. If SAM returned nothing, store '' so the row stops
    // matching the link-filter (poison-proof: never re-claimed endlessly).
    await sb.from('sam_opportunities')
      .update({ description: text || '' })
      .eq('id', row.id);
    return text ? 'text' : 'empty';
  } catch {
    // Mark as empty-string so a hanging/404 notice doesn't block the queue forever.
    await sb.from('sam_opportunities').update({ description: '' }).eq('id', row.id);
    return 'fail';
  }
}

async function pool(rows: Row[]) {
  let i = 0, text = 0, empty = 0, fail = 0;
  async function worker() {
    while (i < rows.length) {
      const r = await processOne(rows[i++]);
      if (r === 'text') text++; else if (r === 'empty') empty++; else fail++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { text, empty, fail };
}

async function drainPhase(active: boolean, label: string) {
  let total = 0, gotText = 0;
  const start = Date.now();
  for (;;) {
    // Claim a page of rows that still hold a LINK or null description.
    const { data, error } = await sb.from('sam_opportunities')
      .select('id, notice_id, raw_data')
      .eq('active', active)
      .or('description.like.http%,description.is.null')
      .limit(PAGE);
    if (error) { console.error(`[${label}] fetch error:`, error.message); break; }
    if (!data || data.length === 0) break;

    const res = await pool(data as Row[]);
    total += data.length;
    gotText += res.text;
    const mins = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[${label}] +${data.length} (text:${res.text} empty:${res.empty} fail:${res.fail}) | total:${total} withText:${gotText} | ${mins}m`);
  }
  console.log(`[${label}] DONE — ${total} processed, ${gotText} with real body text.`);
}

(async () => {
  console.log(`Description backfill — concurrency ${CONCURRENCY}, ${includeInactive ? 'ACTIVE + INACTIVE' : 'ACTIVE only'}`);
  await drainPhase(true, 'active');
  if (includeInactive) await drainPhase(false, 'inactive');
  console.log('All done.');
  process.exit(0);
})();
