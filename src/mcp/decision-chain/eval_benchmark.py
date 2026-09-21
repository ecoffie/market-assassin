"""ONE frozen run: Option 3 vs the dev split. Scoring per SCORING-RULES-FROZEN.md."""
import json,sys
sys.path.insert(0,'src/mcp/decision-chain')
from taxonomy_resolver import resolve
FX="src/mcp/decision-chain/fixtures/"
bm=json.load(open(FX+"classification-benchmark.json"))
prose=json.load(open(FX+"blind/dev-prose.json"))   # anon_id -> prose
rows=[]
for c in bm["cases"]:
    if c["split"]!="dev": continue
    text=c.get("prose") or prose.get(c.get("anon_id"))
    if not text:
        print(f"!! no prose for {c['case_id']}"); continue
    r=resolve(text)
    sel=r["selected"]; top3=[x["code"] for x in r["candidates"][:3]]
    acc=set(c["acceptable_naics"]); bad=set(c["unacceptable_naics"]); amb=(c["label"]=="ambiguous")
    if sel is None:
        bucket="justified_abstention" if amb else "unjustified_abstention"
    elif sel in bad: bucket="unacceptable_confident"
    elif sel in acc: bucket="acceptable_top"
    elif any(x in acc for x in top3): bucket="acceptable_candidate_wrong_order"
    else: bucket="miss"
    if amb and sel is not None and bucket not in("unacceptable_confident",):
        bucket=bucket+"|forced_answer_on_ambiguous"
    rows.append({"case_id":c["case_id"],"company":c.get("company"),"label":c["label"],
      "selected":sel,"top3":top3,"conf":r.get("confidence"),"bucket":bucket,
      "acceptable":c["acceptable_naics"],"unacceptable":c["unacceptable_naics"],
      "source":c["source"],"cands":[(x["code"],x["title"][:38],round(x["taxonomy_score"],2),x["matched_phrases"][:2]) for x in r["candidates"][:3]]})
json.dump(rows,open("/tmp/bench_run.json","w"),indent=1)
def count(pred,sub=None):
    return sum(1 for r in rows if pred(r) and (sub is None or r["label"]==sub))
CL=[r for r in rows if r["label"]=="classifiable"]; AM=[r for r in rows if r["label"]=="ambiguous"]
print(f"DEV RUN — {len(rows)} cases ({len(CL)} classifiable, {len(AM)} ambiguous)\n")
print("CLASSIFIABLE (16):")
for b in ["acceptable_top","acceptable_candidate_wrong_order","unjustified_abstention","miss","unacceptable_confident"]:
    print(f"  {b:36} {sum(1 for r in CL if r['bucket'].startswith(b))}")
print("\nAMBIGUOUS (5):")
print(f"  justified_abstention                 {sum(1 for r in AM if r['bucket']=='justified_abstention')}")
print(f"  forced_answer_on_ambiguous           {sum(1 for r in AM if 'forced' in r['bucket'])}")
print(f"  unacceptable_confident               {sum(1 for r in AM if r['bucket']=='unacceptable_confident')}")
print(f"\n** HARD SAFETY METRIC unacceptable_confident (all dev): {sum(1 for r in rows if r['bucket']=='unacceptable_confident')} **")
print("\n--- MANUFACTURING FIVE ---")
for r in rows:
    if r["source"]=="contractor_website":
        print(f"  {r['case_id']} {r['company'][:30]:30} sel={r['selected']} conf={r['conf']} ok={r['acceptable']} -> {r['bucket']}")
        for c_ in r["cands"]: print(f"       {c_[0]} {c_[1]:38} {c_[2]:7} {c_[3]}")
print("\n--- ALL DEV CASES ---")
for r in rows: print(f"  {r['case_id']:4} {r['label'][:5]:5} sel={str(r['selected']):8} top3={r['top3']}  {r['bucket']}")
