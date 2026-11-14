import json,hashlib,csv,os,re
B='/Users/ericcoffie/Market Assasin/market-assassin/.claude/worktrees/data-core-benchmark/docs/benchmarks/data-core-hidden-opportunity-v1'
rd=lambda f:[json.loads(l) for l in open(os.path.join(B,f)) if l.strip()]
N={n['notice_id']:n for n in rd('notices.jsonl')}; LB=rd('labels.jsonl'); RT={r['item_id']:r for r in rd('retrieval.jsonl')}
Q=json.load(open(os.path.join(B,'queries.json')))
REC=[ # (business, notice_id prefix, why traditional missed, evidence quoted in audit)
 ('steelbldg','a08792cfdd04','Title "Minor Construction / Sustainability, Repair and Maintenance" names no work; filed 236220 general building','"SCOPE OF WORK 50\'x100\'x18\' Red Iron Storage Facility"'),
 ('steelbldg','ab6b9a4a51a9','Title names the aircraft program (F-15 AGE facility), not the building; filed 236220','"pre-engineered metal warehouse storage building ... Pre-Engineered Metal Buildings (PEMB)"'),
 ('steelbldg','c4094dc11366','Title says Outdoor Fitness Facility; filed 236220 / PSC 5670','"PRE-ENGINEERED BUILDING (PEB): The Contractor shall ... provide ... pre-engineered shop drawings and all materials"'),
 ('steelbldg','1ba6bd542284','"Storage building" with no material named; MEP-led title; filed 236220','"installation of pre-fabricated metal storage building"'),
 ('steelbldg','210d9a8ca71f','Large lab project; title is a facility name; filed 236220','"structural steel framing ... insulated metal panel exterior skin"'),
 ('hvac','2cf886b2e3c7','Filed 333415 / PSC 4120 (equipment), not an HVAC service code','AHU supply and installation'),
 ('hvac','28d5fb2c970b','Filed 236220 / N099; title says CRAC units, no HVAC keyword in the trade list used','computer room air conditioner replacement'),
 ('hvac','0f2a3d5c74ec','Filed 236220 / Z2JZ; title "Replace Water Source Heat Pump"','"COMPLETE MECHANICAL REPLACEMENT OF THE HVAC SYSTEMS SERVING BUILDING HP259"'),
 ('hvac','1511422418e8','Filed 236220 / Z2EC; title leads with cooling tower and roofing','cooling tower replacement within roofing/structural construction'),
 ('hvac','ada6d118165a','Filed 236220 / Z2JZ; title "Design/Build Maintenance and Repair Army Reserve (MRAR)"','"repair of the failing HVAC and electrical systems"'),
 ('hvac','32611396cf6b','Filed 562910 / F108 (remediation)','cleaning plenums, air-handling components and ductwork'),
]
def find(biz,pref):
  for l in LB:
    if l['business']==biz and l['notice_id'].startswith(pref): return l
  raise SystemExit('missing '+biz+pref)
def sem(r):
  if r['sem_profile_rank']: return f"Meaning rank #{r['sem_profile_rank']} of 9,929 (cosine {r['sem_profile_score']:.3f}) for the customer's own description"
  return "Not in the top 400 by meaning; recovered by body-text keywords"+(' (keyword layer matched)' if r['B_keyword_body'] else '')
def scope(l,r):
  s=r['gate_profile']['sentence'] or r['gate_vocab']['sentence']
  return s if s else l['excerpt_shown_to_reviewers'][:500]
rec_items=[]; rows=[]
for n,(biz,pref,why,ev) in enumerate(REC,1):
  l=find(biz,pref); r=RT[l['item_id']]; rec_items.append(l['item_id'])
  rows.append(('R%02d'%n,'recovered',l,r,why,sem(r),ev))
rec_sols={N[RT[i]['notice_id']]['solicitation_number'] for i in rec_items}
pool=[l for l in LB if N[l['notice_id']]['solicitation_number'] not in rec_sols]
pool.sort(key=lambda l: hashlib.sha256(('agent4-review-v1|'+l['item_id']).encode()).hexdigest())
for n,l in enumerate(pool[:30],1):
  r=RT[l['item_id']]
  why='Traditional title+code search DID return this (title or code matched the trade)' if r['A_title_code'] else 'Title and codes do not carry the trade words/codes searched'
  rows.append(('S%02d'%n,'random',l,r,why,sem(r),None))
