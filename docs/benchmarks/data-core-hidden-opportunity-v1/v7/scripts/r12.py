# Round 12: AI-label the unlabelled code/NAICS/title-keyword pool for nursing and guards on the Nov 14 fixture snapshot, to firm up
# "how many distinct relevant open solicitations exist" (scarce-market question). Benchmark rows only; diagnostic; lower bounds become near-census.
# Usage: python3 -I scripts/r12.py build <fixture corpus.json.gz> | score <fixture corpus.json.gz>
import json, os, sys, re, gzip, random
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cmd, snap = sys.argv[1], sys.argv[2]; sys.argv = ['r11', 'none']
src = open(f'{V7}/scripts/r11.py').read().split("\ncmd = sys.argv[1]\n")[0]
g = {'__file__': f'{V7}/scripts/r11.py', '__name__': 'r11'}; exec(compile(src, 'r11.py', 'exec'), g)
r6, Q = g['r6'], g['Q']
B = {r['notice_id']: r for r in json.load(gzip.open(snap))['rows']}
POOL = {'nursing': (r'^(Q401|Q701|Q531|Q201|Q999|Q5|Q6|Q7|G0|R4)', r'^(6213|6216|5613|6211|6219|6221|6231|6232)', r'\bnurs(e|es|ing)\b|\bLPN\b|\bRN\b|\bCNA\b|staffing'),
        'guards': (r'^(S206|R430|R499)', r'^(56161|56162|56199)', r'\bguard(s|ing)?\b|security officer|protective service|armed|unarmed')}
def labels():
    L = g['labels']()
    if os.path.exists(f'{V7}/labels/r12_meta.json'):
        L.update(r6['load_labels'](f'{V7}/labels/r12_meta.json', V7 + '/labels/r12lab_*_r{k}.jsonl'))
    return L
def pool(b):
    pc, nc, kw = POOL[b]
    return [n for n, r in B.items() if re.search(pc, str(r.get('psc_code') or '')) or re.search(nc, str(r.get('naics_code') or '')) or re.search(kw, str(r.get('title') or ''), re.I)]
sol = lambda n: re.sub(r'[^A-Z0-9]', '', (B[n].get('solicitation_number') or '').upper()) or n
if cmd == 'build':
    L = g['labels'](); todo = [(b, n) for b in POOL for n in pool(b) if (b, n) not in L]
    random.seed(121); random.shuffle(todo); meta = []; sheets = []
    for k, (b, n) in enumerate(todo):
        r = B[n]; iid = f'r12-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat='service'))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        sheets.append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n")
    os.makedirs(f'{V7}/sheets12', exist_ok=True); names = []
    for j in range(0, len(sheets), 35):
        fn = f'sheet_service_{j // 35:02d}.md'; open(f'{V7}/sheets12/{fn}', 'w').write('\n'.join(sheets[j:j + 35])); names.append(fn)
    json.dump(meta, open(f'{V7}/labels/r12_meta.json', 'w')); print(len(todo), 'items', {b: sum(1 for x in todo if x[0] == b) for b in POOL}, names)
elif cmd == 'score':
    L = labels(); out = {}
    for b in POOL:
        P = pool(b); lab = [n for n in P if (b, n) in L]
        allrel = {lvl: [n for (bb, n), v in L.items() if bb == b and n in B and v[lvl]] for lvl in ('lo', 'hi')}
        fit = [n for n in allrel['lo'] if all(str(x).upper() == 'FIT' for x in L[(b, n)].get('l', []))]
        out[b] = dict(pool=len(P), pool_labelled=len(lab), relevant_both=len(allrel['lo']), relevant_both_solicitations=len({sol(n) for n in allrel['lo']}),
                      relevant_either=len(allrel['hi']), relevant_either_solicitations=len({sol(n) for n in allrel['hi']}),
                      direct_both=len(fit), direct_both_solicitations=len({sol(n) for n in fit}))
        print(b, out[b])
    json.dump(out, open(f'{V7}/results/r12_eval.json', 'w'), indent=1)
