import { createClient } from '@supabase/supabase-js';
import { makeTier1Tools, type Tier1Db } from '@/lib/chat/tier1-tools';
import { searchBeginnerHiddenMarket, toHiddenMarketLandingView } from '@/lib/beginner/hidden-market';
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tools = makeTier1Tools(db as unknown as Tier1Db);

async function main() {
  for (const description of process.argv.slice(2)) {
    const result = await searchBeginnerHiddenMarket(
      { description },
      {
        deriveKeywords: (i) => deriveCompanyKeywords(i),
        searchSam: async (args) => (await tools.execute('search_sam_opportunities', args)) as never,
      },
    );
    const view = toHiddenMarketLandingView(result);
    console.log('\n══', JSON.stringify(description));
    console.log('   keyword=' + JSON.stringify(result.directKeyword), 'expanded=' + JSON.stringify(result.expandedKeyword),
      'outcome=' + view.outcome, 'direct=' + (result.reveal.directMatchCount ?? 'null'), 'related=' + result.related.length);
    console.log('   EXPLANATION:', result.reveal.explanation);
    if (view.message) console.log('   MESSAGE:', view.message);
    for (const c of view.directCards) console.log('   [DIRECT ]', c.title);
    for (const c of view.uncoveredCards) console.log('   [UNCOV  ]', c.title);
    for (const c of view.relatedCards) console.log('   [RELATED]', c.title);
  }
}
main();
