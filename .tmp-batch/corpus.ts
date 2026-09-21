import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function probe(word: string) {
  const { data, error, count } = await db
    .from('sam_opportunities')
    .select('title, naics_code, notice_type, set_aside_description', { count: 'exact' })
    .eq('active', true)
    .gte('response_deadline', new Date().toISOString())
    .ilike('title', `%${word}%`)
    .limit(5);
  if (error) { console.log(word, 'ERROR', error.message); return; }
  console.log(`\n### "${word}"  count=${count}`);
  for (const r of data || []) console.log('   ', r.naics_code, '|', r.notice_type, '|', r.set_aside_description, '|', r.title);
}
async function main() {
  for (const w of ['garbage','refuse','solid waste','waste','trash','sanitation','person','dumpster','recycling']) await probe(w);
}
main();
