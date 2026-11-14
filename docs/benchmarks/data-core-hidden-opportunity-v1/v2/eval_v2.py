# Provenance copy: ran in the session scratchpad against the 2026-11-14 open snapshot (open.jsonl, not committed: 158 MB of
# vectors), the per-query prototype outputs (with plan_class) and the v2 label files. Outputs: results/eval_v2.json.
import json,collections,math,numpy as np,os
S=os.environ.get('A4_SCRATCH', os.path.dirname(os.path.abspath(__file__)))
B='/Users/ericcoffie/Market Assasin/market-assassin/.claude/worktrees/data-core-benchmark/docs/benchmarks/data-core-hidden-opportunity-v1'
rows={}
for l in open(f'{S}/open.jsonl'):
  r=json.loads(l); rows[r['notice_id']]=r
Q=json.load(open(f'{S}/queries.json')); C=json.load(open(f'{S}/vcache.json'))
rel=lambda x:x in('FIT','PARTIAL')
# label per (biz, notice): (lower, upper) relevance
L={}
for l in map(json.loads,open(f'{B}/labels.jsonl')):
  v=rel(l['final_label']); L[(l['business'],l['notice_id'])]=(v,v,'bench')
meta={m['id']:m for m in json.load(open(f'{S}/label_meta_v2.json'))}
r1={};r2={}
for h in (0,1):
  for j in map(json.loads,open(f'{S}/labels_v2_{h}_r1.jsonl')): r1[j['id']]=j['label']
  for j in map(json.loads,open(f'{S}/labels_v2_{h}_r2.jsonl')): r2[j['id']]=j['label']
agree=sum(r1[i]==r2[i] for i in meta); ragree=sum(rel(r1[i])==rel(r2[i]) for i in meta)
for i,m in meta.items():
  a,b=rel(r1[i]),rel(r2[i]); L[(m['biz'],m['notice_id'])]=(a and b, a or b, 'v2')
def wil(k,n,z=1.96):
  if not n: return (None,None)
  p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return (round(c-h,3),round(c+h,3))
def prec(ids,b):
  lo=sum(L[(b,n)][0] for n in ids); hi=sum(L[(b,n)][1] for n in ids); return dict(n=len(ids),rel_low=lo,rel_high=hi,p_low=round(lo/len(ids),3) if ids else None,p_high=round(hi/len(ids),3) if ids else None,ci_low=wil(lo,len(ids)),ci_high=wil(hi,len(ids)))
tier={'DIRECT_MATCH':0,'RELATED_MARKET_CANDIDATE':1,'other':2}
out={'reviewer_agreement':dict(n=len(meta),exact=agree,relevant=ragree)}
for b in Q:
  o=json.load(open(f'{S}/v2_{b}_short.json')); pc=o['plan_class']
  q=np.array(C[Q[b][0]],dtype=np.float64); q/=np.linalg.norm(q)
  m=[n for n in pc if n in rows]
  dl=sorted(m,key=lambda n: rows[n]['response_deadline'] or '9999')[:500]
  cur=sorted(dl,key=lambda n:(tier[pc[n]],rows[n]['response_deadline'] or '9999'))[:20]
  E={n:np.array(rows[n]['emb'],dtype=np.float64) for n in m if rows[n]['emb']}
  sem=sorted(E,key=lambda n:-float(E[n]@q/np.linalg.norm(E[n])))[:20]
  shown=[c['notice_id'] for c in o['shown']]
  fam={}
  for c in o['shown']: fam.setdefault(c['solicitation_number'] or c['notice_id'],[]).append(c['notice_id'])
  famlo=sum(any(L[(b,n)][0] for n in v) for v in fam.values()); famhi=sum(any(L[(b,n)][1] for n in v) for v in fam.values())
  out[b]=dict(released_counts=o['released_counts_unchanged'],find_current_top20=prec(cur,b),semantic_rerank_top20=prec(sem,b),
    v2_lane=dict(rows=prec(shown,b),families=dict(n=len(fam),rel_low=famlo,rel_high=famhi),uncertain_not_shown=len(o['uncertain']),
      via=dict(collections.Counter('+'.join(c['retrieved_via']) for c in o['shown']))))
json.dump(out,open(f'{S}/v2_eval.json','w'),indent=1)
print(json.dumps(out['reviewer_agreement']))
for b in Q:
  v=out[b]; f=lambda d:f"{d['rel_low']}-{d['rel_high']}/{d['n']} ({d['p_low']}-{d['p_high']})"
  print(f"{b:10s} FIND top20 {f(v['find_current_top20'])} | meaning top20 {f(v['semantic_rerank_top20'])} | v2 lane rows {f(v['v2_lane']['rows']) if v['v2_lane']['rows']['n'] else '0 shown'} fams {v['v2_lane']['families']}")
