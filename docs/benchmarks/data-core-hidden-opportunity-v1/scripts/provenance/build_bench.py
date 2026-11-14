import json,pickle,re,hashlib,os,shutil,gate
OUT='/Users/ericcoffie/Market Assasin/market-assassin/.claude/worktrees/data-core-benchmark/docs/benchmarks/data-core-hidden-opportunity-v1'
os.makedirs(OUT+'/results',exist_ok=True); os.makedirs(OUT+'/review',exist_ok=True); os.makedirs(OUT+'/scripts',exist_ok=True)
rows=[json.loads(l) for l in open('open.jsonl')]
R=pickle.load(open('res.pkl','rb')); QR=pickle.load(open('qrank.pkl','rb')); L=pickle.load(open('lane100.pkl','rb'))
lex=json.load(open('gate_lexicon.json')); G={g:gate.Gate(lex,g) for g in ('vocab','profile')}
m1=json.load(open('label_meta.json')); m2=json.load(open('label_meta_ext.json'))
L1={j['id']:j for j in map(json.loads,open('labels_r1.jsonl'))}; L2={j['id']:j for j in map(json.loads,open('labels_r2.jsonl'))}
E1={j['id']:j for j in map(json.loads,open('labels_ext_r1.jsonl'))}; E2={j['id']:j for j in map(json.loads,open('labels_ext_r2.jsonl'))}
ADJ=json.load(open('adj.json')); EADJ=json.load(open('adj_ext.json'))
EMAIL=re.compile(r'[\w.+-]+\s?@\s?[\w-]+(\.[\w-]+)+'); PHONE=re.compile(r'(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(\s*(x|ext\.?)\s*\d+)?',re.I)
red=lambda t: PHONE.sub('[phone]',EMAIL.sub('[email]',t)) if t else t
um=lambda c: bool(re.match(r'^(236|237|561210)',c or ''))
narrow_steel=lambda r:(r['naics_code'] or '') in ('238160','238120','332311') or bool(re.search(r'roof|metal building|steel building|pre-?engineered',(r['title'] or '').lower()))
def snip900(r):
  t=(r.get('sow_text') or r.get('description') or ''); t=re.sub(r'<[^>]+>',' ',t); return re.sub(r'\s+',' ',t).strip()[:900]
def snip2500(r):
  t=' '.join(filter(None,[r.get('description'),r.get('sow_text')])); t=re.sub(r'<[^>]+>',' ',t); t=re.sub(r'&[a-z]+;',' ',t); return re.sub(r'\s+',' ',t).strip()[:2500]
items=[('core252',m,L1[m['id']],L2[m['id']],ADJ.get(m['id'])) for m in m1]+[('ext73',m,E1[m['id']],E2[m['id']],EADJ.get(m['id'])) for m in m2]
notices={}; labels=[]; retr=[]
for setname,m,a,b,adj in items:
  i=m['row']; r=rows[i]; k=m['biz']
  if r['notice_id'] not in notices:
    body=' '.join(filter(None,[r['description'],r['sow_text']]))
    notices[r['notice_id']]=dict(notice_id=r['notice_id'],solicitation_number=r['solicitation_number'],title=r['title'],department=r['department'],sub_tier=r['sub_tier'],
      naics_code=r['naics_code'],psc_code=r['psc_code'],notice_type=r['notice_type'],response_deadline=r['response_deadline'],set_aside=r['set_aside_description'],
      embedding_source=r['embedding_source'],has_sow_doc=r['has_sow_doc'],description=red(r['description']),sow_text=red(r['sow_text']),
      body_sha256_unredacted=hashlib.sha256(body.encode()).hexdigest(),sam_url=f"https://sam.gov/opp/{r['notice_id']}/view")
  final=a['label'] if a['label']==b['label'] else adj
  if setname=='core252': final=adj or a['label']   # original protocol: R1 label unless adjudicated; adj.json covers all 26 R1/R2 disagreements
  labels.append(dict(item_id=m['id'],set=setname,business=k,notice_id=r['notice_id'],
    reviewer_1=dict(model='claude-sonnet (subagent)',label=a['label'],evidence=a['evidence']),
    reviewer_2=dict(model='claude-opus (subagent)',label=b['label'],evidence=b['evidence']),
    disagreement=a['label']!=b['label'],adjudicated=adj,adjudicator='claude-opus (main session)' if adj else None,final_label=final,
    label_status='AI_UNVERIFIED',human_label=None,human_reviewer=None,
    excerpt_shown_to_reviewers=red(snip900(r) if setname=='core252' else snip2500(r))))
  order=list(QR[(k,'profile')].keys()); sh=list(QR[(k,'short')].keys())
  inA = narrow_steel(r) if k=='steelbldg' else (i in R[k]['A'])
  body=' '.join(filter(None,[r['description'],r['sow_text']]))
  gv=G['vocab'].check(k,r['title'],body); gp=G['profile'].check(k,r['title'],body)
  retr.append(dict(item_id=m['id'],business=k,notice_id=r['notice_id'],
    A_title_code=inA, B_keyword_body=i in R[k]['B'],
    sem_profile_rank=order.index(i)+1 if i in order else None, sem_profile_score=round(QR[(k,'profile')][i],5) if i in order else None,
    sem_short_rank=sh.index(i)+1 if i in sh else None, sem_short_score=round(QR[(k,'short')][i],5) if i in sh else None,
    umbrella_code=um(r['naics_code']), in_lane_top100=i in L[k],
    gate_vocab=dict(passed=gv['passed'],role=gv['role'],terms=gv['terms'],sentence=red(gv['sentence'])),
    gate_profile=dict(passed=gp['passed'],role=gp['role'],terms=gp['terms'],sentence=red(gp['sentence']))))
w=lambda p,L_: open(p,'w').write('\n'.join(json.dumps(x,ensure_ascii=False) for x in L_)+'\n')
w(OUT+'/notices.jsonl',sorted(notices.values(),key=lambda x:x['notice_id'])); w(OUT+'/labels.jsonl',labels); w(OUT+'/retrieval.jsonl',retr)
shutil.copy('queries.json',OUT+'/queries.json'); shutil.copy('gate_lexicon.json',OUT+'/gate_lexicon.json'); shutil.copy('vocab_raw.json',OUT+'/scripts/vocab_raw.json')
shutil.copy('gate.py',OUT+'/scripts/gate.py'); shutil.copy('build_lexicon.py',OUT+'/scripts/build_lexicon.py')
shutil.copy('gate_results.json',OUT+'/results/gate_results_snapshot.json'); shutil.copy('scores.json',OUT+'/results/audit_scores_snapshot.json')
print(len(notices),'notices',len(labels),'labels',len(retr),'retrieval')
print('final',__import__('collections').Counter(l['final_label'] for l in labels), 'None final', sum(l['final_label'] is None for l in labels))
