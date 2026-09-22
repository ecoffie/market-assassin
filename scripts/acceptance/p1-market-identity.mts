/** P1 — RC-1 market identity + RC-5 measurement consistency. Read-only. */
process.env.SAM_DOCS_READONLY = 'on';
import { queryKeywordCoverage } from '../../src/lib/market/keyword-coverage';
import { generateMarketReport } from '../../src/mcp/tools/market-report';
let pass = true; const chk=(n:string,ok:boolean,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)pass=false;};

// RC-1 — identity resolves for a multi-word capability, and the control is unchanged
const bc: any = await queryKeywordCoverage('building construction and renovation');
chk('RC-1 construction phrase resolves an identity', bc.status === 'MARKET_EVIDENCE_FOUND',
  `status=${bc.status} total=${bc.coverage?.totalMarket ?? 'null'}`);
chk('RC-1 identity is a BROAD market, not one narrow slice', (bc.coverage?.allNaics?.length ?? 0) >= 10,
  `${bc.coverage?.allNaics?.length ?? 0} NAICS`);
chk('RC-1 resolution route is disclosed', !!bc.coverage?.identityResolvedVia,
  `via=${bc.coverage?.identityResolvedVia}`);
const dr0: any = await queryKeywordCoverage('drones');
chk('RC-1 drones control unchanged (literal still wins)', dr0.status === 'MARKET_EVIDENCE_FOUND' && !dr0.coverage?.identityResolvedVia,
  `total=${dr0.coverage?.totalMarket} naics=${dr0.coverage?.allNaics?.length}`);

// RC-5 — MA/236220 scope mismatch is labelled, not merged
const ma: any = await generateMarketReport({ naics:'236220', state:'MA', userEmail:'eric@govcongiants.com' } as any);
const mb = ma.summary?.total_market_basis;
chk('RC-5 MA headline discloses it is NOT state-scoped', mb?.requested_state === 'MA' && mb?.state_scoped === false,
  JSON.stringify(mb));
chk('RC-5 MA HTML labels the headline national', (ma.deliverable?.html||'').includes('Total market (national)'));
chk('RC-5 MA HTML carries the reconciliation note', (ma.deliverable?.html||'').includes('answer a different question'));

// RC-5 — drones two-tier insight PRESERVED (valuable behaviour, not a bug)
const dr: any = await generateMarketReport({ keyword:'drones', userEmail:'eric@govcongiants.com' } as any);
chk('RC-5 drones keeps the two-tier insight', (dr.reconciliation?.missed_pct ?? 0) > 0.3,
  `single NAICS = ${((dr.reconciliation?.single_naics_pct ?? 0)*100).toFixed(1)}% of the market`);
chk('RC-5 drones not reduced to a single NAICS', (dr.summary?.naics_count ?? 0) > 1,
  `${dr.summary?.naics_count} buying NAICS`);
console.log(pass?'\n✅ P1 RC-1 + RC-5 VERIFIED':'\n❌ FAILED');
process.exit(pass?0:1);
