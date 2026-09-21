import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const today = new Date().toISOString().slice(0, 10);

async function count(label: string, pattern: string) {
  const { data, error, count: c } = await db
    .from('sam_opportunities')
    .select('title, naics_code', { count: 'exact' })
    .eq('active', true)
    .gte('response_deadline', today)
    .ilike('title', pattern)
    .limit(5);
  if (error) { console.log(label.padEnd(28), 'ERROR', error.message); return; }
  console.log(label.padEnd(28), String(c).padStart(5), '|', (data || []).map((r) => (r as {title:string}).title.slice(0, 48)).join(' // '));
}

async function main() {
  for (const [label, pat] of [
    ['title ~ fence', '%fence%'],
    ['title ~ fencing', '%fencing%'],
    ['title ~ lawn', '%lawn%'],
    ['title ~ mowing', '%mowing%'],
    ['title ~ grounds maint', '%grounds maint%'],
    ['title ~ catering', '%catering%'],
    ['title ~ food service', '%food service%'],
    ['title ~ trucking', '%trucking%'],
    ['title ~ hauling', '%hauling%'],
    ['title ~ crane', '%crane%'],
    ['title ~ roof', '%roof%'],
    ['title ~ roofing', '%roofing%'],
    ['title ~ window', '%window%'],
    ['title ~ translation', '%translation%'],
    ['title ~ towing', '%towing%'],
  ] as const) {
    await count(label, pat);
  }
}
main();
