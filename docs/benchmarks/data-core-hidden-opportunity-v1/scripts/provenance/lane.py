import json,pickle,re
rows=[json.loads(l) for l in open('open.jsonl')]
R=pickle.load(open('res.pkl','rb')); QR=pickle.load(open('qrank.pkl','rb'))
meta=json.load(open('label_meta.json')); labeled={(m['biz'],m['row']) for m in meta}
um=lambda c: bool(re.match(r'^(236|237|561210)',c or ''))
narrow={'steelbldg':lambda r:(r['naics_code'] or '') in ('238160','238120','332311') or re.search(r'roof|metal building|steel building|pre-?engineered',(r['title'] or '').lower())}
out={}
for k in R:
  A=R[k]['A']; order=list(QR[(k,'profile')].keys())
  inA=(lambda i: bool(narrow[k](rows[i]))) if k in narrow else (lambda i: i in A)
  for K in (30,60,100):
    lane=[i for i in order[:K] if not inA(i) and um(rows[i]['naics_code'])]
    unl=[i for i in lane if (k,i) not in labeled]
    print(k,K,'lane',len(lane),'unlabeled',len(unl),'families',len({rows[i]['solicitation_number'] or rows[i]['notice_id'] for i in lane}))
  out[k]=[i for i in order[:100] if not inA(i) and um(rows[i]['naics_code'])]
pickle.dump(out,open('lane100.pkl','wb'))
