# Score round 3: top-20 precision A vs B (AI labels, two reviewers -> lower/upper bounds), position changes,
# closing-soon displacement, guards with/without Coast Guard / Marine Security Guard collisions.
import json,glob,os,math,statistics as st,datetime as dt,sys
S=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # v3/
BENCH=sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(S),'labels.jsonl')
O=json.load(open(f'{S}/results/r3_orders.json')); M={m['id']:m for m in json.load(open(f'{S}/labels/r3_meta.json'))}
rel=lambda x:x in('FIT','PARTIAL')
R={1:{},2:{}}
for k in (1,2):
  for f in glob.glob(f'{S}/labels/lab_*_r{k}.jsonl'):
    for l in open(f):
      if l.strip(): j=json.loads(l); R[k][j['id']]=j
miss=[i for i in M if i not in R[1] or i not in R[2]]
assert not miss, f'missing labels: {len(miss)} e.g. {miss[:5]}'
L={}; agree=ragree=0; roles={}
for i,m in M.items():
  a,b=R[1][i]['label'],R[2][i]['label']; agree+=a==b; ragree+=rel(a)==rel(b)
  L[(m['biz'],m['notice_id'])]=dict(lo=rel(a) and rel(b),hi=rel(a) or rel(b),r1=a,r2=b,role1=R[1][i].get('role'),role2=R[2][i].get('role'),id=i)
def wil(k,n,z=1.96):
  p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return [round(c-h,2),round(c+h,2)]
def p20(ids,b):
  t=ids[:20]; lo=sum(L[(b,n)]['lo'] for n in t); hi=sum(L[(b,n)]['hi'] for n in t)
  return dict(n=len(t),rel_low=lo,rel_high=hi,ci_low=wil(lo,len(t)) if t else None,ci_high=wil(hi,len(t)) if t else None)
out={'reviewer_agreement':dict(items=len(M),exact=agree,relevant_vs_not=ragree)}
for b,o in O.items():
  snap=dt.datetime.fromisoformat(o['snapshot_at'].replace('Z','+00:00'))
  def days(n):
    d=o['rows'][n]['response_deadline']
    if not d: return None
    t=dt.datetime.fromisoformat(d.replace('Z','+00:00'));  t=t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    return (t-snap).total_seconds()/86400
  res={'q':o['q'],'matched_count':o['matched_count'],'retrieved':o['retrieved'],'faithful_top20':o['faithful_top20'],'evidence_counts':o['evidence_counts']}
  variants=[('A','B')]+([('A_noColl','B_noColl')] if b=='guards' else [])
  for va,vb in variants:
    A,B=o['lists'][va],o['lists'][vb]; tag='' if va=='A' else '_noColl'
    res['A'+tag]=p20(A,b); res['B'+tag]=p20(B,b)
    pa={n:i+1 for i,n in enumerate(A)}; pb={n:i+1 for i,n in enumerate(B)}
    relset=[n for n in set(A[:20])|set(B[:20]) if L[(b,n)]['lo']]
    res['relevant_positions'+tag]=sorted([dict(notice_id=n,title=o['rows'][n]['title'][:70],pos_A=pa[n],pos_B=pb[n]) for n in relset],key=lambda x:x['pos_B'])
    res['median_pos_relevant'+tag]=dict(A=st.median([pa[n] for n in relset]) if relset else None,B=st.median([pb[n] for n in relset]) if relset else None,n=len(relset))
    for w in (7,14):
      ua=[n for n in A[:20] if (days(n) is not None and days(n)<=w)]; ub=[n for n in B[:20] if (days(n) is not None and days(n)<=w)]
      disp=[n for n in ua if n not in B[:20]]
      res[f'closing_{w}d'+tag]=dict(in_A_top20=len(ua),in_B_top20=len(ub),displaced=len(disp),displaced_relevant_upper=sum(L[(b,n)]['hi'] for n in disp),
        displaced_positions_in_B=sorted(pb[n] for n in disp))
  if b=='guards': res['collision_rows']=o['collisions']; res['collisions_in_A_top20']=sum(o['rows'][n]['collision'] for n in o['lists']['A'][:20]); res['collisions_in_B_top20']=sum(o['rows'][n]['collision'] for n in o['lists']['B'][:20])
  res['tiers_in_top20']=dict(A=[o['rows'][n]['cls'] for n in o['lists']['A'][:20]].count('DIRECT_MATCH'),B=[o['rows'][n]['cls'] for n in o['lists']['B'][:20]].count('DIRECT_MATCH'))
  out[b]=res
# pooled (main variant)
for v in ('A','B'):
  lo=sum(out[b][v]['rel_low'] for b in O); hi=sum(out[b][v]['rel_high'] for b in O); n=sum(out[b][v]['n'] for b in O)
  out['pooled_'+v]=dict(n=n,rel_low=lo,rel_high=hi,ci_low=wil(lo,n),ci_high=wil(hi,n))
# human-label overlap (kept separate)
if BENCH:
  H={(l['business'],l['notice_id']):l['human_label'] for l in map(json.loads,open(BENCH)) if l.get('human_label')}
  ov=[dict(biz=b,notice_id=n,human=H[(b,n)],ai_low=v['lo'],ai_high=v['hi']) for (b,n),v in L.items() if (b,n) in H]
  out['human_overlap']=ov
json.dump(dict(out=out,labels={f'{b}|{n}':v for (b,n),v in L.items()}),open(f'{S}/results/r3_eval.json','w'),indent=1)
print(json.dumps(out['reviewer_agreement']))
f=lambda d:f"{d['rel_low']}-{d['rel_high']}/{d['n']}"
for b in O:
  r=out[b]; s=f"{b:10s} A {f(r['A'])} | B {f(r['B'])} | medpos {r['median_pos_relevant']} | close7 {r['closing_7d']} | close14 disp {r['closing_14d']['displaced']}/{r['closing_14d']['in_A_top20']} | DIRECT top20 {r['tiers_in_top20']}"
  if b=='guards': s+=f" || noColl A {f(r['A_noColl'])} B {f(r['B_noColl'])} coll A/B top20 {r['collisions_in_A_top20']}/{r['collisions_in_B_top20']}"
  print(s)
print('pooled A',f(out['pooled_A']),out['pooled_A']['ci_low'],out['pooled_A']['ci_high'],'| B',f(out['pooled_B']),out['pooled_B']['ci_low'],out['pooled_B']['ci_high'])
if BENCH: print('human overlap',len(out['human_overlap']),out['human_overlap'][:6])
