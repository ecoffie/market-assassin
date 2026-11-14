import json,re,numpy as np,pickle
rows=[json.loads(l) for l in open('open.jsonl')]
R=pickle.load(open('res.pkl','rb')); Q=json.load(open('qvec.json'))
idx=np.array([i for i,r in enumerate(rows) if r['emb']]); E=np.array([rows[i]['emb'] for i in idx]); E/=np.linalg.norm(E,axis=1)[:,None]
out={}
for k in Q:
  A,B=R[k]['A'],R[k]['B']
  for vi,name in [(0,'short'),(1,'profile')]:
    q=np.array(Q[k][vi]); q/=np.linalg.norm(q); s=E@q; o=np.argsort(-s)
    top=[int(idx[j]) for j in o[:40]]
    nab=sum(1 for i in top if i in A or i in B)
    print(f"{k:10s} {name:7s} p50={np.percentile(s,50):.3f} p99={np.percentile(s,99):.3f} >=.50:{(s>=.5).sum():4d} >=.45:{(s>=.45).sum():4d} top40∩(A∪B)={nab} s@10={s[o[9]]:.3f} s@40={s[o[39]]:.3f}")
    out[(k,name)]={int(idx[j]):float(s[j]) for j in o[:400]}
pickle.dump(out,open('qrank.pkl','wb'))
