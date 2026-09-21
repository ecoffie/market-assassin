import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  for (const code of ['562998','561720','561320','238160','484121','722320','561730','561612','541519','334290']) {
    const { data } = await db.from('naics_vocabulary').select('term, kind, weight, df').eq('code', code).eq('code_type','naics').order('weight',{ascending:false}).limit(12);
    console.log(code, '→', (data||[]).map((r:any)=>`${r.term}(${r.df})`).join(', ') || '—');
  }
}
main();
