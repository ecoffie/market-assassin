// Read-only: fetch notice text for the r5 sample ids. Credentials via v4/scripts/bench-env.mts (see v4/ENVIRONMENT.md).
// Usage: npx tsx v5/scripts/fetch_rows.mts <v5 dir>   (run from a checkout that has node_modules)
import fs from 'fs';
const { loadBenchEnv } = await import(new URL('../../v4/scripts/bench-env.mts', import.meta.url).href);
const { createClient } = await import('@supabase/supabase-js');
const DIR = process.argv[2];
const env = loadBenchEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], process.cwd());
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = fs.readFileSync(DIR + '/r5_fetch_ids.txt', 'utf8').split('\n').filter(Boolean);
const COLS = 'notice_id,title,department,sub_tier,naics_code,psc_code,description,sow_text,notice_type,response_deadline,solicitation_number,active,source';
const out: any[] = [];
for (let i = 0; i < ids.length; i += 100) {
  const { data, error } = await sb.from('sam_opportunities').select(COLS).in('notice_id', ids.slice(i, i + 100));
  if (error) throw error;
  out.push(...data!);
}
const missing = ids.filter((id) => !out.some((r) => String(r.notice_id) === id));
fs.writeFileSync(DIR + '/r5_rows.jsonl', out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.error('fetched', out.length, 'of', ids.length, 'missing', missing.length, missing.slice(0, 5));
