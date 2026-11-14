# Round 4 scoring: retrieval -> classification -> ranking, kept separate. AI labels only (two reviewers -> lower/upper).
import json,os,glob,math,collections,sys
V4=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # v4/
S=V4
CAP=json.load(open(f'{V4}/results/r4_sets.json')); Q=json.load(open(f'{V4}/queries_v4.json'))
PLAN=json.load(open(f'{V4}/labels/r4_plan.json')); META={m['id']:m for m in json.load(open(f'{V4}/labels/r4_meta.json'))}
ROWS={json.loads(l)['notice_id']:json.loads(l) for l in open(f'{V4}/results/r4_rows_min.jsonl') if l.strip()}
rel=lambda x:x in('FIT','PARTIAL')
L={}  # (biz,nid) -> dict(lo,hi,labels,restriction)
def put(b,n,j1,j2,src):
  L[(b,n)]=dict(lo=rel(j1['label']) and rel(j2['label']),hi=rel(j1['label']) or rel(j2['label']),l1=j1['label'],l2=j2['label'],
    role=(j1.get('role'),j2.get('role')),restriction=(j1.get('restriction'),j2.get('restriction')),src=src)
R={1:{},2:{}}
for k in (1,2):
  for f in glob.glob(f'{V4}/labels/lab_*_r{k}.jsonl'):
    for l in open(f):
      if l.strip():
        try: j=json.loads(l); R[k][j['id']]=j
        except Exception: pass
miss=[i for i in META if i not in R[1] or i not in R[2]]
if miss: print('MISSING labels',len(miss),miss[:5]); sys.exit(1)
for i,m in META.items(): put(m['biz'],m['notice_id'],R[1][i],R[2][i],'r4')
R3=os.path.join(os.path.dirname(V4),'v3','labels')
if os.path.exists(f'{R3}/r3_meta.json'):
  m3={m['id']:m for m in json.load(open(f'{R3}/r3_meta.json'))}; r3={1:{},2:{}}
  for k in (1,2):
    for f in glob.glob(f'{R3}/lab_*_r{k}.jsonl'):
      for l in open(f):
        if l.strip(): j=json.loads(l); r3[k][j['id']]=j
  for i,m in m3.items():
    key=(m['biz'],m['notice_id'])
    if key not in L and Q[m['biz']]['cat']=='service' and i in r3[1] and i in r3[2]: put(m['biz'],m['notice_id'],r3[1][i],r3[2][i],'r3')
agree=sum(L[k]['l1']==L[k]['l2'] for k in L); ragree=sum(rel(L[k]['l1'])==rel(L[k]['l2']) for k in L)
def wil(k,n,z=1.96):
  if not n: return None
  p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return [round(c-h,2),round(c+h,2)]
def prec(ids,b):
  ids=[i for i in ids if (b,i) in L]; lo=sum(L[(b,i)]['lo'] for i in ids); hi=sum(L[(b,i)]['hi'] for i in ids)
  return dict(n=len(ids),lo=lo,hi=hi,p=[round(lo/len(ids),2),round(hi/len(ids),2)] if ids else None,ci_lo=wil(lo,len(ids)),ci_hi=wil(hi,len(ids)))
