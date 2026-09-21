#!/usr/bin/env python3
import json, os, re

CALLS = "/Users/ericcoffie/Market Assasin/market-assassin/tasks/cache/calls"
M = os.path.join(CALLS, "_manifest.jsonl")

# Exclusion substrings (case-insensitive)
EXCLUDE = [
    "team meeting", "weekly meeting", "gcg weekly", "marketing", "standup",
    "stand-up", "strategy meeting", "interview with candidate", "appt setter",
    "onboarding", "internal",
]

def title_clean(t):
    # strip the trailing fireflies "-transcript-2025-...Z.pdf" suffix for matching
    return t.lower()

def is_excluded(title):
    tl = title.lower()
    for kw in EXCLUDE:
        if kw in tl:
            return kw
    # "sales meeting": exclude internal sync, but keep "sales meeting with <prospect>"
    if "sales meeting" in tl:
        # keep only if "sales meeting with " appears (prospect call)
        if "sales meeting with" in tl:
            return None
        return "sales meeting"
    return None

recs = []
with open(M) as f:
    for l in f:
        if l.strip():
            recs.append(json.loads(l))

in_scope = []
excluded = []
for r in recs:
    reason = is_excluded(r["title"])
    if reason:
        excluded.append((r, reason))
    else:
        in_scope.append(r)

# idempotent: which in-scope already have non-empty txt
done = []
todo = []
for r in in_scope:
    txt = os.path.join(CALLS, r["id"] + ".txt")
    if os.path.exists(txt) and os.path.getsize(txt) > 0:
        done.append(r)
    else:
        todo.append(r)

print("TOTAL files in manifest:", len(recs))
print("IN-SCOPE:", len(in_scope))
print("EXCLUDED:", len(excluded))
print("ALREADY DONE (txt exists, non-empty):", len(done))
print("TODO (need download):", len(todo))
print()
print("=== EXCLUDED TITLES ===")
for r, reason in excluded:
    print(f"  [{reason}] {r['title']}")

# write todo list for the downloader
with open(os.path.join(CALLS, "_todo.jsonl"), "w") as f:
    for r in todo:
        f.write(json.dumps(r) + "\n")
with open(os.path.join(CALLS, "_inscope.jsonl"), "w") as f:
    for r in in_scope:
        f.write(json.dumps(r) + "\n")
print()
print("wrote _todo.jsonl and _inscope.jsonl")
