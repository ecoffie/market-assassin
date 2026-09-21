import json,sys
sys.path.insert(0,'src/mcp/decision-chain')
from role_aware_resolver import resolve_role_aware
FX="src/mcp/decision-chain/fixtures/"
R=json.load(open(FX+"role-extraction-v2.json"))['cases']
bm=json.load(open(FX+"classification-benchmark.json"))
run2={r['case_id']:r for r in json.load(open("src/mcp/decision-chain/RUN-2-clean-results.json"))}
rows=[]
for c in bm['cases']:
    if c['split']!='dev': continue
    cid=c['case_id']; r=R.get(cid)
    if not r: print("!! missing",cid); continue
    roles={'core_product_service':r.get('core_primary'),
           'production_process':r.get('processes'),'equipment_capability':[],
           'inputs_materials':r.get('inputs')}
    out=resolve_role_aware(roles)
    sel=out.get('selected')
    # contract fallback: core_secondary when primary yields nothing
    if sel is None and (r.get('core_secondary') or []):
        out2=resolve_role_aware({**roles,'core_product_service':r['core_secondary'][0]})
        if out2.get('selected'): out,sel=out2,out2.get('selected')
    top3=[x['code'] for x in out.get('candidates',[])[:3]]
    acc=set(c['acceptable_naics']); bad=set(c['unacceptable_naics']); amb=(c['label']=='ambiguous')
    if sel is None: b="justified_abstention" if amb else "unjustified_abstention"
    elif sel in bad: b="unacceptable_confident"
    elif sel in acc: b="acceptable_top"
    elif any(x in acc for x in top3): b="acceptable_candidate_wrong_order"
    else: b="miss"
    rows.append({"case_id":cid,"label":c['label'],"selected":sel,"top3":top3,"bucket":b,
                 "prev":run2.get(cid,{}).get('selected'),"acceptable":c['acceptable_naics'],
                 "source":c['source'],"company":c.get('company')})
json.dump(rows,open("/tmp/run4.json","w"),indent=1)
CL=[r for r in rows if r['label']=='classifiable']; AM=[r for r in rows if r['label']=='ambiguous']
print(f"RUN 4 — role-aware w/ frozen contract. {len(rows)} dev cases\n")
print(f"CLASSIFIABLE ({len(CL)}):")
for b in ["acceptable_top","acceptable_candidate_wrong_order","unjustified_abstention","miss","unacceptable_confident"]:
    print(f"  {b:36} {sum(1 for r in CL if r['bucket']==b)}")
print(f"\nAMBIGUOUS ({len(AM)}):")
print(f"  justified_abstention                 {sum(1 for r in AM if r['bucket']=='justified_abstention')}")
print(f"  forced answer (any selection)        {sum(1 for r in AM if r['selected'] is not None)}")
print(f"\n** unacceptable_confident (all dev): {sum(1 for r in rows if r['bucket']=='unacceptable_confident')} **")
print("\n--- MANUFACTURING FIVE ---")
for r in rows:
    if r['source']=='contractor_website':
        print(f"  {r['case_id']} {r['company'][:28]:28} run2={str(r['prev']):7} -> {str(r['selected']):8} ok={r['acceptable']} {r['bucket']}")
print("\n--- ALL ---")
for r in rows: print(f"  {r['case_id']:4} {r['label'][:5]:5} {str(r['prev']):7} -> {str(r['selected']):8} {r['bucket']}")
