import json,re,pickle,random
rows=[json.loads(l) for l in open('open.jsonl')]
L=pickle.load(open('lane100.pkl','rb'))
meta=json.load(open('label_meta.json')); labeled={(m['biz'],m['row']) for m in meta}
DESC={'janitorial':'We clean commercial office buildings (janitorial/custodial).','nursing':'We provide nurses and medical staffing.','hvac':'We maintain HVAC systems.','guards':'We provide security guards.','steelbldg':'We erect steel buildings and install metal roofing.','parts':'We supply industrial and defense replacement parts.'}
def snip(r,n=2500):
  t=' '.join(filter(None,[r.get('description'),r.get('sow_text')]))
  t=re.sub(r'<[^>]+>',' ',t); t=re.sub(r'&[a-z]+;',' ',t); t=re.sub(r'\s+',' ',t).strip(); return t[:n]
items=[(k,i) for k in L for i in L[k] if (k,i) not in labeled]
random.seed(11); random.shuffle(items)
lines=[];m2=[]
for n,(k,i) in enumerate(items):
  r=rows[i]; iid=f"{k[:3]}-x{n:03d}"
  m2.append(dict(id=iid,biz=k,row=i,notice_id=r['notice_id'],excerpt_chars=2500))
  lines.append(f"### {iid}\nBUSINESS: {DESC[k]}\nTITLE: {r['title']}\nAGENCY: {r['department']} / {r['sub_tier']}\nNOTICE TYPE: {r['notice_type']}\nTEXT: {snip(r)}\n")
open('label_sheet_ext.md','w').write('\n'.join(lines)); json.dump(m2,open('label_meta_ext.json','w')); print(len(items))
