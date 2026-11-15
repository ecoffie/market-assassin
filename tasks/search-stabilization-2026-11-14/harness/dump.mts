import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const now = new Date().toISOString();
const COLS = 'notice_id,title,description,sow_text,department,sub_tier,solicitation_number,naics_code,psc_code,notice_type,response_deadline,posted_date,active';
const out: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('sam_opportunities').select(COLS).eq('active', true).gt('response_deadline', now).order('notice_id').range(from, from + 999);
  if (error) throw error;
  out.push(...data!);
  if (data!.length < 1000) break;
}
fs.writeFileSync(process.argv[2], JSON.stringify({ snapshot_at: now, rows: out }));
console.log('rows', out.length, 'snapshot', now);
