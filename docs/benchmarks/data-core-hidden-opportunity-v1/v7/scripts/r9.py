# Round 9: AI-label PREVIEW of Agent 3's RC3 development branch (agent3/search-rc3 @ 34aad5828; NOT tagged, NOT a holdout candidate
# unless Eric approves). Scores (a) precision of RC3's retrieval additions vs RC2, (b) top-20 for RC1/RC2/RC3 on the FROZEN measure
# (raw top-20, what a customer sees) and, as a supplementary view for ALL candidates equally, (c) distinct solicitation families within the top-20.
# Usage: python3 -I scripts/r9.py plan|build|score
import json, os, sys, random, hashlib, re, collections, glob
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{V7}/scripts/r8.py').read().split("cmd = sys.argv[1]")[0]
g = {'__file__': f'{V7}/scripts/r8.py', '__name__': 'r8'}; exec(compile(src, 'r8.py', 'exec'), g)
r6, Q, S2 = g['r6'], g['Q'], g['S']
S3 = json.load(open(f'{V7}/a3_matched_sets_rc3_preview.json'))['queries']
pick = lambda ids, n, salt: sorted(ids, key=lambda i: hashlib.sha256(f'r9|{salt}|{i}'.encode()).hexdigest())[:n]
def labels():
    L = g['labels']()
    L.update(r6['load_labels'](f'{V7}/labels/r9_meta.json', V7 + '/labels/r9lab_*_r{k}.jsonl'))
    for k, lab in g['ADJ'].items():
        if k in L: L[k] = dict(L[k], lo=lab != 'NO', hi=lab != 'NO', l=[lab, lab])
    return L
form = lambda b, p: 'short' if p == Q[b]['q'][0] else 'long'
cmd = sys.argv[1]
if cmd == 'plan':
    L = labels(); need = set(); plan = {}
    for p, v in S3.items():
        b = v['business']; add = sorted(set(v['rc3']) - set(v['rc2'])); k = f'{b}|{form(b, p)}'
        samp = pick(add, 30 if form(b, p) == 'short' else 20, k)
        plan[k] = dict(added=len(add), added_sample=samp)
        for n in samp + v['rc3_top20']:
            if (b, n) not in L: need.add((b, n))
    json.dump(plan, open(f'{V7}/r9_plan.json', 'w'), indent=1); json.dump(sorted(need), open(f'{V7}/r8_todo.json', 'w'))
    open(f'{V7}/r8_fetch_ids.txt', 'w').write('\n'.join(sorted({n for _, n in need})) + '\n')
    print('unlabelled pairs', len(need), {k: (v['added'], len(v['added_sample'])) for k, v in plan.items() if v['added']})
elif cmd == 'build':   # reuse r8's sheet builder on the new todo, with r9 ids
    todo = [tuple(x) for x in json.load(open(f'{V7}/r8_todo.json'))]
    ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V7}/r8_rows.jsonl') if l.strip()}
    random.seed(97); random.shuffle(todo); meta = []; sheets = {'service': [], 'product': []}
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r9-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
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
    os.makedirs(f'{V7}/sheets9', exist_ok=True); names = []
    for cat, lst in sheets.items():
        for j in range(0, len(lst), 35):
            fn = f'sheet_{cat}_{j // 35:02d}.md'; open(f'{V7}/sheets9/{fn}', 'w').write('\n'.join(lst[j:j + 35])); names.append(fn)
    json.dump(meta, open(f'{V7}/labels/r9_meta.json', 'w')); print({c: len(v) for c, v in sheets.items()}, names)
elif cmd == 'score':
    L = labels()
    sol = {}
    for f in glob.glob(f'{V7}/*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/r6_rows*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/results/*rows_min.jsonl'):
        for l in open(f):
            if l.strip():
                r = json.loads(l); s = re.sub(r'[^A-Z0-9]', '', (r.get('solicitation_number') or '').upper())
                sol.setdefault(r['notice_id'], s or r['notice_id'])
    fam = lambda n: sol.get(n, n)
    out = {'note': 'AI labels, in-sample, diagnostic only. Raw top-20 is the frozen gate measure; distinct-family is supplementary, applied to every candidate.', 'phrasings': {}}
    plan = json.load(open(f'{V7}/r9_plan.json'))
    for p, v3 in S3.items():
        b = v3['business']; k = f'{b}|{form(b, p)}'; v2 = S2[p]; res = {}
        for rc, ids in (('rc1', v2['rc1_top20']), ('rc2', v2['rc2_top20']), ('rc3', v3['rc3_top20'])):
            lab = [n for n in ids if (b, n) in L]; seen = set(); fam_ids = []
            for n in ids:
                if fam(n) not in seen: seen.add(fam(n)); fam_ids.append(n)
            fl = [n for n in fam_ids if (b, n) in L]
            res[rc] = dict(n=len(ids), labelled=len(lab), lo=sum(L[(b, n)]['lo'] for n in lab), hi=sum(L[(b, n)]['hi'] for n in lab),
                           families=len(fam_ids), fam_lo=sum(L[(b, n)]['lo'] for n in fl), fam_hi=sum(L[(b, n)]['hi'] for n in fl), fam_labelled=len(fl))
        a = [n for n in plan[k]['added_sample'] if (b, n) in L]
        res['rc3_added'] = dict(added=plan[k]['added'], sample=len(a), lo=sum(L[(b, n)]['lo'] for n in a), hi=sum(L[(b, n)]['hi'] for n in a))
        out['phrasings'][k] = res
    for f in ('short', 'long'):
        for rc in ('rc1', 'rc2', 'rc3'):
            rows = [v[rc] for k, v in out['phrasings'].items() if k.endswith('|' + f)]
            lo = sum(r['lo'] for r in rows); hi = sum(r['hi'] for r in rows); n = sum(r['labelled'] for r in rows)
            flo = sum(r['fam_lo'] for r in rows); fn = sum(r['fam_labelled'] for r in rows)
            below = [k.split('|')[0] for k, v in out['phrasings'].items() if k.endswith('|' + f) and v[rc]['labelled'] and v[rc]['lo'] / v[rc]['labelled'] < 0.4]
            out[f'pooled_{f}_{rc}'] = dict(raw=[round(lo / n, 3), round(hi / n, 3)], distinct_family_lo=round(flo / fn, 3), below_40=below)
            print(f, rc, out[f'pooled_{f}_{rc}'])
    json.dump(out, open(f'{V7}/results/r9_eval.json', 'w'), indent=1)
    for k, v in out['phrasings'].items():
        s = ' | '.join(f"{rc} {v[rc]['lo']}-{v[rc]['hi']}/{v[rc]['labelled']} fam {v[rc]['fam_lo']}/{v[rc]['families']}" for rc in ('rc1', 'rc2', 'rc3'))
        ad = v['rc3_added']; s += f" | rc3 added {ad['added']}: {ad['lo']}-{ad['hi']}/{ad['sample']}" if ad['added'] else ''
        print(f'{k:18s} {s}')
