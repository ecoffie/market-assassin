import { createRequire } from 'module';
import fs from 'fs';
const MA='/Users/ericcoffie/Market Assasin/market-assassin';
const require = createRequire(MA+'/package.json');
const { createClient } = require('@supabase/supabase-js');
const env = Object.fromEntries(fs.readFileSync(MA+'/.env.local','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const out = fs.createWriteStream(process.argv[2]);
const now = new Date().toISOString();
let from=0, n=0; const t0=Date.now();
for(;;){
  const {data,error} = await sb.from('sam_opportunities').select('notice_id,title,department,sub_tier,naics_code,psc_code,notice_type,response_deadline,embedding_source,has_sow_doc,description,sow_text,sow_embedding,solicitation_number,set_aside_description').gt('response_deadline', now).order('notice_id').range(from, from+499);
  if(error){console.error(error.message); process.exit(1);}
  for(const r of data){ const e = typeof r.sow_embedding==='string'?JSON.parse(r.sow_embedding):r.sow_embedding; r.emb = (Array.isArray(e)&&e.length>100)? e.map(x=>+x.toFixed(5)):null; delete r.sow_embedding; r.sow_text = r.sow_text? r.sow_text.slice(0,6000):null; r.description = r.description? r.description.slice(0,4000):null; out.write(JSON.stringify(r)+'\n'); n++; }
  if(data.length<500) break; from+=500;
}
out.end(); console.error('rows',n,'ms',Date.now()-t0);
