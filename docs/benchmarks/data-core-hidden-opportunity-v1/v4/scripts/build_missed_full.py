# Complete missed-relevant evidence for Agent 3 (no 12-per-business cap). AI labels, Nov 14 snapshot, read-only.
# Two populations per business:
#   not_retrieved      labelled relevant (either reviewer FIT/PARTIAL) and in NO variant's matched set (base ⊇ A ⊇ C)
#   matched_not_ranked labelled relevant, in the production matched set, but outside production's 500-row ranked window
# Run: python3 -I scripts/build_missed_full.py  -> results/missed_relevant_full.json + results/missed_relevant_full.csv
import json, os, glob, csv
V4 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = json.load(open(f'{V4}/results/r4_sets.json'))['queries']; Q = json.load(open(f'{V4}/queries_v4.json'))
PLAN = json.load(open(f'{V4}/labels/r4_plan.json')); META = json.load(open(f'{V4}/labels/r4_meta.json'))
ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V4}/results/r4_rows_min.jsonl') if l.strip()}
rel = lambda x: x in ('FIT', 'PARTIAL')
R = {1: {}, 2: {}}
for k in (1, 2):
    for f in glob.glob(f'{V4}/labels/lab_*_r{k}.jsonl'):
        for l in open(f):
            if l.strip(): j = json.loads(l); R[k][j['id']] = j
L = {}
for m in META:
    a, b = R[1][m['id']], R[2][m['id']]
    L[(m['biz'], m['notice_id'])] = dict(l=[a['label'], b['label']], lo=rel(a['label']) and rel(b['label']), hi=rel(a['label']) or rel(b['label']),
                                         restriction=sorted({a.get('restriction') or 'NONE', b.get('restriction') or 'NONE'}),
                                         role=[a.get('role'), b.get('role')], evidence=a.get('evidence') if rel(a['label']) else b.get('evidence'))
def infloor(b, r):
    f = Q[b]['floor']; n = str(r.get('naics_code') or ''); p = str(r.get('psc_code') or '')
    return n in f.get('naics', []) or any((p.startswith(x) if len(x) < 4 else p == x) for x in f.get('psc', []))
out = {'snapshot': '2026-11-14', 'labels': 'AI only (two blind reviewers); lo = both relevant, hi = either', 'businesses': {}}
flat = []
for b, c in CAP.items():
    if 'sets' not in c: continue
    base = set(c['sets']['base']); win = set(c['window']['base'])
    def rec(n, kind):
        r = ROWS.get(n, {}); v = L[(b, n)]
        d = dict(business=b, cat=Q[b]['cat'], population=kind, notice_id=n, title=r.get('title'), solicitation_number=r.get('solicitation_number'),
                 naics=r.get('naics_code'), psc=r.get('psc_code'), notice_type=r.get('notice_type'), agency=r.get('sub_tier') or r.get('department'),
                 deadline=r.get('response_deadline'), in_code_floor=infloor(b, r), both_relevant=v['lo'], labels='/'.join(v['l']),
                 restriction='/'.join(x for x in v['restriction'] if x != 'NONE') or '', why_labelled='+'.join(PLAN[b].get(n, [])),
                 evidence=v['evidence'], sam_url=f'https://sam.gov/opp/{n}/view')
        flat.append(d); return d
    nr = [rec(n, 'not_retrieved') for (bb, n), v in L.items() if bb == b and v['hi'] and n not in base]
    mn = [rec(n, 'matched_not_ranked') for (bb, n), v in L.items() if bb == b and v['hi'] and n in base and n not in win]
    out['businesses'][b] = dict(query=Q[b]['q'][0], cat=Q[b]['cat'], matched=len(base), not_retrieved=len(nr),
                                not_retrieved_both_relevant=sum(x['both_relevant'] for x in nr), matched_not_ranked=len(mn),
                                not_retrieved_in_code_floor=sum(x['in_code_floor'] for x in nr), notices=nr + mn)
json.dump(out, open(f'{V4}/results/missed_relevant_full.json', 'w'), indent=1)
with open(f'{V4}/results/missed_relevant_full.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(flat[0])); w.writeheader(); w.writerows(flat)
for b, v in out['businesses'].items():
    print(f"{b:11s} matched {v['matched']:5d}  not_retrieved {v['not_retrieved']:3d} (both {v['not_retrieved_both_relevant']:3d}, in floor {v['not_retrieved_in_code_floor']:3d})  matched_not_ranked {v['matched_not_ranked']}")
print('total rows', len(flat))
