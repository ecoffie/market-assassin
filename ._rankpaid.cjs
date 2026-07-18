const { createClient } = require('@supabase/supabase-js');
const Stripe=require('stripe');
const fs=require('fs');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'').replace(/\\n/g,'');}
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const stripe=new Stripe(env.STRIPE_SECRET_KEY);
const DIR='/private/tmp/claude-501/-Users-ericcoffie-Projects-market-assassin/f8006a69-9a36-40a7-aede-da2be1325ff9/scratchpad';
const NOW=Date.parse('2026-06-29T12:00:00Z');
const usd=c=>Math.round((c||0)/100);
const ADVOCATE=new Set(['westover105@gmail.com']);
const COMP=new Set(['aj@cypherintel.com','pa.joof@pjaygroup.com','dare2dreaminc615@gmail.com','olga@olaexecutiveconsulting.com','tavinalford@gmail.com']);
const isTest=e=>{e=e.toLowerCase();const d=e.split('@')[1]||'';return e.includes('healthcheck')||d.endsWith('.govcongiants.com')||d.endsWith('.govcongiants.org')||d==='govcongiants.com'||d==='govcongiants.test'||/(^|[^a-z])test/.test(e)||e==='coffietest@gmail.com';};
const entitled=new Set(['lifetime','1_year','6_month','subscription','beta_preview']);
(async()=>{
  let cls=[];for(let i=0;i<20000;i+=1000){const{data}=await sb.from('customer_classifications').select('email,briefings_access,briefings_expiry,classification_version').range(i,i+999);cls=cls.concat(data||[]);if(!data||data.length<1000)break;}
  const maxV=cls.reduce((m,r)=>Math.max(m,Number(r.classification_version||0)),0);
  const clsLatest=new Map();cls.filter(r=>Number(r.classification_version||0)===maxV).forEach(r=>clsLatest.set((r.email||'').toLowerCase(),r));
  const live=new Set();for(let i=0;i<12000;i+=1000){const{data}=await sb.from('user_notification_settings').select('user_email,is_active,briefings_enabled').range(i,i+999);for(const u of(data||[]))if(u.is_active&&u.briefings_enabled)live.add((u.user_email||'').toLowerCase());if(!data||data.length<1000)break;}
  const pro=[];for(const [email,r] of clsLatest){if(!live.has(email))continue;if(!entitled.has(r.briefings_access))continue;if(r.briefings_expiry&&Date.parse(r.briefings_expiry)<=NOW)continue;pro.push({email,tier:r.briefings_access});}
  const co=new Map();const emails=pro.map(p=>p.email);
  for(let i=0;i<emails.length;i+=300){const{data}=await sb.from('user_profiles').select('email,company_name').in('email',emails.slice(i,i+300));(data||[]).forEach(r=>co.set((r.email||'').toLowerCase(),r.company_name||''));}
  // customer id -> email
  console.log('Pulling customers...');const cust=new Map();let sa;do{const r=await stripe.customers.list({limit:100,...(sa?{starting_after:sa}:{})});for(const c of r.data)if(c.livemode!==false)cust.set(c.id,(c.email||'').toLowerCase());sa=r.has_more?r.data[r.data.length-1].id:null;}while(sa);
  console.log('  customers:',cust.size);
  // ALL charges once
  console.log('Pulling all charges...');const paidByEmail=new Map(),lastByEmail=new Map();let n=0,sc;
  do{const r=await stripe.charges.list({limit:100,...(sc?{starting_after:sc}:{})});
    for(const x of r.data){n++;if(!(x.status==='succeeded'&&x.paid&&!x.refunded&&(x.amount_refunded||0)===0&&x.livemode!==false&&x.amount>0))continue;
      const em=(x.customer&&cust.get(x.customer))||(x.billing_details&&x.billing_details.email||'').toLowerCase()||(x.receipt_email||'').toLowerCase();if(!em)continue;
      paidByEmail.set(em,(paidByEmail.get(em)||0)+x.amount);const d=new Date(x.created*1000).toISOString().slice(0,10);if(!lastByEmail.get(em)||d>lastByEmail.get(em))lastByEmail.set(em,d);}
    sc=r.has_more?r.data[r.data.length-1].id:null;if(n%2000===0)process.stdout.write(`\r  charges ${n}`);
  }while(sc);
  console.log('\r  charges scanned:',n);
  const FOUNDERS=2997;
  const rows=pro.map(p=>{const paid=usd(paidByEmail.get(p.email)||0);let merit;
    if(ADVOCATE.has(p.email))merit='Advocate — comp (keep)';else if(p.tier==='lifetime')merit='Already lifetime';
    else if(paid>=FOUNDERS)merit='AUTO-GRANT Founders (paid >= $2,997)';else if(paid>=500)merit='Credit toward Founders';
    else if(paid>=1)merit='Alumni rate ($2,997)';else if(isTest(p.email))merit='Test/system - drop';
    else if(COMP.has(p.email))merit='Comp/testimonial (keep)';else merit='$0 comp - decide';
    return {email:p.email,paid,tier:p.tier,last:lastByEmail.get(p.email)||'',company:co.get(p.email)||'',merit};}).sort((a,b)=>b.paid-a.paid);
  const tally={};for(const r of rows)tally[r.merit]=(tally[r.merit]||0)+1;
  let out='=== LIVE-PRO POOL ('+rows.length+') RANKED BY WHAT THEY ACTUALLY PAID (live Stripe) ===\n';
  out+='total paid across pool: $'+rows.reduce((s,r)=>s+r.paid,0).toLocaleString()+'\n\nby disposition:\n';
  for(const[k,v]of Object.entries(tally).sort((a,b)=>b[1]-a[1]))out+='  '+String(v).padStart(4)+'  '+k+'\n';
  out+='\nTop 35 payers:\n  '+'paid$'.padStart(8)+'  tier         last        email / company\n';
  for(const r of rows.slice(0,35))out+='  '+('$'+r.paid).padStart(8)+'  '+r.tier.padEnd(12)+' '+(r.last||'').padEnd(11)+' '+r.email+(r.company?'  ('+r.company+')':'')+'\n';
  const esc=v=>{const s=(v==null?'':String(v)).replace(/"/g,'""');return /[",\n]/.test(s)?`"${s}"`:s;};
  fs.writeFileSync(DIR+'/pro-ranked-by-paid.csv',['email,company_name,paid_usd,entitlement_tier,last_charge,disposition',...rows.map(r=>[r.email,r.company,r.paid,r.tier,r.last,r.merit].map(esc).join(','))].join('\n')+'\n');
  fs.writeFileSync(DIR+'/pro-ranked-summary.txt',out);
  console.log('\n'+out);
  console.log('Wrote pro-ranked-by-paid.csv + pro-ranked-summary.txt');
})();
