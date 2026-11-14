# Round 3: A = production FIND Open order (captured), B = same rows, tier kept, meaning order within tier
# (vectorless rows after vector rows within the tier, by deadline). Builds blind label sheets.
import json,re,random,os,hashlib,numpy as np
S=os.environ.get('R3_CAPTURE', os.path.dirname(os.path.abspath(__file__))); A4=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q=json.load(open(f'{A4}/../queries.json')); C=json.load(open(f'{A4}/vcache.json'))
BIZ=list(Q)
def clean(t): t=re.sub(r'<[^>]+>',' ',t or ''); t=re.sub(r'&[a-z#0-9]+;',' ',t); return re.sub(r'\s+',' ',t).strip()
GUARD=re.compile(r'\bguards?\b',re.I); COLL=re.compile(r'coast\s+guard|marine\s+security\s+guards?',re.I)
def collision(r):
  t=' '.join(filter(None,[r['title'],r['description'],r['department'],r['sub_tier']]))
  return bool(GUARD.search(t)) and not GUARD.search(COLL.sub(' ',t))
def orders(rows,biz):
  q=np.array(C[Q[biz][0]],dtype=np.float64); q/=np.linalg.norm(q)
  for r in rows: r['cos']=float(np.dot(r['emb'],q)/np.linalg.norm(r['emb'])) if r['emb'] else None
  A=sorted(rows,key=lambda r:r['pos_A'])
  B=sorted(rows,key=lambda r:(r['tier'], r['cos'] is None, -(r['cos'] or 0), r['response_deadline'] or '9999'))
  return A,B
STOP=set('we our the and of a an to for in on provide supply are is commercial industrial install maintain systems services service company'.split())
def stems(t): return {w[:5] for w in re.findall(r'[a-z]+',t.lower()) if w not in STOP and len(w)>2}
def support(r,biz):
  body=clean(' '.join(filter(None,[r['description'],r['sow_text']])))
  sents=[s for s in re.split(r'(?<=[.!?;])\s+',body) if s]
  qs=stems(Q[biz][0]); ps=stems(Q[biz][1])
  best=None
  for i,s in enumerate(sents):
    w=stems(s); sc=(len(w&qs),len(w&ps))
    if sc[0]+sc[1]>0 and (best is None or sc>best[0]): best=(sc,i)
  if not best: return None,body[:1200]
  i=best[1]; ctx=' '.join(sents[max(0,i-1):i+2])[:1100]
  return sents[i][:500],ctx
out={}; need={}
for b in BIZ:
  d=json.load(open(f'{S}/{b}.json')); rows=d['rows']
  for r in rows: r['collision']=collision(r) if b=='guards' else False
  A,B=orders(rows,b)
  lists={'A':[r['notice_id'] for r in A],'B':[r['notice_id'] for r in B]}
  if b=='guards':
    lists['A_noColl']=[r['notice_id'] for r in A if not r['collision']]; lists['B_noColl']=[r['notice_id'] for r in B if not r['collision']]
  out[b]=dict(q=d['q'],snapshot_at=d['snapshot_at'],matched_count=d['matched_count'],retrieved=d['retrieved'],faithful_top20=d['faithful_top20'],
    evidence_counts=d['evidence_counts'],collisions=sum(r['collision'] for r in rows),lists=lists,
    rows={r['notice_id']:{k:r[k] for k in ('pos_A','tier','cls','basis','breadth','score','response_deadline','title','department','sub_tier','notice_type','solicitation_number','naics','psc','embedding_source','cos','collision')} for r in rows})
  ids=set(); [ids.update(v[:20]) for v in lists.values()]
  need[b]=sorted(ids)
  byid={r['notice_id']:r for r in rows}
  for n in need[b]:
    s,ctx=support(byid[n],b); out[b]['rows'][n]['support_sentence']=s; out[b]['rows'][n]['support_context']=ctx
    out[b]['rows'][n]['opening']=clean(byid[n]['description'])[:1200]
json.dump(out,open(f'{S}/r3_orders.json','w'))
DESC={b:Q[b][0] for b in BIZ}
items=[(b,n) for b in BIZ for n in need[b]]
random.seed(31); random.shuffle(items)
meta=[]; sheets=[]
SZ=30
for i,(b,n) in enumerate(items):
  r=out[b]['rows'][n]; iid=f"r3-{i:03d}"; meta.append(dict(id=iid,biz=b,notice_id=n))
  txt=f"### {iid}\nBUSINESS (the customer's own words): {DESC[b]}\nTITLE: {r['title']}\nAGENCY: {r['department']} / {r['sub_tier']}\nNOTICE TYPE: {r['notice_type']}\n"
  if r['support_sentence']: txt+=f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{r['support_sentence']}\"\nCONTEXT AROUND IT: {r['support_context']}\n"
  else: txt+="SUPPORTING SENTENCE: none (no sentence in the notice shares a word with the business description)\n"
  txt+=f"NOTICE OPENING (first 1,200 chars of description): {r['opening']}\n"
  if i%SZ==0: sheets.append([])
  sheets[-1].append(txt)
for k,s in enumerate(sheets): open(f'{S}/sheet_{k}.md','w').write('\n'.join(s))
json.dump(meta,open(f'{S}/r3_meta.json','w'))
print({b:(len(need[b]),out[b]['collisions']) for b in BIZ},'items',len(items),'sheets',len(sheets))
