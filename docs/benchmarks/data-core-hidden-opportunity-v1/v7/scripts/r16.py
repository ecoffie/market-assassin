# Round 16: RC3 candidate agent3/rc3-candidate @ 23dcfae03 (untagged) = all-in + S1 + P1/P2 + V-narrow. Derived from round 15 —
# Round 15: nursing V-narrow 43a1c6ca7 / +Q519 96b283535, V-ranked 522b82da2, parts-steel S1 f94a01444 and S1+P1/P2 4a89f74f6, all-in e4cee694a.
# Derived from round 14 —
# Round 14: nurse-staffing related-PSC retrieval, n2-modifier-text @ 5d48336e1. Derived from round 13 —
# Round 13: AI-label PREVIEW of rc3-guard-window @ 8b2b594e1 (combined + NAVSUP repair demotion + cheap code window) and
# n2-modifier-text @ 74b9dec43 (N2/N2b on top). Derived from round 11: AI-label PREVIEW of Agent 3's IT code-window branches (it-window-evidence A=df15df2d7, A+C=3158a994e) and rc3-guard-window d56ebc307,
# with runner 1.1.0 (code-recall sub-window emulated). Built on round 10 (long-list family guard) (agent3/long-list-family-guard @ 38cd537ad, off the RC3 line; NOT tagged,
# not a holdout candidate unless Eric approves). Top-20 produced by Agent 3's validated holdout runner from Agent 4's own checkout on the
# fixture snapshot (runner_flg_longlist_guard.json). Scores raw top-20 (frozen measure) and distinct solicitation families, vs RC1/RC2/RC3.
# Usage: python3 -I scripts/r10.py plan|build|score
import json, os, sys, glob, re, random
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{V7}/scripts/r9.py').read().split("\ncmd = sys.argv[1]\n")[0]
g = {'__file__': f'{V7}/scripts/r9.py', '__name__': 'r9'}; exec(compile(src, 'r9.py', 'exec'), g)
r6, Q, S2, S3, form = g['r6'], g['Q'], g['S2'], g['S3'], g['form']
RUN = {'flg': 'runner_flg_longlist_guard.json', 'itA': 'runner_it_window_A.json', 'itAC': 'runner_it_window_AC.json', 'gw': 'runner_rc3_guard_window.json', 'gwr': 'runner_rc3_guard_window_repair.json', 'n2b': 'runner_n2_modifier_text.json', 'nrs': 'runner_nurse_related_psc.json', **{k: f'runner_v15_{k}.json' for k in ('nvn', 'nvn19', 'nvr', 's1', 'ps', 'allin')}, 'cand': 'runner_rc3_candidate.json'}
FF = {k: {(x['business'], x['phrasing']): x for x in json.load(open(f'{V7}/{f}'))['results']} for k, f in RUN.items()}
NEW = ('cand',)
def labels():
    L = g['labels']()
    if os.path.exists(f'{V7}/labels/r10_meta.json'):
        L.update(r6['load_labels'](f'{V7}/labels/r10_meta.json', V7 + '/labels/r10lab_*_r{k}.jsonl'))
    if os.path.exists(f'{V7}/labels/r11_meta.json'):
        L.update(r6['load_labels'](f'{V7}/labels/r11_meta.json', V7 + '/labels/r11lab_*_r{k}.jsonl'))
    for rnd in ('r12', 'r13', 'r14', 'r15', 'r15b'):
        if os.path.exists(f'{V7}/labels/{rnd}_meta.json'):
            L.update(r6['load_labels'](f'{V7}/labels/{rnd}_meta.json', V7 + f'/labels/{rnd}lab_*_r' + '{k}.jsonl'))
    for k, lab in g['g']['ADJ'].items():
        if k in L: L[k] = dict(L[k], lo=lab != 'NO', hi=lab != 'NO', l=[lab, lab])
    # Precedence rule (Eric, 2026-11-15): Eric's own labels override rulings/adjudications and AI. Applied LAST.
    sys.path.insert(0, os.path.join(os.path.dirname(V7), 'expert-regression')); import expert
    L, _, _ = expert.apply_expert(L)
    return L
def rows_for(p, v3):
    b = v3['business']; key = (b, v3['phrasing'])
    T = {'rc1': S2[p]['rc1_top20'], 'rc2': S2[p]['rc2_top20'], 'rc3': v3['rc3_top20']}
    for k in RUN: T[k] = [t['notice_id'] for t in FF[k][key]['top20']]
    return b, T, {k: FF[k][key] for k in RUN}
