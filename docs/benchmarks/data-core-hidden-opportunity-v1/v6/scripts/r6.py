# Round 6: blind scoring of Agent 3's release-candidate retrieval (rc_candidate, 1b7f3c129) against production (7f328de91).
#   plan  -> r6_plan.json, r6_fetch_ids.txt   (added sample, removed sample, rc top-20, per phrasing; deterministic hashes)
#   build -> sheets/ + labels/r6_meta.json    (only (business, notice) pairs not already labelled in v3/v4/v5; added, removed
#                                              and top-20 rows shuffled together so reviewers cannot tell them apart)
#   score -> results/r6_eval.json             (retrieval, classification and ranking reported separately; AI labels only)
# Usage: python3 -I scripts/r6.py plan|build|score
import json, os, re, sys, glob, math, random, hashlib, collections
V6 = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); ROOT = os.path.dirname(V6)
V4, V5, V3 = (os.path.join(ROOT, d) for d in ('v4', 'v5', 'v3'))
Q = json.load(open(f'{V4}/queries_v4.json')); SETS = json.load(open(f'{V6}/a3_matched_sets_rc.json'))['queries']
pick = lambda ids, n, salt: sorted(ids, key=lambda i: hashlib.sha256(f'r6|{salt}|{i}'.encode()).hexdigest())[:n]
rel = lambda x: x in ('FIT', 'PARTIAL')
form_of = lambda b, phr: 'short' if phr == Q[b]['q'][0] else 'long'

def plan():
    P = {}
    for phr, v in SETS.items():
        b = v['business']; f = form_of(b, phr); k = f'{b}|{f}'
        base, rc = set(v['baseline']), set(v['rc_candidate']); add, rm = sorted(rc - base), sorted(base - rc)
        P[k] = dict(business=b, form=f, phrasing=phr, sizes=dict(baseline=len(base), rc=len(rc), added=len(add), removed=len(rm)),
                    added_sample=pick(add, 30 if f == 'short' else 20, k + 'add'), removed_sample=pick(rm, 25, k + 'rm'),
                    top20=list(v.get('rc_top20_ranked') or [])[:20], top20_classes=v.get('rc_top20_classes'))
    json.dump(P, open(f'{V6}/r6_plan.json', 'w'), indent=1)
    ids = sorted({i for p in P.values() for i in p['added_sample'] + p['removed_sample'] + p['top20']})
    open(f'{V6}/r6_fetch_ids.txt', 'w').write('\n'.join(ids) + '\n')
    for k, p in P.items(): print(k.ljust(18), p['sizes'], 'add', len(p['added_sample']), 'rm', len(p['removed_sample']), 'top', len(p['top20']))
    print('unique ids', len(ids))

def load_labels(meta_path, pattern, keep=lambda m: True):
    R = {1: {}, 2: {}}
    for k in (1, 2):
        for f in glob.glob(pattern.format(k=k)):
            for l in open(f):
                if l.strip():
                    try: j = json.loads(l); R[k][j['id']] = j
                    except Exception: pass
    out = {}
    if not os.path.exists(meta_path): return out
    for m in json.load(open(meta_path)):
        if m['id'] in R[1] and m['id'] in R[2] and keep(m):
            a, b = R[1][m['id']], R[2][m['id']]
            out[(m['biz'], m['notice_id'])] = dict(lo=rel(a['label']) and rel(b['label']), hi=rel(a['label']) or rel(b['label']),
                                                  l=[a['label'], b['label']], restriction=sorted({a.get('restriction') or 'NONE', b.get('restriction') or 'NONE'}))
    return out

def prior_labels():
    L = {}
    L.update(load_labels(f'{V3}/labels/r3_meta.json', V3 + '/labels/lab_*_r{k}.jsonl', keep=lambda m: Q[m['biz']]['cat'] == 'service'))
    L.update(load_labels(f'{V4}/labels/r4_meta.json', V4 + '/labels/lab_*_r{k}.jsonl'))
    L.update(load_labels(f'{V5}/labels/r5_meta.json', V5 + '/labels/lab_*_r{k}.jsonl'))
    return L

