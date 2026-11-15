// READ-ONLY. For every alerting saved search with text, print the canonical matcher shape and an in-memory text-match
// count over the open corpus posted in the last 30 days (the alert window). Output contains customer text: write it
// OUTSIDE the repo. usage: tsx saved-search-shapes.mts <corpus.json> <out.json>
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { buildDiscoveryPlan, OPEN_TEXT_COLS } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { matchesText } from '@/lib/discovery/matcher';
const [corpusPath, outPath] = process.argv.slice(2);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const rows: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('saved_searches').select('id, filters').eq('alerts_enabled', true).order('id').range(from, from + 999);
  if (error) throw error; rows.push(...data!); if (data!.length < 1000) break;
}
const { rows: corpus, snapshot_at } = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const cutoff = new Date(Date.parse(snapshot_at) - 30 * 86400000).toISOString();
const window = corpus.filter((r: any) => (r.posted_date || '') >= cutoff.slice(0, 10));
const out: any = { alerting: rows.length, window: window.length, searches: {} };
for (const r of rows) {
  const q = String(r.filters?.q ?? r.filters?.search ?? '').trim();
  if (!q) continue;
  const plan: any = buildDiscoveryPlan({ query: q } as any, MAPS_POLICY);
  const m = plan.matcher;
  const shape = m.mode !== 'lexical' ? m.mode : m.alternatives.map((a: any) => `${a.eligibility}(${a.eligible.map((c: any) => c.label).join('·')})${a.partnerRequired?.length ? `pair[${a.partnerRequired.join('·')}]` : ''}`).join(' | ');
  const ids = window.filter((x: any) => matchesText(m, (OPEN_TEXT_COLS as readonly string[]).map((c) => x[c]))).map((x: any) => x.notice_id);
  out.searches[r.id] = { q, shape, text_matches: ids.length, ids };
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('alerting', rows.length, 'with text', Object.keys(out.searches).length, 'window rows', window.length);