cmd = sys.argv[1]
if cmd == 'plan':
    L = labels(); need = set()
    for p, v3 in S3.items():
        b, T, f = rows_for(p, v3)
        for n in [n for c in NEW for n in T[c]]:
            if (b, n) not in L: need.add((b, n))
    json.dump(sorted(need), open(f'{V7}/r8_todo.json', 'w'))
    open(f'{V7}/r8_fetch_ids.txt', 'w').write('\n'.join(sorted({n for _, n in need})) + '\n')
    print('unlabelled (business, notice) pairs in new top-20s:', len(need))
elif cmd == 'build':
    todo = [tuple(x) for x in json.load(open(f'{V7}/r8_todo.json'))]
    ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V7}/r8_rows.jsonl') if l.strip()}
    random.seed(161); random.shuffle(todo); meta = []; sheets = {'service': [], 'product': []}
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r16-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
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
    os.makedirs(f'{V7}/sheets16', exist_ok=True); names = []
    for cat, lst in sheets.items():
        for j in range(0, len(lst), 35):
            fn = f'sheet_{cat}_{j // 35:02d}.md'; open(f'{V7}/sheets16/{fn}', 'w').write('\n'.join(lst[j:j + 35])); names.append(fn)
    json.dump(meta, open(f'{V7}/labels/r16_meta.json', 'w')); print({c: len(v) for c, v in sheets.items()}, names)
elif cmd == 'score':
    L = labels(); sol = {}
    for f in glob.glob(f'{V7}/*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/r6_rows*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/results/*rows_min.jsonl'):
        for l in open(f):
            if l.strip():
                r = json.loads(l); s = re.sub(r'[^A-Z0-9]', '', (r.get('solicitation_number') or '').upper()); sol.setdefault(r['notice_id'], s or r['notice_id'])
    fam = lambda n: sol.get(n, n)
    out = {'note': 'AI labels, in-sample, diagnostic only. Raw top-20 = frozen measure; distinct family supplementary.', 'phrasings': {}}
    RCS = ('rc1', 'rc2', 'rc3', 'allin', 'cand')
    for p, v3 in S3.items():
        b, T, f = rows_for(p, v3); k = f'{b}|{form(b, p)}'; res = {}
        for rc in RCS:
            ids = T[rc]; lab = [n for n in ids if (b, n) in L]; seen = set(); fi = []
            for n in ids:
                if fam(n) not in seen: seen.add(fam(n)); fi.append(n)
            fl = [n for n in fi if (b, n) in L]
            res[rc] = dict(n=len(ids), labelled=len(lab), lo=sum(L[(b, n)]['lo'] for n in lab), hi=sum(L[(b, n)]['hi'] for n in lab),
                           families=len(fi), fam_lo=sum(L[(b, n)]['lo'] for n in fl), fam_hi=sum(L[(b, n)]['hi'] for n in fl))
        res['matched_vs_rc3'] = {c: dict(n=f[c]['matched_count'], added=len(set(f[c]['matched']) - set(v3['rc3'])), removed=len(set(v3['rc3']) - set(f[c]['matched'])), code_window=len(f[c].get('code_window_ids') or [])) for c in NEW}
        out['phrasings'][k] = res
    for fm in ('short', 'long'):
        for rc in RCS:
            rows = [v[rc] for k, v in out['phrasings'].items() if k.endswith('|' + fm)]
            lo = sum(r['lo'] for r in rows); hi = sum(r['hi'] for r in rows); n = sum(r['labelled'] for r in rows)
            below = [k.split('|')[0] for k, v in out['phrasings'].items() if k.endswith('|' + fm) and v[rc]['labelled'] and v[rc]['lo'] / v[rc]['labelled'] < 0.4]
            out[f'pooled_{fm}_{rc}'] = dict(raw=[round(lo / n, 3), round(hi / n, 3)], n=n, below_40=below)
            print(fm, rc, out[f'pooled_{fm}_{rc}'])
    json.dump(out, open(f'{V7}/results/r16_eval.json', 'w'), indent=1)
    for k, v in out['phrasings'].items():
        print(f'{k:18s} ' + ' | '.join(f"{rc} {v[rc]['lo']}-{v[rc]['hi']}/{v[rc]['labelled']} fam {v[rc]['fam_lo']}/{v[rc]['families']}" for rc in RCS) + f" | {v['matched_vs_rc3']}")
