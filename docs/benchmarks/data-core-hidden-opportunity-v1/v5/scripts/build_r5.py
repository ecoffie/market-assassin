# Round 5 label sheets (v4 product rubric, unchanged). One item per (business, notice); added and removed rows are shuffled
# together so reviewers cannot tell which a row is. (business, notice) pairs already labelled in v4 reuse those labels.
# Protocol note: the BUSINESS block shows both the short phrasing and the full description, because removed rows come from
# the long phrasings. Run: python3 -I scripts/build_r5.py
import json, os, re, random, glob
V5 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); V4 = os.path.join(os.path.dirname(V5), 'v4')
Q = json.load(open(f'{V4}/queries_v4.json')); PLAN = json.load(open(f'{V5}/r5_plan.json'))
ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V5}/r5_rows.jsonl') if l.strip()}
v4lab = {(m['biz'], m['notice_id']) for m in json.load(open(f'{V4}/labels/r4_meta.json'))}
STOP = set('we our the and of a an to for in on provide supply are is like do sell commercial industrial install maintain systems services service company'.split())
stems = lambda t: {w[:5] for w in re.findall(r'[a-z]+', (t or '').lower()) if w not in STOP and len(w) > 2}
clean = lambda t: re.sub(r'\s+', ' ', re.sub(r'&[a-z#0-9]+;', ' ', re.sub(r'<[^>]+>', ' ', t or ''))).strip()
NSN = re.compile(r'\b\d{4}-\d{2}-\d{3}-\d{4}\b|\bNSN[:\s#]*\d{13}\b', re.I)
def support(r, b):
    body = clean(' '.join(filter(None, [r.get('description'), r.get('sow_text')]))); sents = [s for s in re.split(r'(?<=[.!?;])\s+', body) if s]
    qs = stems(Q[b]['q'][0]); ps = stems(Q[b]['q'][1]); best = None
    for i, s in enumerate(sents):
        w = stems(s); sc = (len(w & qs), len(w & ps))
        if sc[0] + sc[1] > 0 and (best is None or sc > best[0]): best = (sc, i)
    if not best: return None, None, body
    i = best[1]; return sents[i][:500], ' '.join(sents[max(0, i - 1):i + 2])[:1100], body
pairs = sorted({(p['business'], n) for p in PLAN.values() for n in p['added_sample'] + p['removed_sample']})
items = [x for x in pairs if x not in v4lab]
random.seed(53); random.shuffle(items)
meta = []; sheet = []
for k, (b, n) in enumerate(items):
    r = ROWS[n]; iid = f'r5-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=Q[b]['cat']))
    sent, ctx, body = support(r, b)
    t = (f"### {iid}\nBUSINESS (the supplier's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\n"
         f"TITLE: {clean(r.get('title'))}\nAGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n"
         f"PRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n")
    nsn = sorted(set(NSN.findall(body)))[:6]
    if nsn: t += f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n"
    t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
          else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
    t += f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n"
    sheet.append(t)
SZ = 35; os.makedirs(f'{V5}/sheets', exist_ok=True)
for j in range(0, len(sheet), SZ): open(f'{V5}/sheets/sheet_{j // SZ:02d}.md', 'w').write('\n'.join(sheet[j:j + SZ]))
json.dump(meta, open(f'{V5}/labels/r5_meta.json', 'w'))
print('pairs', len(pairs), 'reused v4', len(pairs) - len(items), 'new items', len(items), 'sheets', (len(sheet) + SZ - 1) // SZ)
