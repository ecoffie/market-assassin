import json,sys
sys.path.insert(0,'src/mcp/decision-chain')
from validate_extraction import validate, Reject
from role_aware_resolver import resolve_v3
FX="src/mcp/decision-chain/fixtures/"
arm=sys.argv[1]
ex=json.load(open(FX+f"extraction-v3-{arm}.json"))['cases']
P=json.load(open(FX+"blind/dev-prose.json"))
W={c['case_id']:c['prose'] for c in json.load(open(FX+"blind/website-prose.json"))['cases']}
bm=json.load(open(FX+"classification-benchmark.json"))
rows=[];rej=[]
for c in bm['cases']:
    if c['split']!='dev': continue
    cid=c['case_id']; e=ex.get(cid)
    prose=c.get('prose') or P.get(c.get('anon_id')) or W.get(cid)
    if not e: rej.append((cid,'missing_case','')); continue
    try: validate(prose,e); ok=True; why=''
    except Reject as r: ok=False; why=r.code; rej.append((cid,r.code,r.detail[:60]))
    out=resolve_v3(e)
    sel=out.get('selected') if ok else None
    top3=[x['code'] for x in out.get('candidates',[])[:3]]
    acc=set(c['acceptable_naics']); bad=set(c['unacceptable_naics']); amb=(c['label']=='ambiguous')
    if sel is None: b="justified_abstention" if amb else "unjustified_abstention"
    elif sel in bad: b="unacceptable_confident"
    elif sel in acc: b="acceptable_top"
    elif any(x in acc for x in top3): b="acceptable_candidate_wrong_order"
    else: b="miss"
    rows.append({"case_id":cid,"label":c['label'],"selected":sel,"top3":top3,"bucket":b,
      "valid":ok,"reject":why,"ec":out.get('extraction_confidence'),
      "source":c['source'],"company":c.get('company'),"acceptable":c['acceptable_naics'],
      "core":(e.get('primary_offering') or {}).get('value'),"type":(e.get('primary_offering') or {}).get('type')})
json.dump(rows,open(f"/tmp/run5_{arm}.json","w"),indent=1)
CL=[r for r in rows if r['label']=='classifiable']; AM=[r for r in rows if r['label']=='ambiguous']
print(f"=== ARM: {arm.upper()} === {len(rows)} dev cases")
print(f"validation: {sum(1 for r in rows if r['valid'])}/{len(rows)} passed, {len(rej)} rejected")
for cid,code,d in rej: print(f"    REJECT {cid:5} {code} {d}")
print(f"\nCLASSIFIABLE ({len(CL)}):")
for b in ["acceptable_top","acceptable_candidate_wrong_order","unjustified_abstention","miss","unacceptable_confident"]:
    print(f"  {b:36} {sum(1 for r in CL if r['bucket']==b)}")
print(f"AMBIGUOUS ({len(AM)}): justified_abstention {sum(1 for r in AM if r['bucket']=='justified_abstention')} | forced {sum(1 for r in AM if r['selected'])}")
print(f"** unacceptable_confident: {sum(1 for r in rows if r['bucket']=='unacceptable_confident')} **")
print("\nMANUFACTURING FIVE:")
for r in rows:
    if r['source']=='contractor_website':
        print(f"  {r['case_id']} {r['company'][:26]:26} core={str(r['core'])[:34]:34} -> {str(r['selected']):8} {r['bucket']}")
