import json,urllib.request,re,time,sys,os
FX="src/mcp/decision-chain/fixtures/"
b=json.load(open(FX+"classification-set.json"))
base_rows=[x for x in json.load(open(FX+"naics-BASELINE.json")).get("results",[]) if x.get("code") and (x.get("amount") or 0)>0]
bt=sum(x["amount"] for x in base_rows) or 1
BASE={x["code"]:x["amount"]/bt for x in base_rows}
FLOOR=0.0002
STOP=set("the and for of to in a an with all six three this that contract fixed price purpose".split())
GENERIC=set("small large new other general support services service system systems provide provided all misc".split())
CACHE={}
def phrases(t):
    w=[x for x in re.sub(r'[^a-z0-9 ]',' ',t.lower()).split() if x]
    out=[]
    for i in range(len(w)-1):
        bi=w[i:i+2]
        if all(len(y)>=3 for y in bi) and any(y not in STOP and len(y)>=4 for y in bi): out.append(" ".join(bi))
    for x in w:
        if len(x)>=4 and x not in STOP and x not in GENERIC and not x.isdigit(): out.append(x)
    seen=set(); r=[]
    for x in out:
        if x in seen: continue
        seen.add(x); r.append(x)
    return r
def cov(kw):
    if kw in CACHE: return CACHE[kw]
    body={"filters":{"keywords":[kw],"time_period":[{"start_date":"2024-10-01","end_date":"2025-09-30"}],
      "award_type_codes":["A","B","C","D"]},"category":"naics","limit":100,"page":1}
    r=urllib.request.Request("https://api.usaspending.gov/api/v2/search/spending_by_category",
      data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    rows=[]
    for _ in range(3):
        try:
            d=json.load(urllib.request.urlopen(r,timeout=60))
            rows=[x for x in d.get("results",[]) if x.get("code") and (x.get("amount") or 0)>0]
            rows.sort(key=lambda x:-x["amount"]); break
        except Exception: time.sleep(2)
    CACHE[kw]=rows; return rows
MIN_LIFT=25
def resolve(desc,topn=10):
    agg={}; ev={}
    for kw in phrases(desc)[:topn]:
        rows=cov(kw)
        if not rows: continue
        tot=sum(x["amount"] for x in rows) or 1
        for x in rows:
            sh=x["amount"]/tot
            if sh<0.02: continue
            lift=sh/max(BASE.get(x["code"],0),FLOOR)
            if lift<2: continue
            agg[x["code"]]=agg.get(x["code"],0)+lift
            ev.setdefault(x["code"],set()).add(kw)
    if not agg: return None,[],0
    ranked=sorted(agg.items(),key=lambda k:-k[1])
    top=ranked[0]
    # abstention: require corroboration from >1 phrase AND a real lift
    confident = len(ev[top[0]])>1 and top[1]>=MIN_LIFT
    return (top[0] if confident else None), [c for c,_ in ranked[:3]], top[1]
rows=[]
for c in b["cases"]:
    if c["split"]!="dev": continue
    got,top3,score=resolve(c["description"])
    ok = got in c["expect_acceptable"]
    top3ok = any(x in c["expect_acceptable"] for x in top3)
    baddom = top3 and top3[0] in c["expect_wrong"]
    rows.append((c["id"],got,ok,top3ok,baddom))
    tag = "PASS" if ok else ("ABSTAIN" if got is None else ("WRONG" if got in c["expect_wrong"] else "miss"))
    print(f"{tag:8} {c['id']:30} -> {got}  top3={top3} {'<-BAD' if baddom else ''}")
print(f"\nLIFT resolver on dev: first-choice {sum(1 for x in rows if x[2])}/{len(rows)}  |  acceptable-in-top3 {sum(1 for x in rows if x[3])}/{len(rows)}  |  wrong-dominates {sum(1 for x in rows if x[4])}")
