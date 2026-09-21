#!/usr/bin/env python3
"""Generate .json sidecars for every in-scope file that has a non-empty .txt."""
import json, os

CALLS = "/Users/ericcoffie/Market Assasin/market-assassin/tasks/cache/calls"
INSCOPE = os.path.join(CALLS, "_inscope.jsonl")

meta = {}
with open(INSCOPE) as f:
    for l in f:
        if l.strip():
            r = json.loads(l)
            meta[r["id"]] = r

made = 0
for fid, m in meta.items():
    txt = os.path.join(CALLS, fid + ".txt")
    if os.path.exists(txt) and os.path.getsize(txt) > 0:
        side = {"fileId": fid, "title": m["title"], "source": "fireflies", "mimeType": m["mimeType"]}
        with open(os.path.join(CALLS, fid + ".json"), "w") as f:
            f.write(json.dumps(side))
        made += 1
print("sidecars written:", made)
