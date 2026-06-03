#!/usr/bin/env python3
"""
Process raw MCP responses into .txt transcripts.
For each <id>.raw.json in calls/, parse {"fileContent": "..."} and write <id>.txt,
then delete the raw file. Also ensures the .json sidecar exists (from manifest).
"""
import json, os, glob

CALLS = "/Users/ericcoffie/Market Assasin/market-assassin/tasks/cache/calls"
INSCOPE = os.path.join(CALLS, "_inscope.jsonl")

# load manifest meta by id
meta = {}
with open(INSCOPE) as f:
    for l in f:
        if l.strip():
            r = json.loads(l)
            meta[r["id"]] = r

processed = []
empty = []
for raw_path in glob.glob(os.path.join(CALLS, "*.raw.json")):
    fid = os.path.basename(raw_path)[:-len(".raw.json")]
    with open(raw_path) as f:
        data = json.load(f)
    content = data.get("fileContent", "")
    txt_path = os.path.join(CALLS, fid + ".txt")
    with open(txt_path, "w") as f:
        f.write(content)
    # sidecar
    if fid in meta:
        m = meta[fid]
        side = {"fileId": fid, "title": m["title"], "source": "fireflies", "mimeType": m["mimeType"]}
        with open(os.path.join(CALLS, fid + ".json"), "w") as f:
            f.write(json.dumps(side))
    os.remove(raw_path)
    if content.strip():
        processed.append(fid)
    else:
        empty.append(fid)

print("processed:", len(processed))
if empty:
    print("EMPTY content (will be retried):", empty)
    # remove empty txt so they are retried
    for fid in empty:
        os.remove(os.path.join(CALLS, fid + ".txt"))
