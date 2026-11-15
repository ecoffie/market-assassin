import fs from 'fs';
const { loadBenchEnv, exportToProcess } = await import(new URL('./bench-env.mts', import.meta.url).href); // runtime-resolved: portable, and outside tsc's import rules
const env = loadBenchEnv(['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'], process.cwd());
exportToProcess(env, ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']);
const WT=process.cwd();
const { findOpportunities } = await import(WT+'/src/lib/opportunities/find-opportunities.ts');
const { matchesText } = await import(WT+'/src/lib/discovery/matcher.ts');
const cases:Record<string,string[]>={'We supply industrial valves.':['VALVE,SOLENOID','industrial valves','valves','supply valves','supply of industrial valves','valve supply'],
 'We supply fasteners like bolts, screws and nuts.':['53--SCREW,CAP,SOCKET HE','BOLT','screws and bolts'],
 'We clean commercial office buildings.':['Custodial Services for the 88th DPW','Janitorial Services at FAA Facilities','office cleaning services'],
 'We do landscaping and grounds maintenance.':['Grounds maintenance services for Riverside National Cemetery','Snow Removal Services','landscaping services']};
for (const [q,ts] of Object.entries(cases)) { (globalThis as any).__A4_RANKED=null; const r=await findOpportunities({query:q,horizons:{open_now:true,coming_back:false,coming_soon:false},limit_per_horizon:1}); const p=(globalThis as any).__A4_RANKED?.p;
  const { eligibilityLabel } = await import(WT+'/src/lib/opportunities/find-opportunities.ts'); console.log(q,'| elig:',eligibilityLabel(p.plan),'| matcher:',JSON.stringify(p.plan.matcher).slice(0,400)); if(0) console.log(q,'| eligibility:',r.horizons.open_now.eligibility_label??r.market_interpretation?.retrieval_plan?.eligibility??'', '| cap.direct:',JSON.stringify(p?.market?.capability?.direct??null).slice(0,160));
  for (const t of ts) console.log('   ',matchesText(p.plan.matcher,[t])?'MATCH':'no   ',t); }
