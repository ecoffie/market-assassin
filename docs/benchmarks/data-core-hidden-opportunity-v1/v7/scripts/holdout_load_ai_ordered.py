# Expected expert-judgment load for the adaptive holdout protocol (v4/HOLDOUT-PROTOCOL-ADAPTIVE.md), simulated on the v7 AI-label preview.
# Simulated human: unanimous AI label with 3% flip; split = coin; PARTIAL = 75%/30%. Short phrasing only. Run: python3 -I scripts/holdout_load_ai_ordered.py
import json,sys,random,collections
import os; V7=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src=open(f'{V7}/scripts/r9.py').read().split("\ncmd = sys.argv[1]\n")[0]
g={'__file__':f'{V7}/scripts/r9.py','__name__':'r9'}; exec(compile(src,'r9.py','exec'),g)
L=g['labels'](); S2=g['S2']; S3=g['S3']; form=g['form']
def truth(b,n,rng):  # simulated human: unanimous = AI label w/ 3% flip; split/partial = coin weighted
    x=L.get((b,n))
    if not x: return rng.random()<.5
    if x['lo']!=x['hi']: return rng.random()<.5
    l=' '.join(map(str,x.get('l',[]))).upper()
    if 'PARTIAL' in l: return rng.random()<.75 if x['lo'] else rng.random()<.3
    return x['lo'] if rng.random()>.03 else not x['lo']
def score(b,n):  # AI ordering key: confidence of relevant
    x=L.get((b,n)); 
    if not x: return .5
    l=' '.join(map(str,x.get('l',[]))).upper()
    return (x['lo']+x['hi'])/2 - (.1 if 'PARTIAL' in l else 0)
for rcs in (['rc2'],['rc2','rc3']):
  tots=[]; perbiz=collections.defaultdict(list)
  for it in range(300):
    rng=random.Random(it); seen={}
    def lab(b,n):
        if (b,n) not in seen: seen[(b,n)]=truth(b,n,rng)
        return seen[(b,n)]
    for p,v3 in S3.items():
        b=v3['business']
        if form(b,p)!='short': continue
        for rc in rcs:
            ids=v3['rc3_top20'] if rc=='rc3' else S2[p]['rc2_top20']
            ai=sum(L[(b,n)]['lo'] for n in ids if (b,n) in L)
            order=sorted(ids,key=lambda n:-score(b,n)) if ai>=8 else sorted(ids,key=lambda n:score(b,n))
            r=nr=0; k0=len(seen)
            for n in order:
                if lab(b,n): r+=1
                else: nr+=1
                if r>=8 or nr>=13: break
    # pooled random sample 120 of the last rc's top-20 pool + 60 recall items (new)
    pool=[(v3['business'],n) for p,v3 in S3.items() if form(v3['business'],p)=='short' for n in (v3['rc3_top20'] if rcs[-1]=='rc3' else S2[p]['rc2_top20'])]
    for bn in rng.sample(pool,120): lab(*bn)
    tots.append(len(seen)+60)
  tots.sort(); print(rcs,'judgments median',tots[150],'p10',tots[30],'p90',tots[270])
