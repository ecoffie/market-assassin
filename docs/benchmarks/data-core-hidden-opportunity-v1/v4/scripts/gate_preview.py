# Release-gate PREVIEW on the v4 in-sample AI labels. Not the gate: the gate needs the human-labelled post-freeze holdout.
# Reads results/r4_eval.json, writes results/gate_preview.json and missed_relevant.json. Run: python3 -I scripts/gate_preview.py
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); V4 = os.path.dirname(HERE)
E = json.load(open(os.path.join(V4, 'results', 'r4_eval.json')))
TOP_POOLED, TOP_FLOOR, RECALL = 0.60, 0.40, 0.50
out = {'note': 'AI labels, in-sample, Nov 14 snapshot. Preview only; does not satisfy the release gate.', 'variants': {}}
for var in ('base', 'A', 'C'):
    rows = []; slo = shi = sn = 0; rf = rr = 0
    for biz, v in E.items():
        if biz == 'labels': continue
        t = v['top20'][var]; slo += t['lo']; shi += t['hi']; sn += t['n']
        f = v['recall_code_floor']; rel = f['sample_relevant_hi']; fnd = f['found'][var]
        if rel: rf += fnd; rr += rel
        rows.append({'business': biz, 'cat': v['cat'], 'top_n': t['n'], 'top_lo': t['lo'], 'top_hi': t['hi'],
                     'top_pass_floor': t['lo'] / t['n'] >= TOP_FLOOR if t['n'] else None,
                     'recall_found': fnd, 'recall_relevant': rel,
                     'recall': round(fnd / rel, 2) if rel else None,
                     'recall_pass': (fnd / rel >= RECALL) if rel else None})
    out['variants'][var] = {
        'pooled_top20': [round(slo / sn, 3), round(shi / sn, 3)], 'pooled_top20_pass': slo / sn >= TOP_POOLED,
        'businesses_below_40_lower_bound': [r['business'] for r in rows if r['top_pass_floor'] is False],
        'pooled_code_recall': round(rf / rr, 3) if rr else None, 'pooled_code_recall_pass': (rf / rr >= RECALL) if rr else None,
        'businesses_below_50_recall': [r['business'] for r in rows if r['recall_pass'] is False],
        'rows': rows}
json.dump(out, open(os.path.join(V4, 'results', 'gate_preview.json'), 'w'), indent=1)
missed = {'note': 'Relevant (upper bound) code-floor notices no variant retrieved. r4_eval stores at most 12 per business; counts in gate_preview.json are complete.'}
for biz, v in E.items():
    if biz == 'labels': continue
    m = list(v['recall_code_floor']['relevant_floor_not_retrieved'])
    if biz == 'guards':
        ps = v.get('protective_services') or {}
        for x in ps.get('relevant_not_in_C', []) or []:
            if not x.get('in_base') and not x.get('in_A') and all(x.get('id') != y.get('id') for y in m):
                m.append({'id': x['id'], 'title': x['title'], 'via': 'protective-services probe'})
    missed[biz] = m
json.dump(missed, open(os.path.join(V4, 'results', 'missed_relevant.json'), 'w'), indent=1)
for var, o in out['variants'].items():
    print(var, 'top20', o['pooled_top20'], 'below40', len(o['businesses_below_40_lower_bound']), o['businesses_below_40_lower_bound'],
          'recall', o['pooled_code_recall'], 'below50', o['businesses_below_50_recall'])
print('missed', {k: len(v) for k, v in missed.items() if k != 'note'})
