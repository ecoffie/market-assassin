import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const words = ['physical','guard','security','clean','cleaning','office','buildings','garbage','person','small','install','roofing','commercial','staffing','landscaping','catering','trucking','help','businesses','offices','support','window','washing','lidar','door','doors'];
async function main() {
  const { data, error } = await db.from('naics_vocabulary').select('code, term, kind, weight, df').in('term', words).order('weight', { ascending: false }).limit(2000);
  if (error) { console.log('ERR', error.message); return; }
  const by: Record<string, any[]> = {};
  for (const r of (data||[]) as any[]) (by[r.term] ||= []).push(r);
  for (const w of words) {
    const rows = (by[w]||[]).slice(0,3);
    console.log(w.padEnd(13), rows.length ? rows.map(r=>`${r.code}(w${Math.round(r.weight)},df${r.df})`).join(' ') : '—');
  }
}
main();