STOP = set('we our the and of a an to for in on provide supply are is like do sell commercial industrial install maintain systems services service company'.split())
stems = lambda t: {w[:5] for w in re.findall(r'[a-z]+', (t or '').lower()) if w not in STOP and len(w) > 2}
clean = lambda t: re.sub(r'\s+', ' ', re.sub(r'&[a-z#0-9]+;', ' ', re.sub(r'<[^>]+>', ' ', t or ''))).strip()
NSN = re.compile(r'\b\d{4}-\d{2}-\d{3}-\d{4}\b|\bNSN[:\s#]*\d{13}\b', re.I)
def support(r, b):
    body = clean(' '.join(filter(None, [r.get('description'), r.get('sow_text')]))); sents = [s for s in re.split(r'(?<=[.!?;])\s+', body) if s]
    qs, ps = stems(Q[b]['q'][0]), stems(Q[b]['q'][1]); best = None
    for i, s in enumerate(sents):
        w = stems(s); sc = (len(w & qs), len(w & ps))
        if sc[0] + sc[1] > 0 and (best is None or sc > best[0]): best = (sc, i)
    if not best: return None, None, body
    i = best[1]; return sents[i][:500], ' '.join(sents[max(0, i - 1):i + 2])[:1100], body

def build():
    P = json.load(open(f'{V6}/r6_plan.json')); ROWS = {json.loads(l)['notice_id']: json.loads(l) for l in open(f'{V6}/r6_rows.jsonl') if l.strip()}
    L = prior_labels()
    pairs = sorted({(p['business'], n) for p in P.values() for n in p['added_sample'] + p['removed_sample'] + p['top20']})
    todo = [x for x in pairs if x not in L and x[1] in ROWS]
    random.seed(67); random.shuffle(todo)
    meta = []; sheets = {'service': [], 'product': []}
    for k, (b, n) in enumerate(todo):
        r = ROWS[n]; cat = Q[b]['cat']; iid = f'r6-{k:04d}'; meta.append(dict(id=iid, biz=b, notice_id=n, cat=cat))
        sent, ctx, body = support(r, b)
        t = (f"### {iid}\nBUSINESS (the customer's own words): {Q[b]['q'][0]}\nFULL DESCRIPTION: {Q[b]['q'][1]}\n"
             f"TITLE: {clean(r.get('title'))}\nAGENCY: {r.get('department')} / {r.get('sub_tier')}\nNOTICE TYPE: {r.get('notice_type')}\n")
        if cat == 'product':
            t += f"PRODUCT SERVICE CODE (PSC/FSC): {r.get('psc_code') or 'none'}\n"
            nsn = sorted(set(NSN.findall(body)))[:6]
            if nsn: t += f"NSN / PART IDS FOUND IN TEXT: {', '.join(nsn)}\n"
        t += (f"SUPPORTING SENTENCE (the notice sentence sharing the most words with the business): \"{sent}\"\nCONTEXT AROUND IT: {ctx}\n" if sent
              else "SUPPORTING SENTENCE: none (no sentence shares a word with the business description)\n")
        t += f"NOTICE OPENING (first 1,400 chars): {body[:1400]}\n"
        sheets[cat].append(t)
    os.makedirs(f'{V6}/sheets', exist_ok=True)
    for f in glob.glob(f'{V6}/sheets/*.md'): os.remove(f)
    names = []
    for cat, lst in sheets.items():
        for j in range(0, len(lst), 35):
            fn = f'sheet_{cat}_{j // 35:02d}.md'; open(f'{V6}/sheets/{fn}', 'w').write('\n'.join(lst[j:j + 35])); names.append(fn)
    json.dump(meta, open(f'{V6}/labels/r6_meta.json', 'w'))
    print('pairs', len(pairs), 'already labelled', len(pairs) - len(todo), 'new', len(todo), {c: len(v) for c, v in sheets.items()}, names)

