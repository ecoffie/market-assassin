#!/usr/bin/env python3
"""Builds the FROZEN v2 evidence rules (rules_v2.json). Mechanical; no label was consulted.
Source of synonyms: U.S. Census Bureau 2022 NAICS Index File (census/2022_NAICS_Index_File.xlsx,
downloaded 2026-11-14 from https://www.census.gov/naics/2022NAICS/2022_NAICS_Index_File.xlsx)."""
import json,re,hashlib,os,openpyxl
HERE=os.path.dirname(os.path.abspath(__file__))
xl=os.path.join(HERE,'census','2022_NAICS_Index_File.xlsx')
v1=json.load(open(os.path.join(HERE,'..','gate_lexicon.json'))); Q=json.load(open(os.path.join(HERE,'..','queries.json')))
rows=list(openpyxl.load_workbook(xl,read_only=True).active.iter_rows(values_only=True))[1:]
TRADE_CODES=v1['trade_codes']
# activity / function words dropped from index entries (trade-agnostic)
ACT=set('''installation install installing manufacturing manufacture contractors contractor services service erecting erection placement placing
application applying and or except e g i the a an of for by at to on in other individual its from with without kind type types not etc
supply supplies suppliers repair repairing maintenance cleaning operating'''.split())
# generic words that may not anchor the overlap with the customer's description (trade-agnostic)
GENERIC=set('''we are a an the and or our we of for to in on at by with from company firm contractor contractors provide provides providing services service
systems system equipment building buildings facility facilities work including include other clinical medical office'''.split())
norm=lambda w: re.sub(r'[^a-z0-9]','',w.lower().replace('-',''))
def stem(w):
  w=norm(w)
  for suf in ('ies','es','s'):
    if len(w)>4 and w.endswith(suf): return w[:-len(suf)]+('y' if suf=='ies' else '')
  return w
def content(entry):
  e=re.sub(r'\([^)]*\)','',str(entry))
  ws=[stem(w) for w in re.split(r'[\s,/;]+',e) if w]
  return sorted({w for w in ws if w and w not in {stem(a) for a in ACT} and len(w)>1})
census={}
for biz,codes in TRADE_CODES.items():
  prof={stem(w) for w in re.split(r'[\s,.:;()]+',Q[biz][1]) if w}-{stem(g) for g in GENERIC}
  keep=[]
  for code,entry in rows:
    if str(code) not in codes or not entry: continue
    cw=content(entry)
    if not cw: continue
    if set(cw)&prof: keep.append(dict(naics=str(code),entry=str(entry).strip(),words=cw))
  census[biz]=keep
CUES=sorted(set('''shall will must required require requires include includes including consist consists consisting provide provides furnish furnishes
install installs installation construct constructs construction erect erects erection replace replaces replacement repair repairs maintain maintains
maintenance perform performs supply supplies deliver delivers remove removes demolish demolition upgrade upgrades renovate renovation scope'''.split()))
rules={'version':'evidence-rules-v2','frozen_at':'2026-11-14','frozen_before':'any v2 evaluation and any notice posted after 2026-11-14',
 'census_source':{'url':'https://www.census.gov/naics/2022NAICS/2022_NAICS_Index_File.xlsx','sha256':hashlib.sha256(open(xl,'rb').read()).hexdigest()},
 'trade_codes':TRADE_CODES,'umbrella_naics_prefixes':['236','237','561210'],
 'profile_phrases':v1['profile'],'census_entries':census,'requirement_cues':CUES,
 'toc_rule':{'section_number_regex':r'\b\d{2}\s\d{2}\s\d{2}(?:\.\d+)?\b','min_section_numbers':2,'division_regex':r'\bDIVISION\s+\d{1,2}\b','note':'a sentence is a spec table-of-contents line if it has >=2 CSI section numbers, or a DIVISION heading plus >=1 section number'},
 'candidate_retrieval':'semantic top-100 (stored notice vectors, customer description embedding) UNION body-text sentences matching a profile phrase or all words of a census entry; then kept only if NAICS starts with an umbrella prefix AND the released FIND Open plan did not retrieve the row',
 'evidence_rule':'a body sentence (description or SOW, never title), not a TOC line, containing (a profile phrase OR all content words of one census entry) AND >=1 requirement cue',
 'roles':{'PRIME_CANDIDATE':'evidence passes and the title also carries a profile phrase or census entry','SUB_SCOPE':'evidence passes, title does not','UNCERTAIN':'a term matched in the body but no sentence passes the evidence rule (no requirement cue, or only TOC lines): not shown in the lane, listed separately'},
 'normalization':'lowercase; hyphens removed (pre-fabricated == prefabricated); simple plural stem (s/es/ies); census entries match when all content words appear in one sentence, any order',
 'not_added':'No hand-written synonyms. "red iron" and "pre-engineered metal building" are absent from the Census index and were NOT added.'}
s=json.dumps(rules,indent=1,sort_keys=True); open(os.path.join(HERE,'rules_v2.json'),'w').write(s)
print('rules_v2 sha256',hashlib.sha256(s.encode()).hexdigest())
for b,v in census.items(): print(b,len(v),[e['entry'] for e in v][:30])
