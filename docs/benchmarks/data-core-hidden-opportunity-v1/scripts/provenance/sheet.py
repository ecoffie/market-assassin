import json,re,pickle,random
rows=[json.loads(l) for l in open('open.jsonl')]
R=pickle.load(open('res.pkl','rb')); QR=pickle.load(open('qrank.pkl','rb'))
DESC={'janitorial':'We clean commercial office buildings (janitorial/custodial).','nursing':'We provide nurses and medical staffing.','hvac':'We maintain HVAC systems.','guards':'We provide security guards.','steelbldg':'We erect steel buildings and install metal roofing.','parts':'We supply industrial and defense replacement parts.'}
def snip(r):
  t=(r.get('sow_text') or r.get('description') or '')
  t=re.sub(r'<[^>]+>',' ',t); t=re.sub(r'\s+',' ',t).strip()
  return t[:900]
random.seed(7); items=[]; key={}
for k in DESC:
  sem=list(QR[(k,'profile')].keys())[:30]
  ab=[i for i in (R[k]['A']|R[k]['B']) if i not in sem and rows[i]['emb']]
  samp=random.sample(sorted(ab),min(12,len(ab)))
  for i in sem+samp:
    if (k,i) in key: continue
    key[(k,i)]=1; items.append((k,i))
random.shuffle(items)
lines=[]; meta=[]
for n,(k,i) in enumerate(items):
  r=rows[i]; iid=f"{k[:3]}-{n:03d}"
  meta.append(dict(id=iid,biz=k,row=i,notice_id=r['notice_id']))
  lines.append(f"### {iid}\nBUSINESS: {DESC[k]}\nTITLE: {r['title']}\nAGENCY: {r['department']} / {r['sub_tier']}\nNOTICE TYPE: {r['notice_type']}\nTEXT: {snip(r)}\n")
open('label_sheet.md','w').write('\n'.join(lines)); json.dump(meta,open('label_meta.json','w'))
print(len(items))