def tagged(b,tag): return [n for n,t in PLAN[b].items() if tag in t]
def title(n): return (ROWS.get(n,{}).get('title') or '')[:80]
OUT={'labels':dict(items=len(L),exact=agree,relevant_vs_not=ragree)}
for b,c in CAP['queries'].items():
  if 'sets' not in c: continue
  cat=Q[b]['cat']; base,A,C=c['sets']['base'],c['sets']['A'],c['sets']['C']; sb,sA,sC=set(base),set(A),set(C)
  floorcodes=Q[b]['floor']
  def infloor(n):
    r=ROWS.get(n,{}); s=str(r.get('naics_code') or ''); p=str(r.get('psc_code') or '')
    return any(s==x for x in floorcodes['naics']) or any((p.startswith(x) if len(x)<4 else p==x) for x in floorcodes['psc'])
  res=dict(cat=cat,q=c['q'],sizes=dict(base=len(base),A=len(A),C=len(C)),sets_source=c['sets_source'])
  # 1. RETRIEVAL precision of the matched set
  if len(A)<len(base) or len(C)<len(A):
    kA=prec(tagged(b,'sample_keptA'),b); rA=prec(tagged(b,'sample_removedA'),b)
    nk,nr=len(A),len(base)-len(A)
    est=lambda f: round((nk*kA[f]+nr*rA[f])/len(base),1) if kA['n'] and rA['n'] else None
    res['retrieval_precision']=dict(base=dict(est_relevant_lo=est('lo') and round(nk*kA['lo']/kA['n']+nr*rA['lo']/rA['n']),est_relevant_hi=round(nk*kA['hi']/kA['n']+nr*rA['hi']/rA['n']),
        p_lo=round((nk*kA['lo']/kA['n']+nr*rA['lo']/rA['n'])/len(base),2),p_hi=round((nk*kA['hi']/kA['n']+nr*rA['hi']/rA['n'])/len(base),2)),
      A=dict(sample=kA), removed_by_A=dict(sample=rA))
    if b=='guards':
      allC=prec(C,b); rC=prec(tagged(b,'sample_removedC'),b)
      res['retrieval_precision']['C']=dict(exact=allC); res['retrieval_precision']['removed_by_B']=dict(sample=rC)
  else:
    res['retrieval_precision']=dict(base=dict(sample=prec(tagged(b,'sample_base'),b)),note='A and C identical to production for this business')
  # 2. RECALL against known relevant notices (every labelled relevant notice for this business, any source) and code floor
  known_lo=[n for (bb,n),v in L.items() if bb==b and v['lo']]; known_hi=[n for (bb,n),v in L.items() if bb==b and v['hi']]
  rec=lambda K,V: dict(n=len(K),found=sum(n in V for n in K),r=round(sum(n in V for n in K)/len(K),2) if K else None)
  res['recall_known']={v:dict(lo=rec(known_lo,s),hi=rec(known_hi,s)) for v,s in (('base',sb),('A',sA),('C',sC))}
  fl=[n for n in tagged(b,'floor_sample') if (b,n) in L]; flrel=[n for n in fl if L[(b,n)]['hi']]
  res['recall_code_floor']=dict(floor_total=len(c['floor']),floor_in_base=sum(n in sb for n in c['floor']),sample=len(fl),sample_relevant_hi=len(flrel),
      found={v:sum(n in s for n in flrel) for v,s in (('base',sb),('A',sA),('C',sC))},
      relevant_floor_not_retrieved=[dict(id=n,title=title(n)) for n in flrel if n not in sb][:12])
  # 3. LOST relevant by each rule (labelled items only; samples are lower bounds on the removed population)
  lostA=[n for (bb,n),v in L.items() if bb==b and v['hi'] and n in sb and n not in sA]
  lostB=[n for (bb,n),v in L.items() if bb==b and v['hi'] and n in sA and n not in sC]
  res['lost']=dict(by_A=[dict(id=n,title=title(n),lo=L[(b,n)]['lo'],labels=[L[(b,n)]['l1'],L[(b,n)]['l2']]) for n in lostA],
                   by_B=[dict(id=n,title=title(n),lo=L[(b,n)]['lo'],labels=[L[(b,n)]['l1'],L[(b,n)]['l2']]) for n in lostB],
                   removed_labelled=dict(by_A=sum((b,n) in L for n in sb-sA),by_B=sum((b,n) in L for n in sA-sC)),removed_total=dict(by_A=len(sb-sA),by_B=len(sA-sC)))
  # 4. CLASSIFICATION accuracy among labelled retrieved rows
  cls=c['cls']; resc={}
  for v,s in (('base',sb),('A',sA),('C',sC)):
    lab=[n for n in s if (b,n) in L]; D=[n for n in lab if cls[v].get(n)=='DIRECT_MATCH']; O=[n for n in lab if cls[v].get(n)!='DIRECT_MATCH']
    relv=[n for n in lab if L[(b,n)]['lo']]
    resc[v]=dict(labelled=len(lab),direct=len(D),direct_relevant_lo=sum(L[(b,n)]['lo'] for n in D),direct_relevant_hi=sum(L[(b,n)]['hi'] for n in D),
      other=len(O),other_relevant_lo=sum(L[(b,n)]['lo'] for n in O),relevant_lo=len(relv),relevant_in_direct=sum(cls[v].get(n)=='DIRECT_MATCH' for n in relv))
  res['classification']=resc
  # 5. RANKING top-20 per variant (production order applied to each variant)
  res['top20']={v:prec(c['window'][v][:20],b) for v in ('base','A','C')}
  # 7. missing/incorrect codes
  relall=[n for (bb,n),v in L.items() if bb==b and v['lo']]
  off=[n for n in relall if not infloor(n)]
  res['off_code_relevant']=dict(n=len(off),retrieved={v:sum(n in s for n in off) for v,s in (('base',sb),('A',sA),('C',sC))}) if floorcodes['naics'] or floorcodes['psc'] else None
  if b=='guards':
    pr=[n for n in tagged(b,'protective_probe')+tagged(b,'removed_protective_terms') if (b,n) in L]; pr=sorted(set(pr))
    prel=[n for n in pr if L[(b,n)]['hi']]
    res['protective_services']=dict(labelled=len(pr),relevant_hi=len(prel),relevant_lo=sum(L[(b,n)]['lo'] for n in pr),
      retrieved={v:sum(n in s for n in prel) for v,s in (('base',sb),('A',sA),('C',sC))},
      relevant_not_in_C=[dict(id=n,title=title(n),in_base=n in sb,in_A=n in sA,lo=L[(b,n)]['lo']) for n in prel if n not in sC])
  if cat=='product':
    rr=[L[(b,n)] for (bb,n) in L if bb==b and L[(bb,n)]['hi']]
    res['restrictions_among_relevant']=dict(collections.Counter(r['restriction'][1] or 'NA' for r in rr))
  OUT[b]=res
json.dump(OUT,open(f'{V4}/results/r4_eval.json','w'),indent=1)
print(json.dumps(OUT['labels']))
f=lambda d: f"{d['lo']}-{d['hi']}/{d['n']}" if d and d.get('n') else '-'
for b in Q:
  r=OUT.get(b); 
  if not r: continue
  rp=r['retrieval_precision']; base=rp['base']
  bp=f"{base['p_lo']}-{base['p_hi']}" if 'p_lo' in base else f(base['sample'])
  line=f"{b:11s} {r['cat'][:4]} n={r['sizes']} retr_base={bp} top20 base {f(r['top20']['base'])} A {f(r['top20']['A'])} C {f(r['top20']['C'])} | recall_known_lo base {r['recall_known']['base']['lo']['found']}/{r['recall_known']['base']['lo']['n']} A {r['recall_known']['A']['lo']['found']} C {r['recall_known']['C']['lo']['found']} | floor {r['recall_code_floor']['found']}/{r['recall_code_floor']['sample_relevant_hi']} of sample {r['recall_code_floor']['sample']} | lostA {len(r['lost']['by_A'])} lostB {len(r['lost']['by_B'])}"
  print(line)
