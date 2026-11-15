# Guard + regression check for Eric's expert labels.
#   python3 -I check_expert.py precedence            -> exit 1 if the current scorer (v7 r16.labels) scores ANY Eric-judged pair from a non-Eric label
#   python3 -I check_expert.py candidate <runner.json> [<runner.json> ...]  -> how each search version does on Eric's labels (top-20 and matched set)
import json, os, sys, io, contextlib, collections
HERE = os.path.dirname(os.path.abspath(__file__)); B = os.path.dirname(HERE); V7 = f'{B}/v7'
sys.path.insert(0, HERE); import expert
def scorer_labels():
    src = open(f'{V7}/scripts/r16.py').read().split("\ncmd = sys.argv[1]\n")[0]; g = {'__file__': f'{V7}/scripts/r16.py', '__name__': 'r16'}
    argv = sys.argv; sys.argv = ['r16']
    with contextlib.redirect_stdout(io.StringIO()): exec(compile(src, 'r16.py', 'exec'), g)
    sys.argv = argv; return g['labels']()
cmd = sys.argv[1]
E = {k: r for k, r in expert.load().items() if r.get('status') == 'REUSABLE'}
if cmd == 'precedence':
    L = scorer_labels(); bad = [k for k, r in E.items() if L.get(k, {}).get('src') != 'eric' or L[k]['l'][0] != expert.RAW[r['eric_label']]]
    print(f'Eric-judged pairs: {len(E)}; scored from Eric\'s label: {len(E) - len(bad)}; violations: {len(bad)}')
    for k in bad: print('  VIOLATION', k)
    sys.exit(1 if bad else 0)
elif cmd == 'candidate':
    for f in sys.argv[2:]:
        R = json.load(open(f)); res = collections.Counter(); miss = []
        for x in R['results']:
            b = x['business']; top = {t['notice_id'] for t in x['top20']}; m = set(x['matched'])
            for (eb, n), r in E.items():
                if eb != b: continue
                lab = r['eric_label']; res[(lab, 'top20' if n in top else 'matched' if n in m else 'missed')] += 1
                if lab == 'DIRECT' and n not in m: miss.append((b, n[:8], x['phrasing']))
        print(f"{os.path.basename(f)} @ {R.get('src', {}).get('commit', '?')[:9]} (counts are per phrasing, short+long):")
        for lab in ('DIRECT', 'RELATED', 'NOT_RELEVANT'):
            print(f"  {lab:13s} in top-20 {res[(lab,'top20')]:3d} | matched, below top-20 {res[(lab,'matched')]:3d} | not retrieved {res[(lab,'missed')]:3d}")
        print(f"  Eric-DIRECT notices not retrieved: {miss}")
