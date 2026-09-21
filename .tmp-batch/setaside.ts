import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const today = new Date().toISOString();
async function c(label: string, f: (q: any) => any) {
  const q = f(db.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).gte('response_deadline', today));
  const { count, error } = await q;
  console.log(label.padEnd(60), error ? 'ERR ' + error.message : count);
}
async function main() {
  await c('active+open total', (q) => q);
  await c('  set_aside_description IS NULL', (q) => q.is('set_aside_description', null));
  await c('  desc NULL  AND code NOT NULL', (q) => q.is('set_aside_description', null).not('set_aside_code', 'is', null));
  await c('  desc NULL  AND code NULL', (q) => q.is('set_aside_description', null).is('set_aside_code', null));
  await c("  desc = 'No Set aside used'", (q) => q.eq('set_aside_description', 'No Set aside used'));
  console.log('\n--- distinct set_aside_description (null-desc rows w/ code) ---');
  const { data } = await db.from('sam_opportunities').select('set_aside_code, notice_type, title').eq('active', true).gte('response_deadline', today).is('set_aside_description', null).not('set_aside_code','is',null).limit(10);
  console.log(JSON.stringify(data, null, 1));
  console.log('\n--- notice_type histogram (active open) ---');
  const { data: nt } = await db.from('sam_opportunities').select('notice_type').eq('active', true).gte('response_deadline', today).limit(20000);
  const h: Record<string, number> = {};
  for (const r of (nt || []) as any[]) h[r.notice_type ?? 'NULL'] = (h[r.notice_type ?? 'NULL'] || 0) + 1;
  console.log(JSON.stringify(Object.entries(h).sort((a,b)=>b[1]-a[1]), null, 0));
}
main();
