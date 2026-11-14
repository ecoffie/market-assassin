import json,re,random
rows={}
for l in open('open.jsonl'):
  r=json.loads(l); rows[r['notice_id']]=r
need=json.load(open('label_need_v2.json')); Q=json.load(open('queries.json'))
DESC={'janitorial':'We clean commercial office buildings (janitorial/custodial).','nursing':'We provide nurses and medical staffing.','hvac':'We maintain HVAC systems.','guards':'We provide security guards.','steelbldg':'We erect steel buildings and install metal roofing.','parts':'We supply industrial and defense replacement parts.'}
STOP=set('we our the and of a an to for in on provide supply commercial industrial defense install maintain systems'.split())
def clean(t): t=re.sub(r'<[^>]+>',' ',t or ''); t=re.sub(r'&[a-z#0-9]+;',' ',t); return re.sub(r'\s+',' ',t).strip()
def passages(r,b):
  qw={w for w in re.findall(r'[a-z]+',Q[b][0].lower()) if w not in STOP and len(w)>2}
  qs={w[:5] for w in qw}
  body=clean(' '.join(filter(None,[r['description'],r['sow_text']])))
  ex=body[:1800]; cand=[]
  for s in re.split(r'(?<=[.!?;])\s+',body[1800:]):
    sc=len({w[:5] for w in re.findall(r'[a-z]+',s.lower())}&qs)
    if sc: cand.append((sc,s[:350]))
  cand.sort(key=lambda x:-x[0]); return ex,[c[1] for c in cand[:3]]
items=[(b,n) for b,v in need.items() for n in v['new']]
random.seed(23); random.shuffle(items)
meta=[];halves=[[],[]]
for i,(b,n) in enumerate(items):
  r=rows[n]; iid=f"{b[:3]}-v{i:03d}"; ex,ps=passages(r,b)
  meta.append(dict(id=iid,biz=b,notice_id=n))
  txt=f"### {iid}\nBUSINESS: {DESC[b]}\nTITLE: {r['title']}\nAGENCY: {r['department']} / {r['sub_tier']}\nNOTICE TYPE: {r['notice_type']}\nTEXT (first 1,800 chars): {ex}\n"
  if ps: txt+="LATER PASSAGES (selected only by word overlap with the business description):\n"+'\n'.join('- '+p for p in ps)+'\n'
  halves[i%2].append(txt)
for h in (0,1): open(f'label_sheet_v2_{h}.md','w').write('\n'.join(halves[h]))
json.dump(meta,open('label_meta_v2.json','w')); print(len(meta),[len(h) for h in halves])
