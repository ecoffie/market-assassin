import json,sys
sys.path.insert(0,'src/mcp/decision-chain')
from taxonomy_resolver import resolve
FX="src/mcp/decision-chain/fixtures/"
b=json.load(open(FX+"classification-set.json"))
SPLIT=sys.argv[1] if len(sys.argv)>1 else "dev"
tot=ok_top=ok_cand=abst=bad=0
for c in b["cases"]:
    if c["split"]!=SPLIT: continue
    tot+=1
    r=resolve(c["description"])
    sel=r["selected"]; top3=[x["code"] for x in r["candidates"][:3]]
    acc=set(c["expect_acceptable"]); wrong=set(c["expect_wrong"])
    if sel is None:
        abst+=1; tag="ABSTAIN"
    elif sel in acc: ok_top+=1; tag="PASS"
    elif sel in wrong: bad+=1; tag="UNACCEPT"
    else: tag="miss"
    if any(x in acc for x in top3): ok_cand+=1
    print(f"{tag:8} {c['id']:30} sel={sel} conf={r['confidence']} top3={top3}")
    if tag in ("UNACCEPT","miss","ABSTAIN"):
        for x in r["candidates"][:3]: print(f"          {x['code']} {x['title'][:38]:38} {x['taxonomy_score']:.2f} {x['matched_phrases'][:2]}")
print(f"\n[{SPLIT}] acceptable-top {ok_top}/{tot} | acceptable-in-top3 {ok_cand}/{tot} | abstain {abst} | UNACCEPTABLE-CONFIDENT {bad}")
