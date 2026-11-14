// A4 round 4 (read-only): production FIND Open capture + in-memory retrieval emulation over the full open SAM.gov corpus,
// validated against production; then Fix A (org-name masking, no department text recall) and Fix A+B (guard phrase).
import fs from 'fs';
const MA='/Users/ericcoffie/Market Assasin/market-assassin';
const env = Object.fromEntries(fs.readFileSync(MA+'/.env.local','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
for (const k of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY']) process.env[k]=env[k];
const WT=process.cwd(); const OUT=process.argv[2];
const { findOpportunities, labelOpenRow } = await import(WT+'/src/lib/opportunities/find-opportunities.ts');
const { matchesText } = await import(WT+'/src/lib/discovery/matcher.ts');
const { rankRecords } = await import(WT+'/src/lib/discovery/rank.ts');
const { openRetrievalNaics, openRetrievalPsc } = await import(WT+'/src/lib/opportunities/open-relevance.ts');
const { parseMapFilters, applyMapFilters } = await import(WT+'/src/lib/opportunities/map-filters.ts');
const UC:Record<string,Set<string>>={};
async function universe(plan:any){ const mf=plan.horizons.open.mapFilters; const key=JSON.stringify(mf); if(UC[key]) return UC[key]; const f=parseMapFilters((k:string)=>(k==='q'||k==='search'||k==='agency'?null:mf[k]??null)); const ids=new Set<string>(); for(let from=0;;from+=1000){ const {data,error}=await applyMapFilters(sb.from('sam_opportunities').select('notice_id'),f).order('notice_id').range(from,from+999); if(error) throw error; for(const r of data!) ids.add(String(r.notice_id)); if(data!.length<1000) break; } UC[key]=ids; console.error('universe',key,ids.size); return ids; }
const { embedText } = await import(WT+'/src/lib/market/embeddings.ts');
const { createClient } = await import(WT+'/node_modules/@supabase/supabase-js/dist/index.mjs');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const Q = JSON.parse(fs.readFileSync(OUT+'/queries_v4.json','utf8'));
const A3 = JSON.parse(fs.readFileSync(OUT+'/a3_matched_sets.json','utf8'));
// 1. query vectors (cached; new phrasings embedded once)
const vcPath=OUT+'/vcache_v4.json'; const old=JSON.parse(fs.readFileSync(OUT+'/../vcache.json','utf8'));
const vc:Record<string,number[]> = fs.existsSync(vcPath)? JSON.parse(fs.readFileSync(vcPath,'utf8')) : {};
let embedded=0;
for (const b of Object.keys(Q)) for (const q of Q[b].q) { if (vc[q]) continue; if (old[q]) { vc[q]=old[q]; continue; } vc[q]=await embedText(q); embedded++; }
fs.writeFileSync(vcPath, JSON.stringify(vc)); console.error('embedding calls', embedded);
// 2. full open corpus (read-only)
const snapAt=new Date().toISOString();
const COLS='notice_id,title,department,sub_tier,naics_code,psc_code,description,sow_text,set_aside_code,set_aside_description,notice_type,response_deadline,ui_link,solicitation_number,pop_state,pop_city,office_address,map_lat,updated_at,source,sow_embedding';
const corpus:any[]=[]; for(let from=0;;from+=1000){ const {data,error}=await sb.from('sam_opportunities').select(COLS).gt('response_deadline',snapAt).order('notice_id').range(from,from+999); if(error) throw error; for(const r of data!){ let v=r.sow_embedding; if(typeof v==='string') v=JSON.parse(v); r.emb=(Array.isArray(v)&&v.length>100)?v:null; delete r.sow_embedding; corpus.push(r);} if(data!.length<1000) break; }
console.error('corpus', corpus.length, 'non-sam', corpus.filter(r=>r.source!=='sam.gov').length);
// masking (Agent 3 spec: registry org names, 6+ chars multi-word; never mask a name the query contains as a phrase)
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function maskerFor(query:string){
  const ql=query.toLowerCase(); const names:string[]=[];
  for (const n of A3.org_names as string[]) { const base=n.replace(/\s*\([^)]*\)\s*$/,'').trim(); for (const v of [n,base]) { if (v.split(/\s+/).length<2||v.length<6) continue; if (ql.includes(v.toLowerCase())) continue; names.push(v);} }
  names.sort((a,b)=>b.length-a.length); const re=new RegExp('('+names.map(esc).join('|')+')','gi');
  return (t:any)=> typeof t==='string'? t.replace(re,' ') : t;
}
const PHRASE=/security\s+guards?|guard\s+services?|guard\s+force/i;
const codeIn=(codes:string[],v:any,n:number)=>{ const s=String(v||''); return codes.some(c=>c.length<n? s.startsWith(c) : s===c); };
const out:any={snapshot_at:snapAt, corpus:corpus.length, embedded, queries:{}};
for (const [biz,cfg] of Object.entries(Q) as any) {
  const q=cfg.q[0]; (globalThis as any).__A4_RANKED=null;
  const r=await findOpportunities({ query:q, horizons:{open_now:true,coming_back:false,coming_soon:false}, limit_per_horizon:20 });
  const obs=(globalThis as any).__A4_RANKED; const h=r.horizons.open_now;
  if(!obs){ out.queries[biz]={q,status:h.status,error:'no capture'}; console.error(biz,'no capture',h.status); continue; }
  const p=obs.p; const cap=p.market.capability; const tn=openRetrievalNaics(cap), tp=openRetrievalPsc(cap);
  const m=maskerFor(q);
  const U=await universe(p.plan);
  const retr=(row:any, variant:'base'|'A'|'C')=>{
    const code = codeIn(tn,row.naics_code,6) || codeIn(tp,row.psc_code,4);
    if (variant==='base') return code || matchesText(p.plan.matcher,[row.title,row.description,row.sow_text,row.department,row.solicitation_number]);
    const textA = matchesText(p.plan.matcher,[m(row.title),m(row.description),m(row.sow_text),row.solicitation_number]);
    if (variant==='A') return code || textA;
    if (biz!=='guards') return code || textA;
    return code || (textA && PHRASE.test([m(row.title),m(row.description),m(row.sow_text)].join(' ')));
  };
  const masked=(row:any)=>({...row,title:m(row.title),description:m(row.description),sow_text:m(row.sow_text)});
  const prodIdx:Record<string,number>=Object.fromEntries(obs.ranked.map((x:any)=>[String(x.row.notice_id),x.i]));
  const rankWindow=(ids:string[], variant:string)=>{
    const rows=ids.map(id=>byId[id]).sort((a,b)=> (a.response_deadline||'9999').localeCompare(b.response_deadline||'9999') || ((prodIdx[a.notice_id]??1e9)-(prodIdx[b.notice_id]??1e9))).slice(0,500).map(x=> variant==='base'? x : masked(x));
    const sc=new Map(rankRecords(p.plan, rows, ['title','description','department']).map((s:any)=>[s.row,s]));
    return rows.map((row,j)=>({i:prodIdx[String(row.notice_id)]??(1e6+j),row,label:labelOpenRow(row,p.plan,cap,null),s:sc.get(row)}))
      .sort((a:any,b:any)=>a.label.tier-b.label.tier||(b.s?.breadth??0)-(a.s?.breadth??0)||(b.s?.score??0)-(a.s?.score??0)||a.i-b.i)
      .map((x:any)=>({id:String(x.row.notice_id),cls:x.label.cls,basis:x.label.basis}));
  };
  var byId:Record<string,any>=Object.fromEntries(corpus.map(r=>[String(r.notice_id),r]));
  const base=corpus.filter(r=>U.has(String(r.notice_id))&&retr(r,'base')).map(r=>String(r.notice_id));
  const A:string[]=corpus.filter(r=>U.has(String(r.notice_id))&&retr(r,'A')).map(r=>String(r.notice_id));
  let C=corpus.filter(r=>U.has(String(r.notice_id))&&retr(r,'C')).map(r=>String(r.notice_id));
  const a3q=A3.queries[q]; const mineA=A.slice(), mineC=C.slice();
  if(a3q){ const keep=new Set(base); A.splice(0,A.length,...a3q.A.filter((i:string)=>keep.has(i))); if(a3q.A_plus_phrase) C=a3q.A_plus_phrase.filter((i:string)=>keep.has(i)); else C=A.slice(); }
  // class of every retrieved row under each variant (labeller sees masked text under A/C)
  const clsAll=(ids:string[],variant:string)=>Object.fromEntries(ids.map(id=>{const row=variant==='base'?byId[id]:masked(byId[id]); return [id,labelOpenRow(row,p.plan,cap,null).cls];}));
  const prodWin=obs.ranked.map((x:any)=>String(x.row.notice_id));
  const emuWin=rankWindow(base,'base').map(x=>x.id);
  const prodRank=Object.fromEntries(obs.ranked.map((x:any,k:number)=>[String(x.row.notice_id),{pos:k+1,tier:x.label.tier,cls:x.cls,breadth:x.s?.breadth??0,score:x.s?.score??0,i:x.i}]));
  const a3=A3.queries[q]||null;
  const sameSet=(x:string[],y:string[])=>{const a=new Set(x),b=new Set(y);return {onlyMine:[...a].filter(i=>!b.has(i)).length,onlyTheirs:[...b].filter(i=>!a.has(i)).length};};
  const floorIds=corpus.filter(r=>U.has(String(r.notice_id))&&(codeIn(cfg.floor.naics,r.naics_code,6)||codeIn(cfg.floor.psc,r.psc_code,4))).map(r=>String(r.notice_id));
  out.queries[biz]={q,cat:cfg.cat,prod_count:obs.count,api_top20:h.items.map((i:any)=>i.notice_id),
    prod_rank:prodRank, validation:{emulated_base_count:base.length,prod_count:obs.count,window_equal:JSON.stringify(prodWin)===JSON.stringify(emuWin),top20_equal:JSON.stringify(prodWin.slice(0,20))===JSON.stringify(emuWin.slice(0,20)),
      vs_agent3: a3? {base:sameSet(base,a3.baseline),A:sameSet(A,a3.A),C:a3.A_plus_phrase?sameSet(C,a3.A_plus_phrase):null}:null},
    retrieval_codes:{naics:tn,psc:tp}, sets:{base,A,C}, sets_source: a3q?'agent3':'agent4_masking', mine:{A:mineA,C:mineC}, floor:floorIds,
    cls:{base:clsAll(base,'base'),A:clsAll(A,'A'),C:clsAll(C,'C')},
    window:{base:prodWin, A:rankWindow(A,'A').map(x=>x.id), C:rankWindow(C,'C').map(x=>x.id)},
    window_cls:{A:Object.fromEntries(rankWindow(A,'A').map(x=>[x.id,x.cls])),C:Object.fromEntries(rankWindow(C,'C').map(x=>[x.id,x.cls]))}};
  console.error(biz,'prod',obs.count,'emu',base.length,'A',A.length,'C',C.length,'floor',floorIds.length,'floorInBase',floorIds.filter(i=>base.includes(i)).length,'win=',out.queries[biz].validation.window_equal,'vsA3',JSON.stringify(out.queries[biz].validation.vs_agent3));
}
fs.writeFileSync(OUT+'/r4_capture.json', JSON.stringify(out));
// compact corpus (text for labelling + vectors kept out)
const keep=new Set<string>(); for(const v of Object.values(out.queries) as any) { if(!v.sets) continue; for(const s of [v.sets.base,v.floor]) s.forEach((i:string)=>keep.add(i)); }
fs.writeFileSync(OUT+'/r4_rows.jsonl', corpus.filter(r=>keep.has(String(r.notice_id))).map(r=>JSON.stringify({...r,emb:undefined,description:(r.description||'').slice(0,8000),sow_text:(r.sow_text||'').slice(0,12000)})).join('\n'));
fs.writeFileSync(OUT+'/r4_vecs.json', JSON.stringify(Object.fromEntries(corpus.filter(r=>keep.has(String(r.notice_id))&&r.emb).map(r=>[r.notice_id,r.emb.map((x:number)=>+(+x).toFixed(5))]))));
console.error('done rows',keep.size);
