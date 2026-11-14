/**
 * READ-ONLY counterfactual evaluation of shared-planner corrections (Agent 3, 2026-11-14).
 *
 * Each variant is derived from the canonical plan's OWN ops (no planner file is edited). Only NARROWING
 * variants are evaluated here: their result is a subset of canonical, so the existing blind labels
 * (stratified: legacy-only / canonical-only / both / neither) give an unbiased ratio estimate of precision
 * and recall without new labeling. Widening variants need a fresh labeling round.
 *
 *   FIXTURE_DIR=<dir with pool.json + labels.json> OUT=<file> npx tsx scripts/eval-search-variants.ts
 * Fixture: tests/fixtures/saved-search-relevance-2026-11-14/ (PR #2043).
 */
import { config } from 'dotenv'; config({ path: '.env.local', quiet: true } as never);
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { mapsOpenRequest, queryNamesMarket } from '@/lib/opportunities/maps-open-discovery';
import { applyOps, buildTextMatcher, conceptRegexes, imatchClause } from '@/lib/discovery';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const FX=(process.env.FIXTURE_DIR||'tests/fixtures/saved-search-relevance-2026-11-14')+'/';
const { key } = JSON.parse(fs.readFileSync(FX+'pool.json','utf8')); const L = JSON.parse(fs.readFileSync(FX+'labels.json','utf8'));
const dropCols=(expr:string, cols:string[])=>{ let e=expr; for(const c of cols){ const re=new RegExp(`,?${c}\\.i?match\\."(?:[^"\\\\]|\\\\.)*"`,'g'); e=e.replace(re,''); } return e.replace(/\(,/g,'(').replace(/^,/,''); };
const dropNaics=(expr:string, codes:string[])=>{ let e=expr; for(const c of codes){ e=e.replace(new RegExp(`,?naics_code\\.(?:eq|like)\\.${c}%?`,'g'),''); } return e.replace(/\(,/g,'(').replace(/^,/,''); };
const COLS=['title','description','sow_text','department','solicitation_number'];
let CURRENT_Q='';
const tax=(e:string)=>(e.match(/(?:naics_code|psc_code)\.(?:eq|like)\.[A-Za-z0-9%]+/g)||[]);
const cooccur=(win:number|null)=>(e:string)=>{
  const m:any=buildTextMatcher(CURRENT_Q,[]); const a=m.alternatives?.[0];
  if(!a||a.shape!=='concept_query'||a.eligible.length<2) return e;
  const res=a.eligible.map((c:any)=>{const r=conceptRegexes(c); return r.ci;}).filter(Boolean) as string[];
  if(res.length!==a.eligible.length) return e;
  const per=COLS.map((col)=>{
    if(win!=null&&res.length===2){ const [x,y]=res; return imatchClause(col,`(${x}.{0,${win}}${y}|${y}.{0,${win}}${x})`); }
    return `and(${res.map((r)=>imatchClause(col,r)).join(',')})`;
  });
  return [...per, ...tax(e)].join(',');
};
const VARIANTS:Record<string,(e:string)=>string>={
  canonical:(e)=>e,
  title_desc:(e)=>dropCols(e,['department','sow_text','solicitation_number']),
  core_naics:(e)=>dropNaics(e,['561210','561730']),
  same_field:cooccur(null),
  near60:cooccur(60),
  near25:cooccur(25),
};
async function ids(filters:any, v:(e:string)=>string, labeled:string[]){
  CURRENT_Q=String(mapsOpenRequest((k)=>filters[k]??null).plan.intent.residual||'');
  const req=mapsOpenRequest((k)=>filters[k]??null); req.filters.postedDays=30;
  const f={...req.filters, search:'', agency:'', state:req.plan.horizons.open.mapFilters.state??'', psc:req.plan.horizons.open.mapFilters.psc??''};
  if (queryNamesMarket(req.plan)) { f.profileNaics=[]; f.profileStates=[]; }
  const ops=req.plan.horizons.open.ops.map((o:any)=>o.op==='or'&&o.expr.includes('title.')?{...o,expr:v(o.expr)}:o);
  const build=(sel:string,opt?:any)=>applyOps(applyMapFilters(db.from('sam_opportunities').select(sel,opt),f),ops);
  const head=await build('notice_id',{count:'exact',head:true});
  const got:string[]=[]; for(let i=0;i<labeled.length;i+=150){ const {data,error}=await build('notice_id').in('notice_id',labeled.slice(i,i+150)); if(error) throw error; got.push(...(data||[]).map((r:any)=>r.notice_id)); }
  return {count:head.count, got:new Set(got)};
}
const INTENTS:Record<string,any>={hvac:{q:'hvac maintenance'},medstaff:{q:'medical staffing'},janitorial:{q:'janitorial services'},novice_clean:{q:'we clean office buildings'},novice_nurses:{q:'nurses for VA hospitals'},geo_guard_tx:{q:'security guard services in Texas'},geo_georgia:{q:'construction in Georgia'},novice_ac:{q:'I fix air conditioners for government buildings'},broad_construction:{q:'construction'},agency_va:{agency:'Department of Veterans Affairs',naics:'561720'}};
(async()=>{ const rows:any[]=[];
 for(const [id,filters] of Object.entries(INTENTS)){ const k=key[id]; const items=Object.entries<string>(k.items); const nid=(it:string)=>it.split(':')[1];
   // total relevant estimate (original strata)
   const est=(keep:(it:string)=>boolean)=>{ let rel=0,ret=0; for(const s of Object.keys(k.sizes)){ const its=items.filter(([,st])=>st===s); if(!its.length) continue; const w=k.sizes[s]/its.length; for(const [it] of its){ if(!keep(it)) continue; ret+=w; if(L[it]) rel+=w; } } return {rel,ret}; };
   const totalRel=est(()=>true).rel;
   for(const [vn,v] of Object.entries(VARIANTS)){ const r=await ids(filters,v,items.map(([it])=>nid(it))); const e=est((it)=>r.got.has(nid(it)));
     rows.push({intent:id,variant:vn,n:r.count,precision:e.ret?Math.round(100*e.rel/e.ret):null,recall:totalRel?Math.round(100*e.rel/totalRel):null}); }
 }
 console.table(rows); fs.writeFileSync(process.env.OUT!,JSON.stringify(rows));
})();
