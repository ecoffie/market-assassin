# Round 17: two-reviewer AI labels for the 6 Nov 14 fixture notices Agent 3's dev candidate F1 (agent3/guards-steel-diagnosis @ 3cc4d2224,
# NAICS code-recall sub-window; NOT a tag) brings into a top 20 unlabelled. Development fixture only. Sheets built exactly like r16.
# Usage: python3 -I scripts/r17.py build <corpus.json.gz>
import json, os, sys, gzip, io, contextlib, random
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{V7}/scripts/r16.py').read().split("\ncmd = sys.argv[1]\n")[0]; g = {'__file__': f'{V7}/scripts/r16.py', '__name__': 'r16'}
argv = sys.argv; sys.argv = ['r16']
with contextlib.redirect_stdout(io.StringIO()): exec(compile(src, 'r16.py', 'exec'), g)
sys.argv = argv; r6, Q, L = g['r6'], g['Q'], g['labels']()
TODO = [('hvac', 'b89e7d9df42245668a708071ff95a9d4'), ('hvac', '16567730ff5e4a9c84b882059d6160b8'), ('hvac', '18ec73f48d0b4246a2224ef8d3d09c99'),
        ('janitorial', '270e2f6d8f2840b9b1b7da8c4f590381'), ('janitorial', 'cf8af78cf3ac49e29fa93a3864a69a80'), ('janitorial', 'c355d58bb7ab4a2192559a967c98f38c')]
if sys.argv[1] == 'build':
    d = json.load(gzip.open(sys.argv[2])); rows = d['rows'] if isinstance(d, dict) else d; ROWS = {r['notice_id']: r for r in rows}
    todo = [t for t in TODO if t not in L]; print('already labelled:', [t for t in TODO if t in L])
    random.seed(171); random.shuffle(todo); meta = []; out = []
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r17-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        out.append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n")
    os.makedirs(f'{V7}/sheets17', exist_ok=True); open(f'{V7}/sheets17/sheet_service_00.md', 'w').write('\n'.join(out))
    json.dump(meta, open(f'{V7}/labels/r17_meta.json', 'w')); print('items', len(meta))
