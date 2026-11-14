# Builds the two FROZEN evidence-gate lexicons. Run once; output hashed.
import json,hashlib,re
V={k:v.split('|') for k,v in json.load(open('vocab_raw.json')).items()}
TRADE_CODES={'janitorial':['561720','561740','561790'],'nursing':['561320','621399','621610','621111','624120'],
 'hvac':['238220'],'guards':['561612'],'steelbldg':['238160','238120','332311'],'parts':['336413','333996','332722','336412','333612']}
UMBRELLA=[c for c in V if c.startswith('236') or c.startswith('237') or c=='561210']
# trade-agnostic procurement stoplist (fixed before scoring; no trade words)
STOP=set('''services service work works design phase accordance with period amount obligated base option year management support
contract contracts order call delivery provide install construction facility facilities systems system units unit project program wide area
idiq training performance engineering production local state throughout mission comprehensive international funding recurring
specifications drawings materials material bill remove single double action cases statement requirement personal plant water fire control
others centers center common foreign procure procurement test aggregate professional certified report express section under additional
public regions affairs southeast labor hour exercise contract repair replace replacement maintenance inspection removal rental unit
assembly power space storage structure temporary lease close plain angle drive self applicable manufactured manufacture machine'''.split())
umb_terms=set(t for c in UMBRELLA for t in V[c])
vocab={}
for k,codes in TRADE_CODES.items():
  keep=[]
  for c in codes:
    for t in V.get(c,[]):
      w=t.split()
      if all(x in STOP for x in w): continue
      if t in umb_terms: continue
      if len(w)==1 and t in STOP: continue
      if t not in keep: keep.append(t)
  vocab[k]=keep
# PROFILE lexicon: content noun phrases taken verbatim from each business's own profile description (queries.json[biz][1]); single generic words dropped
profile={
 'janitorial':['janitorial','custodial','commercial cleaning','daily cleaning','restroom sanitation','trash removal','floor care','carpet cleaning','window washing'],
 'nursing':['healthcare staffing','registered nurse','licensed practical nurse','nursing assistant','clinical staff'],
 'hvac':['hvac','heating','ventilation','air conditioning','chiller','boiler','air handler','rooftop unit','building controls'],
 'guards':['security services','armed security','unarmed security','security guard','security officer','access control','patrol','visitor screening'],
 'steelbldg':['pre-engineered steel building','steel building','metal roofing','standing seam','wall panel','structural steel framing','structural steel'],
 'parts':['replacement part','spare part','component','assemblies','military equipment','nsn','part number'],
}
out={'version':'gate-lexicon-v1','frozen_at':'2026-11-14','vocabulary_source':'naics_vocabulary (prod Supabase, read-only) for trade NAICS; minus fixed STOP list; minus any term in umbrella-code vocab (236*,237*,561210)',
 'stoplist':sorted(STOP),'trade_codes':TRADE_CODES,'umbrella_codes':sorted(UMBRELLA),'vocab':vocab,'profile':profile}
s=json.dumps(out,indent=1,sort_keys=True); open('gate_lexicon.json','w').write(s)
print(hashlib.sha256(s.encode()).hexdigest())
for k in vocab: print(k,'VOCAB',vocab[k][:40]); print(k,'PROFILE',profile[k])
