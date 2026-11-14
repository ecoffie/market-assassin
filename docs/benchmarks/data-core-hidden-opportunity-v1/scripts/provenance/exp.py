import json,re,numpy as np,sys,pickle
rows=[json.loads(l) for l in open(sys.argv[1])]
for r in rows:
    r['txt']=' '.join(filter(None,[r.get('title'),r.get('description'),r.get('sow_text')])).lower()
E=np.array([r['emb'] if r['emb'] else [0]*1536 for r in rows],dtype=np.float64)
nrm=np.linalg.norm(E,axis=1); nrm[nrm==0]=1; E=E/nrm[:,None]
has=np.array([bool(r['emb']) for r in rows])
B={
 'janitorial':dict(naics=['561720','561740','561790'],psc=['S201','S299'],title=r'janitor|custodial|cleaning',body=r'janitor|custodial|cleaning services|housekeeping',seed=r'^(janitorial|custodial)'),
 'nursing':dict(naics=['561320','621399','621610','621111','624120'],psc=['Q401','Q201','Q999','Q301','Q402','Q503'],title=r'nurs|staffing|medical staff',body=r'\bnurs|\brn\b|\blpn\b|medical staffing|clinical staffing',seed=r'(nurs|staffing)'),
 'hvac':dict(naics=['238220'],psc=['J041','H341','N041','W041','J045'],title=r'hvac|air condition|heating|chiller|boiler|refrigerat',body=r'hvac|air condition|chiller|boiler|heating, ventilat',seed=r'\bhvac\b'),
 'guards':dict(naics=['561612'],psc=['S206'],title=r'guard|security services|security officer',body=r'security guard|guard services|armed guard|unarmed guard|security officer',seed=r'guard'),
 'steelbldg':dict(naics=['238160','238120','332311','236220'],psc=['5410','Y1JZ','Z1JZ','Z2JZ'],title=r'roof|metal building|steel building|pre-?engineered',body=r'metal roof|standing seam|pre-?engineered (metal )?building|steel building',seed=r'(roof)'),
 'parts':dict(naics=['336413','333996','332722','336412','333612'],psc=[],title=r'\bparts?\b|spare|replacement|repair kit',body=r'replacement parts|spare parts|\bnsn\b|national stock number',seed=r'(spare parts|replacement parts)'),
}
res={}
for k,c in B.items():
    A=set(i for i,r in enumerate(rows) if (r['naics_code'] or '') in c['naics'] or (r['psc_code'] or '') in c['psc'] or re.search(c['title'],(r['title'] or '').lower()))
    Bl=set(i for i,r in enumerate(rows) if re.search(c['body'],r['txt']))|set(i for i,r in enumerate(rows) if re.search(c['title'],(r['title'] or '').lower()))
    seeds=[i for i,r in enumerate(rows) if has[i] and re.search(c['seed'],(r['title'] or '').lower()) and ((r['naics_code'] or '') in c['naics'] or (r['psc_code'] or '') in c['psc'])][:8]
    q=E[seeds].mean(0); q/=np.linalg.norm(q)
    s=E@q; s[~has]=-1
    order=np.argsort(-s)
    res[k]=dict(A=A,B=Bl,seeds=seeds,scores=s,order=order)
    top=order[:200]
    inAB=sum(1 for i in top[:50] if i in A or i in Bl)
    hidden=[i for i in order[:300] if i not in A and i not in Bl and i not in seeds]
    print(f"{k}: A={len(A)} B={len(Bl)} A∪B={len(A|Bl)} seeds={len(seeds)} top50∩(A∪B)={inAB} s@50={s[order[49]]:.3f} s@100={s[order[99]]:.3f} s@200={s[order[199]]:.3f} hidden_in_top300={len(hidden)}")
pickle.dump({k:dict(A=v['A'],B=v['B'],seeds=v['seeds'],order=v['order'][:600].tolist(),scores=v['scores'].tolist()) for k,v in res.items()},open(sys.argv[2],'wb'))
