import { createClient } from '@supabase/supabase-js';
import { makeTier1Tools, type Tier1Db } from '@/lib/chat/tier1-tools';
import { searchBeginnerHiddenMarket, toHiddenMarketLandingView } from '@/lib/beginner/hidden-market';
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tools = makeTier1Tools(db as unknown as Tier1Db);

const INPUTS = [
  'can a 2 person garbage company do government contracts',
  'I clean office buildings',
  'we do IT support for small offices',
  'staffing agency',
  'I run a small construction company',
  'I own a landscaping business',
  'physical security guard services',
  'we cater events',
  'trucking company',
  'we install commercial roofing',
  'I do commercial cleaning and small construction jobs',
  'I help businesses',
];

async function main() {
  for (const description of INPUTS) {
    const result = await searchBeginnerHiddenMarket(
      { description },
      {
        deriveKeywords: (i) => deriveCompanyKeywords(i),
        searchSam: async (args) => (await tools.execute('search_sam_opportunities', args)) as never,
      },
    );
    const view = toHiddenMarketLandingView(result);
    console.log('\n══', JSON.stringify(description));
    console.log('   keyword=' + JSON.stringify(result.directKeyword),
      'expanded=' + JSON.stringify(result.expandedKeyword),
      'outcome=' + view.outcome,
      'direct=' + (result.reveal.directMatchCount ?? 'null'),
      'related=' + result.related.length);
    if (result.reveal.stageSummary) console.log('   stages:', result.reveal.stageSummary);
    if (view.message) console.log('   message:', view.message);
    for (const c of view.directCards) console.log('   [DIRECT ] ', c.stage.padEnd(16), '|', c.audienceLabel, '|', c.title);
    for (const c of view.uncoveredCards) console.log('   [UNCOV  ] ', c.stage.padEnd(16), '|', c.title);
    for (const c of view.relatedCards) console.log('   [RELATED] ', c.stage.padEnd(16), '|', c.title);
  }
}
main();
