# Round 18: two-reviewer AI labels for every unlabelled top-20 row of a dev runner output (first use: agent3/steel-wording-rank @ 62a12d0c1).
# Development fixture only. Sheets built exactly like r16/r17.
# Usage: python3 -I scripts/r18.py build <corpus.json.gz> <runner.json>
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
    random.seed(181); random.shuffle(todo); meta = []; out = []
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r18-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        out.append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n")
    os.makedirs(f'{V7}/sheets18', exist_ok=True); open(f'{V7}/sheets18/sheet_service_00.md', 'w').write('\n'.join(out))
    json.dump(meta, open(f'{V7}/labels/r18_meta.json', 'w')); print('items', len(meta))
