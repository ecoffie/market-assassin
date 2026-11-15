# Builds the 20-item reviewer calibration set (HOLDOUT-REVIEWER-PLAN.md §3.4). Never scored, never reused in the holdout.
#   12 service items: v1 items with a HUMAN label (reference = the v1 human review, 2026-11-14), stratified 5 FIT / 3 PARTIAL / 4 NO.
#   8 product items: v5/v6 items where BOTH AI reviewers agree, chosen to test DLA/NSN reading. Reference = provisional
#     (AI agreement + Eric's rulings 2026-11-14: repair/return-to-RFI is NO for a parts-only seller; generic medical excludes 6505).
# Writes calibration/CALIBRATION-PACKET.md (reviewer-facing, no answers) and ~/mindy-bench-sealed/calibration_answer_key.json (SEALED, outside Git: the research branch is readable by Agent 3).
# Usage: python3 -I scripts/build_calibration.py
import json, os, re, glob, hashlib
V4 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT = os.path.dirname(V4)
OUT = os.path.join(V4, 'calibration'); os.makedirs(OUT, exist_ok=True)
Q4 = json.load(open(f'{V4}/queries_v4.json')); Q1 = json.load(open(f'{ROOT}/queries.json'))
h = lambda s: hashlib.sha256(('cal|' + s).encode()).hexdigest()
clean = lambda t: re.sub(r'\s+', ' ', re.sub(r'&[a-z#0-9]+;', ' ', re.sub(r'<[^>]+>', ' ', t or ''))).strip()
# --- services from the v1 human review
N1 = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{ROOT}/notices.jsonl') if l.strip()}
hum = [x for x in (json.loads(l) for l in open(f'{ROOT}/labels.jsonl') if l.strip()) if x.get('human_label') and x['notice_id'] in N1]
svc = []
for lab, n in (('FIT', 5), ('PARTIAL', 3), ('NO', 4)):
    svc += sorted([x for x in hum if x['human_label'] == lab], key=lambda x: h(x['item_id']))[:n]
# --- products: both AI reviewers agree
rows = {}
for f in (f'{ROOT}/v6/r6_rows_rc1_text.jsonl', f'{ROOT}/v5/r5_rows.jsonl'):
    if os.path.exists(f):
        for l in open(f):
            if l.strip(): r = json.loads(l); rows.setdefault(r['notice_id'], r)
agreed = []
for ver, pre in (('v5', 'r5'), ('v6', 'r6')):
    meta = {m['id']: m for m in json.load(open(f'{ROOT}/{ver}/labels/{pre}_meta.json'))}
    R = {1: {}, 2: {}}
    for k in (1, 2):
        for f in glob.glob(f'{ROOT}/{ver}/labels/lab_*_r{k}.jsonl'):
            for l in open(f):
                if l.strip(): j = json.loads(l); R[k][j['id']] = j
    for i, m in meta.items():
        if m['cat'] != 'product' or i not in R[1] or i not in R[2] or m['notice_id'] not in rows: continue
        a, b = R[1][i], R[2][i]
        if a['label'] == b['label']: agreed.append(dict(m, label=a['label'], restriction=a.get('restriction'), evidence=a.get('evidence')))
REPAIR = re.compile(r'REPAIR requirement|shall be repaired|IN REPAIR/MODIFICATION|Ready For Issue', re.I)
def body(n): r = rows[n]; return clean(' '.join(filter(None, [r.get('description'), r.get('sow_text')])))
def pick(pred, n, salt): return sorted([x for x in agreed if pred(x)], key=lambda x: h(salt + x['notice_id']))[:n]
used = set(); prod = []
def take(pred, n, salt):
    for x in pick(lambda x: pred(x) and x['notice_id'] not in used, n, salt): used.add(x['notice_id']); prod.append(x)
take(lambda x: x['label'] == 'FIT' and re.search(r'\d{4}-\d{2}-\d{3}-\d{4}', body(x['notice_id'])) and x['restriction'] in (None, 'NONE') and not REPAIR.search(body(x['notice_id'])), 3, 'nsn')
take(lambda x: x['label'] == 'NO' and REPAIR.search((rows[x['notice_id']].get('title') or '') + ' ' + body(x['notice_id'])), 2, 'rep')
take(lambda x: x['label'] == 'FIT' and x['restriction'] == 'APPROVED_SOURCE' and not REPAIR.search(body(x['notice_id'])), 1, 'aps')
take(lambda x: x['label'] == 'PARTIAL', 1, 'par')
take(lambda x: x['label'] == 'NO' and not REPAIR.search(body(x['notice_id'])), 1, 'no')
items = []
for x in svc:
    r = N1[x['notice_id']]
    items.append(dict(kind='service', business=Q1[x['business']][0], full=Q1[x['business']][1], notice_id=x['notice_id'], title=r.get('title'),
                      agency=f"{r.get('department')} / {r.get('sub_tier')}", psc=r.get('psc_code'), text=clean(' '.join(filter(None, [r.get('description'), r.get('sow_text')])))[:1800],
                      ref=x['human_label'], ref_source='v1 human review', ref_note=x.get('human_notes')))
for x in prod:
    r = rows[x['notice_id']]
    items.append(dict(kind='product', business=Q4[x['biz']]['q'][0], full=Q4[x['biz']]['q'][1], notice_id=x['notice_id'], title=r.get('title'),
                      agency=f"{r.get('department')} / {r.get('sub_tier')}", psc=r.get('psc_code'), text=body(x['notice_id'])[:1800],
                      ref=x['label'], ref_source='PROVISIONAL: both AI reviewers + Eric rulings 2026-11-14', ref_restriction=x['restriction'], ref_note=x['evidence']))
items.sort(key=lambda x: h(x['notice_id']))
md = ['# Reviewer calibration (20 practice items, not scored)', '',
      'Read INSTRUCTIONS (service or product) and the two scope rulings at the top of RUBRIC-ADDENDUM-2026-11-14.md first.',
      'For each item record: label (FIT / PARTIAL / NO), role (PRIME / SUB / NONE), for products the restriction, and a 6–15 word evidence quote.', '']
key = []
SEALED = os.path.expanduser('~/mindy-bench-sealed/calibration_answer_key.json'); os.makedirs(os.path.dirname(SEALED), mode=0o700, exist_ok=True)
for k, it in enumerate(items, 1):
    cid = f'C{k:02d}'
    md += [f'## {cid} ({it["kind"]})', f'**Business:** {it["business"]}  ', f'**Full description:** {it["full"]}  ', f'**Title:** {clean(it["title"])}  ',
           f'**Agency:** {it["agency"]}  ', f'**PSC/FSC:** {it["psc"] or "none"}  ', f'**SAM.gov:** https://sam.gov/opp/{it["notice_id"]}/view', '', f'> {it["text"]}', '']
    key.append(dict(id=cid, notice_id=it['notice_id'], kind=it['kind'], ref=it['ref'], ref_relevant=it['ref'] in ('FIT', 'PARTIAL'),
                    ref_source=it['ref_source'], ref_restriction=it.get('ref_restriction'), ref_note=it.get('ref_note')))
open(f'{OUT}/CALIBRATION-PACKET.md', 'w').write('\n'.join(md))
json.dump(dict(rule='fail calibration if more than 4 of 20 relevant-vs-not calls differ from ref; product refs are provisional until Eric confirms', items=key),
          open(SEALED, 'w'), indent=1)
print('services', len(svc), 'products', len(prod), 'items', len(items))
from collections import Counter; print(Counter((k['kind'], k['ref']) for k in key))
