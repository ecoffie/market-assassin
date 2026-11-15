# Round 7 (medical only): blind scoring of Agent 3's rc2 variants (761b8d73b) vs production, short and long medical phrasings.
#   rc2_phrase       shared-head list items as adjacent phrases
#   rc2_phrase_6505  + PSC 6505 on the medical preset (computed, not committed by Agent 3)
# Samples from the UNION of each variant's additions/removals so one labelled set scores both. Reuses v3-v6 labels.
# Usage: python3 -I scripts/r7_medical.py plan|build|score   (fetch with: npx tsx scripts/fetch_rows.mts <v6> after renaming ids file)
import json, os, sys, random, hashlib, glob
V6 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.argv, cmd = [sys.argv[0], 'noop'], sys.argv[1]
import importlib.util
spec = importlib.util.spec_from_file_location('r6', f'{V6}/scripts/r6.py')
src = open(f'{V6}/scripts/r6.py').read().rsplit("{'plan': plan", 1)[0]   # reuse helpers without running r6's dispatcher
r6 = {'__file__': f'{V6}/scripts/r6.py', '__name__': 'r6'}; exec(compile(src, 'r6.py', 'exec'), r6)
Q = r6['Q']; S = json.load(open(f'{V6}/a3_matched_sets_rc2.json'))['queries']
VARS = ('rc2_phrase', 'rc2_phrase_6505')
pick = lambda ids, n, salt: sorted(ids, key=lambda i: hashlib.sha256(f'r7|{salt}|{i}'.encode()).hexdigest())[:n]
def keys():
    for phr, v in S.items():
        if v['business'] == 'medical': yield ('short' if phr == Q['medical']['q'][0] else 'long'), v
if cmd == 'plan':
    P = {}
    for form, v in keys():
        base = set(v['baseline']); add = set(); rm = set()
        for var in VARS: s = set(v[var]); add |= s - base; rm |= base - s
        n_add = 40 if form == 'short' else 25
        P[form] = dict(sizes={var: dict(n=len(v[var]), added=len(set(v[var]) - base), removed=len(base - set(v[var]))) for var in VARS},
                       added_sample=pick(sorted(add), n_add, form + 'a'), removed_sample=pick(sorted(rm), 30, form + 'r'))
        print(form, P[form]['sizes'], len(P[form]['added_sample']), len(P[form]['removed_sample']))
    json.dump(P, open(f'{V6}/r7_plan.json', 'w'), indent=1)
    ids = sorted({i for p in P.values() for i in p['added_sample'] + p['removed_sample']})
    open(f'{V6}/r6_fetch_ids.txt', 'w').write('\n'.join(ids) + '\n'); print('ids', len(ids))
elif cmd == 'build':
    P = json.load(open(f'{V6}/r7_plan.json')); ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V6}/r6_rows.jsonl') if l.strip()}
    L = r6['prior_labels'](); L.update(r6['load_labels'](f'{V6}/labels/r6_meta.json', V6 + '/labels/lab_*_r{k}.jsonl'))
    pairs = sorted({('medical', n) for p in P.values() for n in p['added_sample'] + p['removed_sample']})
    todo = [x for x in pairs if x not in L]; random.seed(71); random.shuffle(todo)
    meta = []; items = []
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; iid = f'r7-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat='product'))
        sent, ctx, body = r6['support'](r, b); clean = r6['clean']
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\nTITLE: {clean(r.get('title'))}\n"
             f"AGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\nPRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n")
        nsn = sorted(set(r6['NSN'].findall(body)))[:6]
        if nsn: t += f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n"
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        items.append(t + f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n")
    os.makedirs(f'{V6}/sheets7', exist_ok=True)
    for j in range(0, len(items), 35): open(f'{V6}/sheets7/sheet_r7_{j // 35:02d}.md', 'w').write('\n'.join(items[j:j + 35]))
    json.dump(meta, open(f'{V6}/labels/r7_meta.json', 'w')); print('pairs', len(pairs), 'new', len(todo))
elif cmd == 'score':
    P = json.load(open(f'{V6}/r7_plan.json')); L = r6['prior_labels']()
    L.update(r6['load_labels'](f'{V6}/labels/r6_meta.json', V6 + '/labels/lab_*_r{k}.jsonl'))
    L7 = r6['load_labels'](f'{V6}/labels/r7_meta.json', V6 + '/labels/r7lab_*_r{k}.jsonl'); L.update(L7)
    out = {'new_labels': len(L7), 'agree_relevant': sum(r6['rel'](v['l'][0]) == r6['rel'](v['l'][1]) for v in L7.values()), 'forms': {}}
    for form, v in keys():
        base = set(v['baseline']); p = P[form]; res = {}
        for var in VARS:
            s = set(v[var]); A = [n for n in p['added_sample'] if n in s - base and ('medical', n) in L]; R = [n for n in p['removed_sample'] if n in base - s and ('medical', n) in L]
            f = lambda ids, k: sum(L[('medical', n)][k] for n in ids)
            na, nr = len(s - base), len(base - s)
            res[var] = dict(added=na, added_sample=len(A), added_rel=[f(A, 'lo'), f(A, 'hi')], est_rel_added=[round(na * f(A, 'lo') / len(A)), round(na * f(A, 'hi') / len(A))] if A else None,
                            removed=nr, removed_sample=len(R), removed_rel=[f(R, 'lo'), f(R, 'hi')], est_rel_lost=[round(nr * f(R, 'lo') / len(R)), round(nr * f(R, 'hi') / len(R))] if R else None,
                            lost_rows=[n for n in R if L[('medical', n)]['hi']])
        out['forms'][form] = res
    json.dump(out, open(f'{V6}/results/r7_medical_eval.json', 'w'), indent=1); print(json.dumps(out, indent=1)[:3000])
