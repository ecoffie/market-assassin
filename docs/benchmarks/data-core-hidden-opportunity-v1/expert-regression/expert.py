"""Eric's expert labels: the permanent store and the rules every benchmark script must follow.

STORE  expert_labels.jsonl  (append-only; one row per (business, notice_id); Eric's own judgments, with his later rulings applied)
RULES  1. Precedence: Eric's label > Eric's rulings/adjudications > AI reviewers.   -> apply_expert(L)
       2. Never re-ask: a (business, notice_id) Eric has judged is never put on a new review sheet.   -> already_judged / filter_new
       3. New reviews are appended with add_labels(); a conflict with an earlier label of his is raised as a decision, never overwritten.
These labels are DEVELOPMENT material (exposed to Agent 3). The sealed holdout lives in ~/mindy-bench-sealed/ and is never mixed in.
"""
import json, os, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'expert_labels.jsonl')
RAW = {'DIRECT': 'FIT', 'RELATED': 'PARTIAL', 'NOT_RELEVANT': 'NO'}

def load():
    rows = [json.loads(l) for l in open(STORE) if l.strip()]
    out = {}
    for r in rows:  # last row for a pair wins only if it is a recorded resolution; add_labels() guarantees that
        out[(r['business'], r['notice_id'])] = r
    return out

def apply_expert(L):
    """Override AI/adjudicated labels with Eric's. L maps (business, notice_id) -> {lo, hi, l, ...} (r6.load_labels format)."""
    E = load(); n_over = n_new = 0
    for k, r in E.items():
        if r.get('status') != 'REUSABLE': continue
        raw = RAW[r['eric_label']]; rel = r['eric_label'] != 'NOT_RELEVANT'
        if k in L: n_over += 1
        else: n_new += 1
        L[k] = dict(L.get(k, {}), lo=rel, hi=rel, l=[raw, raw], src='eric', eric_label=r['eric_label'])
    return L, n_over, n_new

def already_judged(business, notice_id):
    return (business, notice_id) in load()

def filter_new(pairs):
    """Drop every (business, notice_id) Eric has already judged. Use before building ANY human review sheet."""
    E = load(); keep = [p for p in pairs if tuple(p) not in E]
    return keep, len(pairs) - len(keep)

def add_labels(new_rows, source):
    """Append Eric's new judgments. Returns conflicts (same pair, different label) for Eric to decide; those are NOT written."""
    E = load(); conflicts = []; written = 0
    with open(STORE, 'a') as f:
        for r in new_rows:
            k = (r['business'], r['notice_id'])
            if k in E and E[k]['eric_label'] != r['eric_label']:
                conflicts.append(dict(pair=k, earlier=E[k]['eric_label'], new=r['eric_label'])); continue
            if k in E: continue
            f.write(json.dumps(dict(r, status='REUSABLE', source=source, added_at=datetime.datetime.utcnow().isoformat() + 'Z'), sort_keys=True) + '\n'); written += 1
    return written, conflicts
