#!/usr/bin/env python3
import json, os

import os, sys
# Call transcripts are private: $MINDY_PRIVATE_DIR/cache/calls, never the repository.
_PRIVATE = os.environ.get("MINDY_PRIVATE_DIR", "").strip()
if not _PRIVATE or not os.path.isabs(_PRIVATE):
    sys.exit("Refusing to run: set MINDY_PRIVATE_DIR to an absolute directory outside the repository.")
CALLS = os.path.join(_PRIVATE, "cache", "calls")
M = os.path.join(CALLS, "_manifest.jsonl")
P5 = os.path.join(CALLS, "_manifest_p5.jsonl")

lines = []
with open(M) as f:
    lines = [l for l in f if l.strip()]
if os.path.exists(P5):
    with open(P5) as f:
        lines += [l for l in f if l.strip()]
    os.remove(P5)

# dedupe by id, preserve order
seen = set()
recs = []
for l in lines:
    r = json.loads(l)
    if r["id"] in seen:
        continue
    seen.add(r["id"])
    recs.append(r)

with open(M, "w") as f:
    for r in recs:
        f.write(json.dumps(r) + "\n")

print("total records:", len(recs))
print("unique ids:", len(seen))
