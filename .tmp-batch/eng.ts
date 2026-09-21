import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await db.from('sam_opportunities').select('title, naics_code')
    .eq('active', true).gte('response_deadline', new Date().toISOString())
    .ilike('title', '%engineers%').limit(20);
  for (const r of (data||[]) as any[]) console.log(' -', r.naics_code, '|', r.title);
}
main();
