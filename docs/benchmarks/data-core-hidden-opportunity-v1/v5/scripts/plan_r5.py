# Round 5: blind scoring of Agent 3's retrieval steps 1+3 (b449c043c) against production (7f328de91).
# Samples ADDED rows (precision of what the change brings in) and REMOVED rows (relevant work lost), per phrasing.
# Deterministic hash sampling. Writes v5/r5_plan.json and v5/r5_fetch_ids.txt. Run: python3 -I scripts/plan_r5.py
import json, os, hashlib
V5 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); V4 = os.path.join(os.path.dirname(V5), 'v4')
S = json.load(open(f'{V5}/a3_matched_sets_step1_3.json'))
Q = json.load(open(f'{V4}/queries_v4.json'))
pick = lambda ids, n, salt: sorted(ids, key=lambda i: hashlib.sha256(f'r5|{salt}|{i}'.encode()).hexdigest())[:n]
N_ADD_SHORT, N_ADD_LONG, N_RM = 30, 20, 25
plan = {}  # key "biz|short|long" -> {added_sample, removed_sample, sizes}
for phr, v in S['queries'].items():
    b = v['business']; form = 'short' if phr == Q[b]['q'][0] else 'long'
    base, new = set(v['baseline']), set(v['step1_3']); add, rm = sorted(new - base), sorted(base - new)
    if not add and not rm: continue
    k = f'{b}|{form}'
    plan[k] = dict(business=b, form=form, phrasing=phr, sizes=dict(baseline=len(base), step1_3=len(new), added=len(add), removed=len(rm)),
                   added_sample=pick(add, N_ADD_SHORT if form == 'short' else N_ADD_LONG, k + 'add'),
                   removed_sample=pick(rm, N_RM, k + 'rm'))
json.dump(plan, open(f'{V5}/r5_plan.json', 'w'), indent=1)
ids = sorted({i for p in plan.values() for i in p['added_sample'] + p['removed_sample']})
open(f'{V5}/r5_fetch_ids.txt', 'w').write('\n'.join(ids) + '\n')
for k, p in plan.items(): print(k.ljust(18), p['sizes'], 'sample add', len(p['added_sample']), 'rm', len(p['removed_sample']))
print('unique ids to fetch', len(ids))
