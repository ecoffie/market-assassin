# Round 8: AI-label PREVIEW of RC1 vs RC2 top-20 (RC2 = classification/ranking, tag search-rc2-2026-11-14 @ 065451a66).
# Diagnostic only: in-sample, AI labels, NOT the human holdout. Applies RUBRIC-ADDENDUM-2026-11-14 (repair/pharma rulings + adjudications).
# Usage: python3 -I scripts/r8.py plan|build|score
import json, os, sys, glob, random, collections
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT = os.path.dirname(V7); V6 = os.path.join(ROOT, 'v6'); V4 = os.path.join(ROOT, 'v4')
src = open(f'{V6}/scripts/r6.py').read().rsplit("{'plan': plan", 1)[0]
r6 = {'__file__': f'{V6}/scripts/r6.py', '__name__': 'r6'}; exec(compile(src, 'r6.py', 'exec'), r6)
Q = r6['Q']; S = json.load(open(f'{V7}/a3_matched_sets_rc2_classification.json'))['queries']
ADJ = {(a['biz'], a['notice_id']): a['adjudicated'] for a in json.load(open(f'{V4}/adjudications.json'))['items']}
def labels():
    L = r6['prior_labels']()
    L.update(r6['load_labels'](f'{V6}/labels/r6_meta.json', V6 + '/labels/lab_*_r{k}.jsonl'))
    L.update(r6['load_labels'](f'{V6}/labels/r7_meta.json', V6 + '/labels/r7lab_*_r{k}.jsonl'))
    L.update(r6['load_labels'](f'{V7}/labels/r8_meta.json', V7 + '/labels/r8lab_*_r{k}.jsonl'))
    for k, lab in ADJ.items():
        if k in L: L[k] = dict(L[k], lo=lab != 'NO', hi=lab != 'NO', l=[lab, lab], adjudicated=True)
    return L
cmd = sys.argv[1]
if cmd == 'plan':
    L = labels(); need = set()
    for phr, v in S.items():
        b = v['business']
        for n in v['rc1_top20'] + v['rc2_top20']:
            if (b, n) not in L: need.add((b, n))
    json.dump(sorted(need), open(f'{V7}/r8_todo.json', 'w'))
    open(f'{V7}/r8_fetch_ids.txt', 'w').write('\n'.join(sorted({n for _, n in need})) + '\n')
    print('unlabelled (business, notice) pairs', len(need))
elif cmd == 'build':
    todo = [tuple(x) for x in json.load(open(f'{V7}/r8_todo.json'))]
    ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V7}/r8_rows.jsonl') if l.strip()}
    random.seed(83); random.shuffle(todo)
    meta = []; sheets = {'service': [], 'product': []}
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r8-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        if cat == 'product':
            t += f"PRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n"
            nsn = sorted(set(r6['NSN'].findall(body)))[:6]
            if nsn: t += f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n"
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        sheets[cat].append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n")
    os.makedirs(f'{V7}/sheets', exist_ok=True); names = []
    for cat, lst in sheets.items():
        for j in range(0, len(lst), 35):
            fn = f'sheet_{cat}_{j // 35:02d}.md'; open(f'{V7}/sheets/{fn}', 'w').write('\n'.join(lst[j:j + 35])); names.append(fn)
    json.dump(meta, open(f'{V7}/labels/r8_meta.json', 'w')); print({c: len(v) for c, v in sheets.items()}, names)
elif cmd == 'score':
    L = labels(); out = {'note': 'AI labels, in-sample, diagnostic only; rubric addendum 2026-11-14 applied', 'phrasings': {}}
    for phr, v in S.items():
        b = v['business']; f = 'short' if phr == Q[b]['q'][0] else 'long'; res = {}
        for rc in ('rc1', 'rc2'):
            ids = v[f'{rc}_top20']; cls = v[f'{rc}_top20_classes']; cl = cls if isinstance(cls, dict) else dict(zip(ids, cls))
            lab = [n for n in ids if (b, n) in L]
            D = [n for n in lab if str(cl.get(n, '')).upper().startswith('DIRECT')]
            res[rc] = dict(n=len(ids), labelled=len(lab), lo=sum(L[(b, n)]['lo'] for n in lab), hi=sum(L[(b, n)]['hi'] for n in lab),
                           direct=len(D), direct_rel_lo=sum(L[(b, n)]['lo'] for n in D), classes=dict(collections.Counter(str(cl.get(n)) for n in ids)))
        out['phrasings'][f'{b}|{f}'] = res
    for form in ('short', 'long'):
        for rc in ('rc1', 'rc2'):
            rows = [v[rc] for k, v in out['phrasings'].items() if k.endswith('|' + form)]
            lo = sum(r['lo'] for r in rows); hi = sum(r['hi'] for r in rows); n = sum(r['labelled'] for r in rows)
            below = [k for k, v in out['phrasings'].items() if k.endswith('|' + form) and v[rc]['labelled'] and v[rc]['lo'] / v[rc]['labelled'] < 0.4]
            out[f'pooled_{form}_{rc}'] = dict(lo=round(lo / n, 3), hi=round(hi / n, 3), n=n, below_40=below)
            print(form, rc, out[f'pooled_{form}_{rc}'])
    json.dump(out, open(f'{V7}/results/r8_eval.json', 'w'), indent=1)
    for k, v in out['phrasings'].items():
        a, c = v['rc1'], v['rc2']
        print(f"{k:18s} rc1 {a['lo']}-{a['hi']}/{a['labelled']} (direct {a['direct']}, rel {a['direct_rel_lo']}) | rc2 {c['lo']}-{c['hi']}/{c['labelled']} (direct {c['direct']}, rel {c['direct_rel_lo']}) {c['classes']}")
