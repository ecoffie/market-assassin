/**
 * Builds src/lib/discovery/corpus-word-df.json (READ-ONLY against the DB): the share of ACTIVE SAM notices whose
 * title or description contains each word, for every word at or above MIN_DF. The discovery matcher is pure, so it
 * reads this measured, versioned table instead of querying at plan time. Same intent as the documented
 * COMMON_TERM_WEIGHT rule in src/lib/mi-dashboard/search.ts ("df >= ~5% of the corpus => common"), measured for
 * every word rather than hand-listed.
 *
 *   npx tsx scripts/build-corpus-word-df.ts            # dry run: prints the table summary
 *   npx tsx scripts/build-corpus-word-df.ts --write    # writes the JSON
 *
 * Token rule: lower-case, split on anything that is not a-z or 0-9, a word counted once per notice. A query word is
 * looked up exactly; inflections are separate tokens (approximation, documented in the table's _meta).
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const MIN_DF = 0.01;
const OUT = 'src/lib/discovery/corpus-word-df.json';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const counts = new Map<string, number>();
  let n = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('sam_opportunities').select('notice_id,title,description').eq('active', true).order('notice_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data as Array<{ title: string | null; description: string | null }>) {
      n++;
      const words = new Set(`${r.title || ''} ${r.description || ''}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2));
      for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }
  const head = await db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true);
  if (head.error || head.count == null) throw new Error('active count unknown');
  if (head.count !== n) throw new Error(`read ${n} notices but ${head.count} are active: refusing to write a partial table`);
  const df: Record<string, number> = {};
  for (const [w, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) if (c / n >= MIN_DF) df[w] = +(c / n).toFixed(4);
  const table = { _meta: { measured: new Date().toISOString().slice(0, 10), corpus: 'sam_opportunities active=true', fields: 'title + description', notices: n, minDf: MIN_DF, words: Object.keys(df).length, token: 'lower-case a-z0-9 runs, once per notice; inflections are separate tokens' }, df };
  console.log(JSON.stringify(table._meta));
  if (process.argv.includes('--write')) fs.writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
