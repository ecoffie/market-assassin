# Expert-labelled regression set v1: every prior human judgment by Eric (the project owner), re-keyed to the current rubric.
# Sources: labels.jsonl (human_* fields, committed 41b6e3be6, 2026-11-14) == the v1 review page's `reviews` collection (47/47 identical, re-checked 2026-11-15).
# DEVELOPMENT material: on the research branch since 2026-11-14 and readable by Agent 3. Never part of the sealed holdout.
# Run: python3 -I docs/benchmarks/data-core-hidden-opportunity-v1/expert-regression/build_expert_regression.py
import json, csv, os, sys, io, re, contextlib
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); V7 = f'{B}/v7'
MAP = {'FIT': 'DIRECT', 'PARTIAL': 'RELATED', 'NO': 'NOT_RELEVANT'}
H = [json.loads(l) for l in open(f'{B}/labels.jsonl') if l.strip()]; H = [x for x in H if x.get('human_label') not in (None, '', 'AI_UNVERIFIED')]
RS = {r['notice_id']: r for r in csv.DictReader(open(f'{B}/review/review_sheet.csv'))}
NT = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{B}/notices.jsonl') if l.strip()}
Q = json.load(open(f'{B}/v4/queries_v4.json'))
src = open(f'{V7}/scripts/r16.py').read().split("\ncmd = sys.argv[1]\n")[0]; g = {'__file__': f'{V7}/scripts/r16.py', '__name__': 'r16'}
with contextlib.redirect_stdout(io.StringIO()): exec(compile(src, 'r16.py', 'exec'), g)
L, S2, S3 = g['labels'](), g['S2'], g['S3']
FIN = {(x['business'], x['phrasing']): [t['notice_id'] for t in x['top20']] for x in json.load(open(f'{V7}/runner_rc3_candidate_final.json'))['results']}
top = {}
for p, v3 in S3.items():
    b = v3['business']
    for rc, ids in (('rc1', S2[p]['rc1_top20']), ('rc2', S2[p]['rc2_top20']), ('rc3', FIN[(b, v3['phrasing'])])): top.setdefault((rc, b), set()).update(ids)
CAL = {}
try:
    for i in json.load(open(os.path.expanduser('~/mindy-bench-sealed/calibration_answer_key.json')))['items']: CAL[i['notice_id']] = i['id']
except OSError: pass
REPAIR = re.compile(r'IN REPAIR/MODIFICATION OF|EAF REPAIR requirement|shall be repaired|Ready[- ]For[- ]Issue', re.I)
out = []
for x in sorted(H, key=lambda x: x['human_review_id']):
    n, b = x['notice_id'], x['business']; rs = RS[n]; nt = NT.get(n, {})
    disputed = None
    if b in ('parts',) and REPAIR.search(' '.join(str(v) for v in nt.values())) and x['human_label'] != 'NO':
        disputed = "conflicts with Eric's ruling 1 (2026-11-14, repair is not supply for a parts-only business); labelled before the ruling was applied"
    ai = L.get((b, n))
    out.append(dict(
        review_id=x['human_review_id'], notice_id=n, solicitation_number=rs['solicitation_number'], title=rs['title'], business=b,
        business_short=Q[b]['q'][0], business_full=Q[b]['q'][1], description_matches_current=rs['customer_description'].strip() == Q[b]['q'][1].strip(),
        eric_raw=x['human_label'], eric_label=MAP[x['human_label']], eric_decision=x.get('human_decision'), eric_notes=x.get('human_notes') or '',
        saved_at=x.get('human_saved_at'), sample=x['human_review_id'][0], status='DISPUTED' if disputed else 'REUSABLE', dispute=disputed,
        exposure='DEVELOPMENT: research branch since 41b6e3be6 (2026-11-14), readable by Agent 3',
        v7_ai_labels=ai['l'] if ai else None, v7_ai_disagrees=(ai['lo'] != (x['human_label'] != 'NO')) if ai else None,
        in_top20={rc: n in top.get((rc, b), set()) for rc in ('rc1', 'rc2', 'rc3')}, calibration_item=CAL.get(n)))
with open(f'{B}/expert-regression/expert_regression_v1.jsonl', 'w') as f:
    for r in out: f.write(json.dumps(r, sort_keys=True) + '\n')
import collections
print('items', len(out), collections.Counter(r['status'] for r in out), collections.Counter(r['eric_label'] for r in out))
print('by business', dict(collections.Counter(r['business'] for r in out)), 'sample', dict(collections.Counter(r['sample'] for r in out)))
print('in v7 AI pool', sum(r['v7_ai_labels'] is not None for r in out), 'AI disagrees', [(r['review_id'], r['business'], r['eric_label'], r['v7_ai_labels'], r['in_top20']) for r in out if r['v7_ai_disagrees']])
print('in RC3 top-20', sum(r['in_top20']['rc3'] for r in out), 'calibration items', sorted(r['calibration_item'] for r in out if r['calibration_item']))
print('disputed', [(r['review_id'], r['notice_id'][:8], r['eric_raw'], r['calibration_item']) for r in out if r['status'] == 'DISPUTED'])
