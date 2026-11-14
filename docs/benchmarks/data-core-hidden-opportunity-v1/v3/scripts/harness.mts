// A4 ranking eval round 3: capture production FIND Open ordering (A) for each benchmark phrasing, read-only.
import fs from 'fs';
const MA='/Users/ericcoffie/Market Assasin/market-assassin';
const env = Object.fromEntries(fs.readFileSync(MA+'/.env.local','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
for (const k of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) process.env[k]=env[k];
const WT=process.cwd();
const { findOpportunities } = await import(WT+'/src/lib/opportunities/find-opportunities.ts');
const { createClient } = await import(WT+'/node_modules/@supabase/supabase-js/dist/index.mjs');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const OUT=process.argv[2]; const Q=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const snapAt=new Date().toISOString();
for (const [biz, qs] of Object.entries(Q) as any) {
  const q=qs[0]; (globalThis as any).__A4_RANKED=null; const t0=Date.now();
  const r = await findOpportunities({ query:q, horizons:{open_now:true,coming_back:false,coming_soon:false}, limit_per_horizon:20 });
  const obs=(globalThis as any).__A4_RANKED; const h=r.horizons.open_now;
  if(!obs){ console.error(biz,'no ranked captured',h.status); fs.writeFileSync(`${OUT}/${biz}.json`,JSON.stringify({biz,q,status:h.status,items:[]})); continue; }
  const ranked=obs.ranked;
  const apiTop=h.items.map((i:any)=>i.notice_id); const harnessTop=ranked.slice(0,20).map((x:any)=>String(x.row.notice_id));
  const faithful=JSON.stringify(apiTop)===JSON.stringify(harnessTop);
  const ids=ranked.map((x:any)=>String(x.row.notice_id)); const extra:Record<string,any>={};
  for(let i=0;i<ids.length;i+=100){ const {data,error}=await sb.from('sam_opportunities').select('notice_id,sow_text,sow_embedding,embedding_source,solicitation_number,naics_code,psc_code').in('notice_id',ids.slice(i,i+100)); if(error) throw error; for(const d of data!) extra[d.notice_id]=d; }
  const rows=ranked.map((x:any,pos:number)=>{ const id=String(x.row.notice_id); const e=extra[id]||{}; let v=e.sow_embedding; if(typeof v==='string') v=JSON.parse(v);
    return { pos_A:pos+1, notice_id:id, tier:x.label.tier, cls:x.cls, basis:x.label.basis??null, breadth:x.s?.breadth??0, score:x.s?.score??0, fetch_idx:x.i,
      title:x.row.title, department:x.row.department, sub_tier:x.row.sub_tier, notice_type:x.row.notice_type, response_deadline:x.row.response_deadline,
      solicitation_number:e.solicitation_number??x.row.solicitation_number, naics:x.row.naics_code, psc:x.row.psc_code, description:(x.row.description||'').slice(0,8000), sow_text:(e.sow_text||'').slice(0,12000),
      embedding_source:e.embedding_source??null, emb:(Array.isArray(v)&&v.length>100)?v.map((n:number)=>+(+n).toFixed(5)):null }; });
  fs.writeFileSync(`${OUT}/${biz}.json`, JSON.stringify({biz,q,snapshot_at:snapAt,matched_count:obs.count,retrieved:rows.length,evidence_counts:h.evidence_counts??null,eligibility:r.market_interpretation?.retrieval_plan??null,faithful_top20:faithful,api_top20:apiTop,rows}));
  console.error(biz,'matched',obs.count,'retrieved',rows.length,'faithful',faithful,'vec',rows.filter((x:any)=>x.emb).length,'ms',Date.now()-t0);
}
