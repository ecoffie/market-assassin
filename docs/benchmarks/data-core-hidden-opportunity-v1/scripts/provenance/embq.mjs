import fs from 'fs';
const MA='/Users/ericcoffie/Market Assasin/market-assassin';
const key=fs.readFileSync(MA+'/.env.local','utf8').split('\n').find(l=>l.startsWith('OPENAI_API_KEY=')).split('=').slice(1).join('=').replace(/^"|"$/g,'');
const Q=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const out={}; let tokens=0; const t0=Date.now();
const inputs=[]; for(const [k,v] of Object.entries(Q)) v.forEach((t,i)=>inputs.push([k,i,t]));
const res=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'text-embedding-3-small',input:inputs.map(x=>x[2])})});
const j=await res.json(); if(!j.data){console.error(JSON.stringify(j).slice(0,300));process.exit(1)}
j.data.forEach((d,n)=>{const [k,i]=inputs[n]; (out[k]??=[])[i]=d.embedding;}); tokens=j.usage.total_tokens;
fs.writeFileSync(process.argv[3],JSON.stringify(out)); console.error('calls=1 inputs',inputs.length,'tokens',tokens,'cost$',(tokens*0.02/1e6).toFixed(7),'ms',Date.now()-t0);
