/**
 * Local CTA-tag drain — the rule-#7 bulk runner.
 *
 * The HTTP cron (tag-cta) throttles at ~50-100/min (cold starts, per-record DB
 * round-trips) and stalled at ~2% coverage. This drains the same work locally with
 * BULK writes, reusing the EXACT tagging logic (buildCtaTagRows → tagOpportunityForCta)
 * so the cron stays the steady-state handler and this is the one-time drain.
 *
 * Resumable: only touches rows where cta_tagged_at IS NULL, so re-running continues.
 *
 *   npx tsx scripts/drain-cta-tags.ts            # ACTIVE opps only (the live feed) — default
 *   npx tsx scripts/drain-cta-tags.ts --all      # active + archive
 *   npx tsx scripts/drain-cta-tags.ts --limit=500
 */
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildCtaTagRows, type SamOpportunityForCta } from '../src/lib/cta/tagger';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ALL = process.argv.includes('--all');
const ACTIVE_ONLY = !ALL;
const BATCH = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 500;

async function countRemaining(): Promise<number> {
  let q = sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).is('cta_tagged_at', null);
  if (ACTIVE_ONLY) q = q.eq('active', true);
  const { count } = await q;
  return count ?? 0;
}

async function main() {
  const scope = ACTIVE_ONLY ? 'ACTIVE opps only' : 'ALL opps (active + archive)';
  const start = await countRemaining();
  console.log(`CTA drain — ${scope} · batch=${BATCH}`);
  console.log(`Untagged to start: ${start.toLocaleString()}\n`);

  let totalProcessed = 0;
  let totalTags = 0;
  let batchNum = 0;

  for (;;) {
    let q = sb
      .from('sam_opportunities')
      .select('notice_id, naics_code, naics_codes, title, description')
      .is('cta_tagged_at', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (ACTIVE_ONLY) q = q.eq('active', true);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) break;

    batchNum++;
    const taggedAt = new Date().toISOString();

    // Compute all tags in-memory (pure logic, no DB) — the same as the cron.
    const allTagRows = rows.flatMap(r => buildCtaTagRows(r as SamOpportunityForCta, taggedAt));
    const noticeIds = rows.map(r => r.notice_id);

    // Bulk write: clear any prior tags for these notices, insert fresh, stamp all.
    // (delete-then-insert keeps re-runs idempotent without per-row round-trips.)
    if (noticeIds.length) {
      const { error: delErr } = await sb.from('opportunity_cta_tags').delete().in('notice_id', noticeIds);
      if (delErr) throw new Error('delete: ' + delErr.message);
    }
    if (allTagRows.length) {
      // Dedupe defensively on the PK (notice_id, cta_id).
      const deduped = [...new Map(allTagRows.map(r => [`${r.notice_id}:${r.cta_id}`, r])).values()];
      const { error: upErr } = await sb.from('opportunity_cta_tags').upsert(deduped, { onConflict: 'notice_id,cta_id' });
      if (upErr) throw new Error('upsert: ' + upErr.message);
      totalTags += deduped.length;
    }
    // Stamp every processed opp (even ones with 0 tags) so they're not re-scanned.
    const { error: stampErr } = await sb.from('sam_opportunities').update({ cta_tagged_at: taggedAt }).in('notice_id', noticeIds);
    if (stampErr) throw new Error('stamp: ' + stampErr.message);

    totalProcessed += rows.length;
    if (batchNum % 5 === 0 || rows.length < BATCH) {
      const remaining = await countRemaining();
      console.log(`  batch ${batchNum}: +${rows.length} opps · ${totalTags.toLocaleString()} tags so far · ${remaining.toLocaleString()} remaining`);
    }
  }

  const end = await countRemaining();
  console.log(`\n✅ Done. processed=${totalProcessed.toLocaleString()} · tags written=${totalTags.toLocaleString()} · remaining=${end.toLocaleString()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message || e); process.exit(1); });
