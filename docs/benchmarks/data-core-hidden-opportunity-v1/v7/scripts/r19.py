# Round 19: two-reviewer AI labels for every unlabelled top-20 row of a dev runner output (agent3/dla-nsn-parts @ e9c6f74ff). Handles product businesses (PSC + NSN lines, as r16).
# Development fixture only. Sheets built exactly like r16/r17.
# Usage: python3 -I scripts/r19.py build <corpus.json.gz> <runner.json>
import json, os, sys, gzip, io, contextlib, random
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{V7}/scripts/r16.py').read().split("\ncmd = sys.argv[1]\n")[0]; g = {'__file__': f'{V7}/scripts/r16.py', '__name__': 'r16'}
argv = sys.argv; sys.argv = ['r16']
with contextlib.redirect_stdout(io.StringIO()): exec(compile(src, 'r16.py', 'exec'), g)
sys.argv = argv; r6, Q, L = g['r6'], g['Q'], g['labels']()
TODO = sorted({(x['business'], t['notice_id']) for x in json.load(open(sys.argv[3]))['results'] for t in x['top20']}) if len(sys.argv) > 3 else []
if sys.argv[1] == 'build':
    d = json.load(gzip.open(sys.argv[2])); rows = d['rows'] if isinstance(d, dict) else d; ROWS = {r['notice_id']: r for r in rows}
    todo = [t for t in TODO if t not in L]; print('already labelled:', [t for t in TODO if t in L])
    random.seed(191); random.shuffle(todo); meta = []; out = []; cats = []
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r19-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        if cat == 'product':
            t += f"PRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n"
            nsn = sorted(set(r6['NSN'].findall(body)))[:6]
            if nsn: t += f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n"
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        out.append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n"); cats.append(cat)
    os.makedirs(f'{V7}/sheets19', exist_ok=True)
    for c in ('service', 'product'):
        lst = [o for o, cc in zip(out, cats) if cc == c]
        for j in range(0, len(lst), 20): open(f'{V7}/sheets19/sheet_{c}_{j // 20:02d}.md', 'w').write('\n'.join(lst[j:j + 20]))
    json.dump(meta, open(f'{V7}/labels/r19_meta.json', 'w')); print('items', len(meta))
