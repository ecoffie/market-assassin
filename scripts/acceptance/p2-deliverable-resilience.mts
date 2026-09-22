/** P2 — deliverable resilience. Read-only; no writes. */
process.env.SAM_DOCS_READONLY='on';
import { generateMarketReport } from '../../src/mcp/tools/market-report';
let pass=true; const chk=(n:string,ok:boolean,d='')=>{console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok)pass=false;};

const dr:any = await generateMarketReport({ keyword:'drones', userEmail:'eric@govcongiants.com' } as any);
chk('P2-1 healthy report publishes', dr._meta?.publication_state==='publish' && !!dr.deliverable?.url,
  `state=${dr._meta?.publication_state}`);
chk('P2-2 every section reports an explicit status',
  (dr._meta?.section_status??[]).length===7 && (dr._meta.section_status).every((s:any)=>['ok','empty','failed','withheld_no_subject'].includes(s.status)),
  (dr._meta?.section_status??[]).map((s:any)=>`${s.name}=${s.status}`).join(' '));
chk('P2-3 the required section is marked required',
  (dr._meta?.section_status??[]).some((s:any)=>s.name==='market_measurement'&&s.required===true));

const thin:any = await generateMarketReport({ keyword:'zzzz nonexistent market qqq', userEmail:'eric@govcongiants.com' } as any);
chk('P2-4 a thin market is insufficient_evidence, NOT measurement_failure',
  thin._meta?.publication_state==='insufficient_evidence', `state=${thin._meta?.publication_state}`);
chk('P2-5 thin market mints no URL', !thin.deliverable?.url);
chk('P2-6 an empty section is distinguishable from a failed one',
  (thin._meta?.section_status??[]).some((s:any)=>s.status==='empty') && (thin._meta?.sections_failed??[]).length===0,
  `failed=${JSON.stringify(thin._meta?.sections_failed)}`);
chk('P2-7 a no-subject section keeps its own status',
  (thin._meta?.section_status??[]).some((s:any)=>s.status==='withheld_no_subject'));
chk('P2-8 customer HTML carries no internal failure detail',
  !['timeout','upstream_error','BigQuery','stack','Error:'].some(t=>(dr.deliverable?.html||'').includes(t)));
console.log(pass?'\n✅ P2 DELIVERABLE RESILIENCE VERIFIED':'\n❌ FAILED');
process.exit(pass?0:1);