G=[]
for l in LB:
  r=RT[l['item_id']]
  if r['in_lane_top100'] and r['gate_profile']['passed'] and r['gate_profile']['sentence'][:50] not in l['excerpt_shown_to_reviewers'] and l['item_id'] not in rec_items:
    G.append(l)
for n,l in enumerate(G,1):
  r=RT[l['item_id']]
  rows.append(('G%02d'%n,'gate-unseen',l,r,'Title and codes do not carry the trade words/codes searched',sem(r),'GATE SENTENCE (AI reviewers did NOT see it)'))
hdr=['review_id','kind','item_id','business','customer_description','notice_id','solicitation_number','title','naics','psc','agency','sam_url','why_traditional_missed_or_found','why_semantic_included','scope_excerpt','gate_profile_passed','gate_vocab_passed','proposed_label','reviewer_1','reviewer_2','adjudicated','HUMAN_LABEL (FIT/PARTIAL/NO)','HUMAN_ACCEPT (Y/N)','HUMAN_NOTES']
with open(os.path.join(B,'review','review_sheet.csv'),'w',newline='') as f:
  w=csv.writer(f); w.writerow(hdr)
  for rid,kind,l,r,why,s,ev in rows:
    nn=N[l['notice_id']]
    w.writerow([rid,kind,l['item_id'],l['business'],Q[l['business']][1],nn['notice_id'],nn['solicitation_number'],nn['title'],nn['naics_code'],nn['psc_code'],f"{nn['department']} / {nn['sub_tier']}",nn['sam_url'],why,s,(ev+' || ' if ev else '')+scope(l,r),r['gate_profile']['passed'],r['gate_vocab']['passed'],l['final_label'],l['reviewer_1']['label'],l['reviewer_2']['label'],l['adjudicated'] or '','','',''])
md=['# Human review package — Data Core hidden-opportunity benchmark v1','',
'**Every label below is an AI judgment (two Claude reviewers + Claude adjudication). None has been checked by a person.** Your job: accept or reject each proposed label. Fill the last three columns of `review_sheet.csv`, then run `python3 -I scripts/score.py --labels human` after copying your labels into `labels.jsonl` → `human_label` (or hand the CSV back and Agent 4 will do it).','',
'## What is in it','- **R01–R11**: the 11 opportunities the audit says traditional search missed and the Data Core recovered.',
'- **G01–G06**: lane items the evidence gate KEPT whose quoted sentence lies outside the excerpt the AI reviewers saw. Their AI label may reflect missing evidence, not wrong evidence. These decide whether the gate\'s false positives are real.',
'- **S01–S30**: 30 labeled notices chosen at random: all 325 labeled items, minus those 11 solicitations, sorted by `sha256("agent4-review-v1|"+item_id)`, first 30 taken. Anyone can re-derive the same 30.','',
'## Labels','- **FIT**: the main work bought is this business\'s service.','- **PARTIAL**: the service is a real, explicitly stated component of a bigger job (they could prime or sub that part).','- **NO**: something else, or no evidence of the service. Do not credit topic similarity or codes alone.','',
'Open the SAM link when the excerpt is not enough. The excerpt is the gate\'s quoted sentence when one exists, otherwise the start of the text the AI reviewers saw.','']
for rid,kind,l,r,why,s,ev in rows:
  nn=N[l['notice_id']]
  md+= [f"### {rid} · {l['business']} · proposed **{l['final_label']}**",f"**{nn['title']}** ({nn['solicitation_number']}, {nn['naics_code']}/{nn['psc_code']}) · {nn['department']} / {nn['sub_tier']} · [SAM]({nn['sam_url']})",
    f"- Traditional: {why}",f"- Semantic: {s}",f"- Evidence: {(ev+' — ') if ev else ''}“{scope(l,r)[:450]}”",
    f"- Reviewer 1: {l['reviewer_1']['label']} ({l['reviewer_1']['evidence']}) · Reviewer 2: {l['reviewer_2']['label']} ({l['reviewer_2']['evidence']})"+(f" · adjudicated {l['adjudicated']}" if l['adjudicated'] else ''),
    "- [ ] Accept  [ ] Reject → correct label: ____",'']
open(os.path.join(B,'review','REVIEW-PACKAGE.md'),'w').write('\n'.join(md))
import collections; print(collections.Counter((k,l['final_label']) for _,k,l,*_ in rows)); print([ (rid,l['business'],l['final_label']) for rid,k,l,*_ in rows if k=='random'])
