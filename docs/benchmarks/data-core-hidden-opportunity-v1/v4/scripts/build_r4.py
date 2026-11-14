# Round 4 label sets: retrieval sample, code-floor sample, top-20 per variant, rule-removed rows, protective-services probe.
import json,re,random,os,hashlib
S=os.path.dirname(os.path.abspath(__file__))
CAP=json.load(open(f'{S}/r4_capture.json')); Q=json.load(open(f'{S}/queries_v4.json'))
ROWS={}
for l in open(f'{S}/r4_rows.jsonl'):
  if l.strip(): r=json.loads(l); ROWS[r['notice_id']]=r
R3=os.path.join(os.path.dirname(S),'r3')
r3lab={}
if os.path.exists(f'{R3}/r3_meta.json'):
  meta={m['id']:m for m in json.load(open(f'{R3}/r3_meta.json'))}
  for k in (1,2):
    for f in os.listdir(R3):
      if f.startswith('lab_') and f.endswith(f'_r{k}.jsonl'):
        for l in open(f'{R3}/{f}'):
          if l.strip(): j=json.loads(l); m=meta[j['id']]; r3lab.setdefault((m['biz'],m['notice_id']),{})[k]=j
def pick(ids,n,salt):
  return sorted(ids,key=lambda i:hashlib.sha256(f'r4|{salt}|{i}'.encode()).hexdigest())[:n]
PROT=re.compile(r'security (guard|officer|services|force)|protective (security|services|force)|access control|force protection|armed (guard|officer)|guard (services|force|post)|patrol services|security escort|visitor screening',re.I)
plan={}
for b,c in CAP['queries'].items():
  if 'sets' not in c: continue
  base,A,C=c['sets']['base'],c['sets']['A'],c['sets']['C']; sA,sC=set(A),set(C)
  why={}
  def add(ids,tag):
    for i in ids: why.setdefault(i,set()).add(tag)
  removedA=[i for i in base if i not in sA]; removedC=[i for i in A if i not in sC]
  if removedA or removedC:
    add(pick([i for i in base if i in sA],25,b+'keptA'),'sample_keptA')
    add(pick(removedA,25,b+'remA'),'sample_removedA')
    if b=='guards':
      add(C,'all_C'); add(pick(removedC,25,b+'remC'),'sample_removedC')
  else:
    add(pick(base,30,b+'base'),'sample_base')
  add(pick(c['floor'],25,b+'floor'),'floor_sample')
  for v in ('base','A','C'): add(c['window'][v][:20],f'top20_{v}')
  if b=='guards':
    prot=[i for i,r in ROWS.items() if PROT.search(' '.join(filter(None,[r.get('title'),r.get('description')])))]
    rem_prot=[i for i in base if i not in sC and i in ROWS and PROT.search(' '.join(filter(None,[ROWS[i].get('title'),ROWS[i].get('description'),ROWS[i].get('sow_text')])))]
    add(pick(prot,40,'prot'),'protective_probe'); add(rem_prot,'removed_protective_terms')
  plan[b]={i:sorted(t) for i,t in why.items()}
STOP=set('we our the and of a an to for in on provide supply are is like do sell commercial industrial install maintain systems services service company'.split())
stems=lambda t:{w[:5] for w in re.findall(r'[a-z]+',(t or '').lower()) if w not in STOP and len(w)>2}
clean=lambda t:re.sub(r'\s+',' ',re.sub(r'&[a-z#0-9]+;',' ',re.sub(r'<[^>]+>',' ',t or ''))).strip()
NSN=re.compile(r'\b\d{4}-\d{2}-\d{3}-\d{4}\b|\bNSN[:\s#]*\d{13}\b',re.I)
def support(r,b):
  body=clean(' '.join(filter(None,[r.get('description'),r.get('sow_text')]))); sents=[s for s in re.split(r'(?<=[.!?;])\s+',body) if s]
  qs=stems(Q[b]['q'][0]); ps=stems(Q[b]['q'][1]); best=None
  for i,s in enumerate(sents):
    w=stems(s); sc=(len(w&qs),len(w&ps))
    if sc[0]+sc[1]>0 and (best is None or sc>best[0]): best=(sc,i)
  if not best: return None,None,body
  i=best[1]; return sents[i][:500],' '.join(sents[max(0,i-1):i+2])[:1100],body
items=[]
for b,ids in plan.items():
  for n,tags in ids.items():
    if n not in ROWS: continue
    if (b,n) in r3lab and len(r3lab[(b,n)])==2 and Q[b]['cat']=='service': continue   # reuse r3 labels (same protocol) for services
    items.append((b,n))
random.seed(41); random.shuffle(items)
meta=[]; sheets={'service':[],'product':[]}
for k,(b,n) in enumerate(items):
  r=ROWS[n]; cat=Q[b]['cat']; iid=f'r4-{k:04d}'; meta.append(dict(id=iid,biz=b,notice_id=n,cat=cat))
  sent,ctx,body=support(r,b)
  t=f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nTITLE: {clean(r.get('title'))}\nAGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n"
  if cat=='product':
    nsn=sorted(set(NSN.findall(body)))[:6]
    t+=f"PRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n"+(f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n" if nsn else '')
  if sent: t+=f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n"
  else: t+="SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n"
  t+=f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n"
  sheets[cat].append(t)
SZ=35; out=[]
for cat,lst in sheets.items():
  for j in range(0,len(lst),SZ):
    fn=f'sheet_{cat}_{j//SZ:02d}.md'; open(f'{S}/{fn}','w').write('\n'.join(lst[j:j+SZ])); out.append(fn)
json.dump(meta,open(f'{S}/r4_meta.json','w')); json.dump({b:v for b,v in plan.items()},open(f'{S}/r4_plan.json','w'))
print({b:len(v) for b,v in plan.items()},'new items',len(items),'service',len(sheets['service']),'product',len(sheets['product']),'sheets',len(out))
