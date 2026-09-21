import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { count } = await db.from('naics_vocabulary').select('*', { count: 'exact', head: true });
  console.log('naics_vocabulary rows =', count);
  for (const term of ['garbage','trash','refuse','landscaping','janitorial','catering','trucking']) {
    const { data, error } = await db.from('naics_vocabulary').select('code, code_type, term, kind, weight, df').eq('term', term).order('weight', { ascending: false }).limit(6);
    console.log(`\nterm="${term}"`, error?.message || '', JSON.stringify(data));
  }
  const { data: v } = await db.from('naics_vocabulary').select('term, kind, weight, df').eq('code','562111').order('weight',{ascending:false}).limit(25);
  console.log('\n562111 vocab:', JSON.stringify(v));
}
main();
