import { createClient } from '@supabase/supabase-js';
import { makeTier1Tools, type Tier1Db } from '@/lib/chat/tier1-tools';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tools = makeTier1Tools(db as unknown as Tier1Db);
async function main() {
  for (const kw of ['garbage','staffing','security guard']) {
    const r: any = await tools.execute('search_sam_opportunities', { keyword: kw, limit: 40 });
    console.log(`\n### "${kw}" ok=${r.ok} count=${r.count}`);
    for (const i of (r.items || [])) console.log('   ', String(i.naics).padEnd(7), '|', String(i.type).padEnd(32), '|', i.title);
  }
}
main();
