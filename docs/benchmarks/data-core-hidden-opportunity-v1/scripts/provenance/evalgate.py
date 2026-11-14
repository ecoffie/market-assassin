import json,pickle,re,sys,collections,time
import gate
rows=[json.loads(l) for l in open('open.jsonl')]
QR=pickle.load(open('qrank.pkl','rb')); L=pickle.load(open('lane100.pkl','rb'))
lex=json.load(open('gate_lexicon.json'))
G={'vocab':gate.Gate(lex,'vocab'),'profile':gate.Gate(lex,'profile')}
m1=json.load(open('label_meta.json')); m2=json.load(open('label_meta_ext.json'))
L1={j['id']:j for j in map(json.loads,open('labels_r1.jsonl'))}; ADJ=json.load(open('adj.json'))
E1={j['id']:j for j in map(json.loads,open('labels_ext_r1.jsonl'))}; E2={j['id']:j for j in map(json.loads,open('labels_ext_r2.jsonl'))}
EADJ=json.load(open('adj_ext.json')) if len(sys.argv)>1 else {}
lab={}; src={}
for m in m1: lab[(m['biz'],m['row'])]=ADJ.get(m['id']) or L1[m['id']]['label']; src[(m['biz'],m['row'])]=m['id']
for m in m2:
  a,b=E1[m['id']]['label'],E2[m['id']]['label']
  lab[(m['biz'],m['row'])]=a if a==b else EADJ.get(m['id'],'UNADJ'); src[(m['biz'],m['row'])]=m['id']
rel=lambda x:x in('FIT','PARTIAL')
fam=lambda i: rows[i]['solicitation_number'] or rows[i]['notice_id']
res={}; detail=[]
t0=time.time(); ngate=0
for k in L:
  order=list(QR[(k,'profile')].keys()); rank={i:n+1 for n,i in enumerate(order)}
  for K in (30,100):
    C=[i for i in L[k] if rank[i]<=K]
    out={'C':dict(n=len(C),rel=sum(rel(lab[(k,i)]) for i in C))}
    for gname in ('vocab','profile','either'):
      kept=[];roles=collections.Counter()
      for i in C:
        r=rows[i]; body=' '.join(filter(None,[r['description'],r['sow_text']]))
        if gname=='either':
          a=G['vocab'].check(k,r['title'],body); b=G['profile'].check(k,r['title'],body); g=b if b['passed'] else a
        else: g=G[gname].check(k,r['title'],body); ngate+=1
        if g['passed']:
          kept.append(i); roles[(g['role'],lab[(k,i)])]+=1
          if K==100: detail.append(dict(biz=k,gate=gname,item=src[(k,i)],notice_id=r['notice_id'],solicitation=r['solicitation_number'],title=r['title'],naics=r['naics_code'],psc=r['psc_code'],rank=rank[i],score=round(QR[(k,'profile')][i],4),label=lab[(k,i)],role=g['role'],terms=g['terms'],sentence=g['sentence'],in_description=bool(g['sentence'] and g['sentence'][:60] in gate.clean(r['description'] or ''))))
      rk=[i for i in kept if rel(lab[(k,i)])]
      out[gname]=dict(kept=len(kept),rel=len(rk),fp=len(kept)-len(rk),abstain=len(C)-len(kept),
        precision=(len(rk)/len(kept)) if kept else None,recall_vs_C=(len(rk)/out['C']['rel']) if out['C']['rel'] else None,
        rel_families=len({fam(i) for i in rk}),roles={f'{a}|{b}':c for (a,b),c in roles.items()})
    out['C']['precision']=out['C']['rel']/out['C']['n'] if out['C']['n'] else None
    out['C']['rel_families']=len({fam(i) for i in C if rel(lab[(k,i)])})
    res[f'{k}@{K}']=out
dt=time.time()-t0
pool={}
for K in (30,100):
  for g in ('C','vocab','profile','either'):
    tot=lambda f: sum(res[f'{k}@{K}'][g][f] for k in L if k!='parts')
    n='n' if g=='C' else 'kept'
    pool[f'{g}@{K}']=dict(shown=tot(n),rel=tot('rel'),precision=tot('rel')/tot(n) if tot(n) else None)
json.dump(dict(per_trade=res,pooled=pool,gate_seconds=dt,gate_calls=ngate),open('gate_results.json','w'),indent=1)
json.dump(detail,open('gate_detail.json','w'),indent=1)
for key,v in res.items():
  print(key,'C',v['C'],'| profile',{a:v['profile'][a] for a in ('kept','rel','fp','abstain','precision','recall_vs_C')},'| vocab',{a:v['vocab'][a] for a in ('kept','rel','precision')},'| either',{a:v['either'][a] for a in ('kept','rel','precision','recall_vs_C')})
print(json.dumps(pool,indent=0)); print('gate time',dt,'calls',ngate)
print('unadjudicated',sum(1 for v in lab.values() if v=='UNADJ'))
