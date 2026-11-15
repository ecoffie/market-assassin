# Round 5 scoring of Agent 3 steps 1+3 (b449c043c vs 7f328de91). AI labels only: lo = both reviewers relevant, hi = either.
# Retrieval only: no ranking was changed or measured in this round. Run: python3 -I scripts/score_r5.py
import json, os, glob, math
V5 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); V4 = os.path.join(os.path.dirname(V5), 'v4')
Q = json.load(open(f'{V4}/queries_v4.json')); PLAN = json.load(open(f'{V5}/r5_plan.json'))
SETS = json.load(open(f'{V5}/a3_matched_sets_step1_3.json'))['queries']
rel = lambda x: x in ('FIT', 'PARTIAL')
def load(metaf, pattern):
    R = {1: {}, 2: {}}
    for k in (1, 2):
        for f in glob.glob(pattern.format(k=k)):
            for l in open(f):
                if l.strip():
                    try: j = json.loads(l); R[k][j['id']] = j
                    except Exception: pass
    L = {}; miss = []
    for m in json.load(open(metaf)):
        if m['id'] not in R[1] or m['id'] not in R[2]: miss.append(m['id']); continue
        a, b = R[1][m['id']], R[2][m['id']]
        L[(m['biz'], m['notice_id'])] = dict(lo=rel(a['label']) and rel(b['label']), hi=rel(a['label']) or rel(b['label']),
                                             l=[a['label'], b['label']], restriction=sorted({a.get('restriction', 'NONE'), b.get('restriction', 'NONE')}))
    return L, miss
L5, miss5 = load(f'{V5}/labels/r5_meta.json', V5 + '/labels/lab_*_r{k}.jsonl')
L4, _ = load(f'{V4}/labels/r4_meta.json', V4 + '/labels/lab_*_r{k}.jsonl')
L = {**L4, **L5}
def wil(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 2), round(c + h, 2)]
def prec(ids, b):
    ids = [i for i in ids if (b, i) in L]; lo = sum(L[(b, i)]['lo'] for i in ids); hi = sum(L[(b, i)]['hi'] for i in ids)
    return dict(n=len(ids), lo=lo, hi=hi, ci_lo=wil(lo, len(ids)), ci_hi=wil(hi, len(ids)))
out = {'labels': dict(new_items=len(L5), missing=len(miss5),
                      agree_exact=sum(v['l'][0] == v['l'][1] for v in L5.values()),
                      agree_relevant=sum(rel(v['l'][0]) == rel(v['l'][1]) for v in L5.values())), 'phrasings': {}, 'recall': {}}
for k, p in PLAN.items():
    b = p['business']; s = p['sizes']; a = prec(p['added_sample'], b); r = prec(p['removed_sample'], b)
    est = lambda m, tot: [round(tot * m['lo'] / m['n']), round(tot * m['hi'] / m['n'])] if m['n'] else None
    lost = [dict(id=i, labels=L[(b, i)]['l']) for i in p['removed_sample'] if (b, i) in L and L[(b, i)]['hi']]
    out['phrasings'][k] = dict(sizes=s, added_precision=a, est_relevant_added=est(a, s['added']), removed_relevant=r,
                               est_relevant_removed=est(r, s['removed']), removed_relevant_rows=lost)
# Recall checks on the SHORT phrasings (the v4 benchmark form), against v4 labels.
v4plan = json.load(open(f'{V4}/labels/r4_plan.json'))
for b in Q:
    q = Q[b]['q'][0]; v = SETS.get(q)
    if not v: continue
    base, new = set(v['baseline']), set(v['step1_3'])
    fl = [n for n, t in v4plan.get(b, {}).items() if 'floor_sample' in t and (b, n) in L4 and L4[(b, n)]['hi']]
    known = [n for (bb, n), x in L4.items() if bb == b and x['hi']]
    out['recall'][b] = dict(code_floor=dict(relevant=len(fl), baseline=sum(n in base for n in fl), step1_3=sum(n in new for n in fl)),
                            known_relevant=dict(n=len(known), baseline=sum(n in base for n in known), step1_3=sum(n in new for n in known)))
json.dump(out, open(f'{V5}/results/r5_eval.json', 'w'), indent=1)
print('labels', out['labels'])
for k, v in out['phrasings'].items():
    a, r = v['added_precision'], v['removed_relevant']
    print(f"{k:18s} +{v['sizes']['added']:5d} prec {a['lo']}-{a['hi']}/{a['n']} est_rel_added {v['est_relevant_added']}  | -{v['sizes']['removed']:4d} relevant {r['lo']}-{r['hi']}/{r['n']} est_rel_lost {v['est_relevant_removed']}")
for b, v in out['recall'].items():
    c = v['code_floor']; kn = v['known_relevant']
    print(f"{b:11s} floor recall {c['baseline']}->{c['step1_3']} of {c['relevant']}   known relevant {kn['baseline']}->{kn['step1_3']} of {kn['n']}")
