// READ-ONLY live oracle for the Today's Lens CTA: lensCount (what the alert promises) must equal what the
// Map's own filter (applyMapFilters, no bbox) returns for the link the alert emits (lensMapHref).
// The old strategy-only link is printed for contrast. Usage: npx tsx scripts/verify-lens-cta.ts
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true });
import { computeTodaysLens } from '@/lib/dashboard/todays-lens';
import { lensMapHref } from '@/lib/dashboard/lens-link';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function mapCount(href: string) {
  const sp = new URL(href, 'https://getmindy.ai').searchParams;
  const f = parseMapFilters((k) => sp.get(k));
  let q = sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true });
  q = applyMapFilters(q, f);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count;
}
(async () => {
const { data: users, error } = await sb.from('user_notification_settings').select('user_email,naics_codes').eq('alerts_enabled', true).not('naics_codes', 'is', null).limit(400);
if (error) throw error;
const picks = (users || []).filter((u) => Array.isArray(u.naics_codes) && u.naics_codes.length).sort(() => 0.5 - Math.random()).slice(0, 8);
let bad = 0;
for (const u of picks) {
  const lens = await computeTodaysLens(u.user_email);
  if (!lens.lensStrategy) { console.log(`skip (no lens) codes=${lens.lensNaics.length}`); continue; }
  const now = await mapCount(lensMapHref(lens));
  const old = await mapCount(`/opportunity-map?strategy=${lens.lensStrategy}`);
  // lensCount > 0 → "Explore N recommended" → the link must land on exactly N.
  // lensCount 0 / null → "Explore this market" → the link is the market; compare to totalOpen.
  const sliced = typeof lens.lensCount === 'number' && lens.lensCount > 0;
  const promised = sliced ? lens.lensCount : lens.totalOpen;
  const ok = now === promised;
  if (!ok) bad++;
  console.log(`${ok ? 'MATCH' : 'DIFF '} ${sliced ? 'lens  ' : 'market'} promised=${promised} newLink=${now} oldLink=${old} codes=${lens.lensNaics.length} strands=${lens.lensStrategy}`);
}
console.log(bad ? `${bad} DIFF` : "ALL MATCH"); if (bad) process.exitCode = 1;
})().catch((e) => { console.error('ORACLE ERROR', e.message); process.exit(1); });
