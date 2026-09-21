import json,urllib.request,re,sys,time
FX="src/mcp/decision-chain/fixtures/"
b=json.load(open(FX+"classification-set.json"))
STOP=set("the and for of to in a an with all six three".split())
def phrases(t):
    w=[x for x in re.sub(r'[^a-z0-9 ]',' ',t.lower()).split() if x]
    out=set()
    for x in w:
        if len(x)>=4 and x not in STOP and not x.isdigit(): out.add(x)
    for i in range(len(w)-1):
        bi=w[i:i+2]
        if all(len(y)>=3 for y in bi) and any(y not in STOP and len(y)>=4 for y in bi): out.add(" ".join(bi))
    return list(out)
def cov(kw):
    body={"filters":{"keywords":[kw],"time_period":[{"start_date":"2024-10-01","end_date":"2025-09-30"}],
      "award_type_codes":["A","B","C","D"]},"category":"naics","limit":100,"page":1}
    r=urllib.request.Request("https://api.usaspending.gov/api/v2/search/spending_by_category",
      data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    for _ in range(3):
        try:
            d=json.load(urllib.request.urlopen(r,timeout=60))
            rows=[x for x in d.get("results",[]) if x.get("code") and (x.get("amount") or 0)>0]
            rows.sort(key=lambda x:-x["amount"]); return rows
        except Exception: time.sleep(2)
    return []
res=[]
for c in b["cases"]:
    if c["split"]!="dev": continue
    ph=phrases(c["description"])[:12]
    # CURRENT BEHAVIOUR: one keyword -> allNaics[0]. Approximate lead as the first candidate.
    lead=ph[0] if ph else ""
    rows=cov(lead)
    got=rows[0]["code"] if rows else None
    ok = got in c["expect_acceptable"]
    bad = got in c["expect_wrong"]
    res.append((c["id"],lead,got,ok,bad))
    print(f"{'PASS' if ok else ('WRONG' if bad else 'miss'):5} {c['id']:30} lead={lead[:22]:22} -> {got}")
p=sum(1 for x in res if x[3]); print(f"\nCURRENT RESOLVER on dev set: {p}/{len(res)} acceptable")