def wil(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 2), round(c + h, 2)]

def score():
    P = json.load(open(f'{V6}/r6_plan.json')); L = prior_labels()
    L6 = load_labels(f'{V6}/labels/r6_meta.json', V6 + '/labels/lab_*_r{k}.jsonl'); L.update(L6)
    meta6 = json.load(open(f'{V6}/labels/r6_meta.json')); unl = [m['id'] for m in meta6 if (m['biz'], m['notice_id']) not in L6]
    def prec(ids, b):
        ids = [i for i in ids if (b, i) in L]; lo = sum(L[(b, i)]['lo'] for i in ids); hi = sum(L[(b, i)]['hi'] for i in ids)
        return dict(n=len(ids), lo=lo, hi=hi, ci_lo=wil(lo, len(ids)), ci_hi=wil(hi, len(ids)))
    est = lambda m, tot: [round(tot * m['lo'] / m['n']), round(tot * m['hi'] / m['n'])] if m['n'] else None
    out = {'labels': dict(new=len(L6), unlabelled=len(unl), agree_exact=sum(v['l'][0] == v['l'][1] for v in L6.values()),
                          agree_relevant=sum(rel(v['l'][0]) == rel(v['l'][1]) for v in L6.values())), 'phrasings': {}}
    for k, p in P.items():
        b = p['business']; s = p['sizes']; a = prec(p['added_sample'], b); r = prec(p['removed_sample'], b); t = prec(p['top20'], b)
        cls = p.get('top20_classes') or {}
        cl = cls if isinstance(cls, dict) else dict(zip(p['top20'], cls))
        direct = [n for n in p['top20'] if str(cl.get(n, '')).upper().startswith('DIRECT')]
        restr = collections.Counter(x for n in p['added_sample'] if (b, n) in L and L[(b, n)]['hi'] for x in L[(b, n)]['restriction'] if x != 'NONE')
        out['phrasings'][k] = dict(cat=Q[b]['cat'], sizes=s, added=a, est_relevant_added=est(a, s['added']),
                                   removed=r, est_relevant_removed=est(r, s['removed']),
                                   removed_relevant=[dict(id=n, labels=L[(b, n)]['l']) for n in p['removed_sample'] if (b, n) in L and L[(b, n)]['hi']],
                                   top20=t, top20_direct=dict(n=len(direct), relevant_lo=sum(L[(b, n)]['lo'] for n in direct if (b, n) in L)),
                                   top20_irrelevant_direct=[n for n in direct if (b, n) in L and not L[(b, n)]['hi']],
                                   restrictions_among_relevant_added=dict(restr))
    sh = [v for k, v in out['phrasings'].items() if k.endswith('|short')]
    lo = sum(v['top20']['lo'] for v in sh); hi = sum(v['top20']['hi'] for v in sh); n = sum(v['top20']['n'] for v in sh)
    out['gate_preview_short'] = dict(pooled_top20=[round(lo / n, 3), round(hi / n, 3)],
                                     below_40=[k for k, v in out['phrasings'].items() if k.endswith('|short') and v['top20']['n'] and v['top20']['lo'] / v['top20']['n'] < 0.4])
    json.dump(out, open(f'{V6}/results/r6_eval.json', 'w'), indent=1)
    print('labels', out['labels'], 'gate_preview_short', out['gate_preview_short'])
    for k, v in out['phrasings'].items():
        a, r, t = v['added'], v['removed'], v['top20']
        print(f"{k:18s} +{v['sizes']['added']:5d} {a['lo']}-{a['hi']}/{a['n']} est {v['est_relevant_added']} | -{v['sizes']['removed']:3d} rel {r['lo']}-{r['hi']}/{r['n']} | top20 {t['lo']}-{t['hi']}/{t['n']} direct {v['top20_direct']} | restr {v['restrictions_among_relevant_added']}")

{'plan': plan, 'build': build, 'score': score}[sys.argv[1]]()
