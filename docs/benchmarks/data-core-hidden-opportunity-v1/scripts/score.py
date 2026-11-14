#!/usr/bin/env python3
"""Recompute every benchmark number from the files in this folder alone (no DB, no API).
Usage: python3 -I scripts/score.py [--labels final|human|merged]
--labels human uses human_label where a human has filled it in, else skips the item (reported).
--labels merged uses human_label where filled in, else the AI final_label (mixed provenance; say so when quoting)."""
import json,sys,os,collections,hashlib
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE); sys.path.insert(0,HERE)
import gate
mode=sys.argv[sys.argv.index('--labels')+1] if '--labels' in sys.argv else 'final'
assert mode in ('final','human','merged'), mode
rd=lambda f:[json.loads(l) for l in open(os.path.join(ROOT,f)) if l.strip()]
N={n['notice_id']:n for n in rd('notices.jsonl')}; LB={l['item_id']:l for l in rd('labels.jsonl')}; RT={r['item_id']:r for r in rd('retrieval.jsonl')}
lexraw=open(os.path.join(ROOT,'gate_lexicon.json')).read(); lex=json.loads(lexraw)
print('lexicon sha256',hashlib.sha256(lexraw.encode()).hexdigest())
G={g:gate.Gate(lex,g) for g in ('vocab','profile')}
def lab(i):
  l=LB[i]
  if mode=='human': return l['human_label']
  if mode=='merged': return l['human_label'] or l['final_label']
  return l['final_label']
rel=lambda x:x in('FIT','PARTIAL')
# 1. reviewer agreement
for s in ('core252','ext73'):
  it=[l for l in LB.values() if l['set']==s]
  ex=sum(l['reviewer_1']['label']==l['reviewer_2']['label'] for l in it); ra=sum(rel(l['reviewer_1']['label'])==rel(l['reviewer_2']['label']) for l in it)
  print(f"{s}: n={len(it)} exact-agree={ex} relevant-agree={ra} adjudicated={sum(1 for l in it if l['adjudicated'])}")
# 2. lane evaluation (C vs D gates), labels per mode
skipped=0; res=collections.defaultdict(lambda: collections.defaultdict(lambda: collections.Counter()))
for i,r in RT.items():
  if not r['in_lane_top100']: continue
  y=lab(i)
  if y is None: skipped+=1; continue
  n=N[r['notice_id']]; body=' '.join(filter(None,[n['description'],n['sow_text']]))
  for K in (30,100):
    if r['sem_profile_rank']>K: continue
    b=res[f"{r['business']}@{K}"]; b['C']['shown']+=1; b['C']['rel']+=rel(y)
    pv=G['vocab'].check(r['business'],n['title'],body)['passed']; pp=G['profile'].check(r['business'],n['title'],body)['passed']
    for g,p in (('vocab',pv),('profile',pp),('either',pv or pp)):
      if p: b[g]['shown']+=1; b[g]['rel']+=rel(y)
      else: b[g]['abstain']+=1; b[g]['abstained_rel']+=rel(y)
pool=collections.defaultdict(collections.Counter)
for key in sorted(res):
  line=[key]
  for g in ('C','vocab','profile','either'):
    c=res[key][g]; p=f"{c['rel']}/{c['shown']}" if c['shown'] else '0/0'; line.append(f"{g}={p}")
    K=key.split('@')[1]; pool[f"{g}@{K}"].update(c)
  print('  '.join(line))
for k,c in sorted(pool.items()): print(f"POOLED {k}: shown={c['shown']} relevant={c['rel']} precision={(c['rel']/c['shown']) if c['shown'] else float('nan'):.3f} abstained={c['abstain']} abstained_relevant={c['abstained_rel']}")
if skipped: print('items without a label in this mode:',skipped)
