import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await db.from('sam_opportunities').select('notice_id, title, notice_type, set_aside_description, naics_code, response_deadline, active').eq('solicitation_number','2032K826R00020');
  console.log(JSON.stringify(data, null, 1));
  console.log('--- full "person" title hits, active+open ---');
  const { data: p } = await db.from('sam_opportunities').select('notice_id, title, notice_type, set_aside_description, naics_code, response_deadline').eq('active',true).gte('response_deadline', new Date().toISOString()).ilike('title','%person%').order('response_deadline',{ascending:true});
  for (const r of (p||[]) as any[]) console.log(' ', r.response_deadline?.slice(0,10), '|', r.notice_type, '|', String(r.naics_code), '|', r.set_aside_description, '|', r.title);
}
main();
