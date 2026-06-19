/**
 * Local bulk drain: AI-enrich active opportunities for SEO (rule #7 — local tsx
 * runner with a concurrency pool, NOT the HTTP cron in a loop). The cron is the
 * steady-state handler; this is the one-time backlog drain (~34k opps).
 *
 *   npx tsx scripts/drain-seo-enrich.ts            # drain all active, conc 6
 *   npx tsx scripts/drain-seo-enrich.ts --conc=10 --max=2000
 *
 * Resumable: only touches seo_enriched_at IS NULL. Stamps every processed row
 * (even null summaries) so it never re-loops a permanently-thin opp.
 */
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { generateOppSummary, type OppForEnrich } from '../src/lib/seo/enrich';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const arg = (k: string, d: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? Number(m.split('=')[1]) : d;
};
const CONC = arg('conc', 6);
const MAX = arg('max', Infinity);
const PAGE = 60;

async function countRemaining(): Promise<number> {
  const { count } = await sb
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('active', true).is('seo_enriched_at', null).not('title', 'is', null);
  return count ?? 0;
}

async function enrichOne(o: OppForEnrich): Promise<boolean> {
  const summary = await generateOppSummary(o);
  await sb.from('sam_opportunities')
    .update({ seo_summary: summary, seo_enriched_at: new Date().toISOString() })
    .eq('notice_id', o.notice_id);
  return !!summary;
}

async function main() {
  const start = await countRemaining();
  console.log(`SEO enrich drain — ${Math.min(start, MAX).toLocaleString()} to process · concurrency ${CONC}`);
  let processed = 0, written = 0;

  while (processed < MAX) {
    const { data: rows } = await sb
      .from('sam_opportunities')
      .select('notice_id, title, description, sow_text, naics_code, psc_code, department, set_aside_description, notice_type, pop_state')
      .eq('active', true).is('seo_enriched_at', null).not('title', 'is', null)
      .order('posted_date', { ascending: false })
      .limit(PAGE);
    if (!rows?.length) break;

    // Concurrency pool over the page.
    for (let i = 0; i < rows.length; i += CONC) {
      const slice = rows.slice(i, i + CONC) as OppForEnrich[];
      const results = await Promise.all(slice.map((o) => enrichOne(o).catch(() => false)));
      processed += slice.length;
      written += results.filter(Boolean).length;
      if (processed >= MAX) break;
    }
    process.stdout.write(`  ${processed.toLocaleString()} processed · ${written.toLocaleString()} summaries\r`);
  }

  const remaining = await countRemaining();
  console.log(`\n✅ Done. processed=${processed.toLocaleString()} · summaries=${written.toLocaleString()} · remaining=${remaining.toLocaleString()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
