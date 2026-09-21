import { createClient } from '@supabase/supabase-js';
import { makeTier1Tools, type Tier1Db } from '@/lib/chat/tier1-tools';
import { extractBusinessActivity } from '@/lib/beginner/activity';
import { classifyOpportunities } from '@/lib/beginner/relevance';
import type { SamSearchItem, SamSearchResult } from '@/lib/beginner/types';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tools = makeTier1Tools(db as unknown as Tier1Db);

const INPUTS = process.argv.slice(2);

async function main() {
  for (const description of INPUTS) {
    const a = extractBusinessActivity(description);
    console.log('\n══', JSON.stringify(description));
    console.log('   head=' + JSON.stringify(a.head), 'conf=' + a.confidence, 'rung=' + a.rung, 'terms=' + JSON.stringify(a.terms));
    if (!a.head) { console.log('   → needsClarification'); continue; }
    const res = (await tools.execute('search_sam_opportunities', { keyword: a.head, limit: 40 })) as SamSearchResult;
    if (!res.ok || !('items' in res)) { console.log('   search unavailable', JSON.stringify(res)); continue; }
    const items = res.items as SamSearchItem[];
    const out = classifyOpportunities(items, { activity: a, codes: [], broaderTerms: [] });
    console.log(`   returned=${items.length} direct=${out.direct.length} broader=${out.broader.length} reject=${out.rejected.length}`);
    for (const e of out.evidence) {
      const tag = e.evidence.tier === 'direct' ? 'DIRECT ' : e.evidence.tier === 'broader' ? 'broader' : 'reject ';
      if (e.evidence.tier === 'reject') continue;
      const why = e.evidence.reasons.filter((r) => /outlier|only the broad term|shortened/.test(r)).join('; ');
      console.log(`   [${tag}] ${(e.item.naics ?? '------').padEnd(7)} ${String(e.item.title).slice(0, 80)}${why ? '   << ' + why : ''}`);
    }
    const rej = out.rejected.slice(0, 6);
    for (const item of rej) console.log(`   [reject ] ${(item.naics ?? '------').padEnd(7)} ${String(item.title).slice(0, 96)}`);
    if (out.rejected.length > 6) console.log(`   ... +${out.rejected.length - 6} more rejected`);
  }
}
main();
