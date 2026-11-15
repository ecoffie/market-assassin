# Smaller expert-review plan (revision 3, Eric's 2026-11-15 rules): primary top-20 = DISTINCT solicitations; per-business 40% floor counts
# verified DIRECT matches only (Related reported separately); pooled 60% counts Direct+Related on distinct solicitations.
# Simulated on the v7 AI-label preview, short phrasing (frozen protocol). Simulated human from two AI reviewers (FIT=Direct, PARTIAL=Related):
# both FIT -> Direct 97%; split FIT -> Direct 50%/Related 25%; PARTIAL only -> Related 70%/Direct 10%; both NO -> NO 97%.
# Run: python3 -I scripts/holdout_load_v3.py [--pooled-direct]
import json, os, sys, random, re, glob, math, collections
POOL_DIRECT = '--pooled-direct' in sys.argv   # Eric 2026-11-15 (RC3 brief): overall 60% counts DIRECT only
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f'{V7}/scripts/r16.py').read().split("\ncmd = sys.argv[1]\n")[0]
g = {'__file__': f'{V7}/scripts/r16.py', '__name__': 'r16'}; exec(compile(src, 'r16.py', 'exec'), g)
L = g['labels'](); S2, S3, form = g['S2'], g['S3'], g['form']
FIN = {(x['business'], x['phrasing']): [t['notice_id'] for t in x['top20']] for x in json.load(open(f'{V7}/runner_rc3_candidate_final.json'))['results']}
sol = {}
for f in glob.glob(f'{V7}/*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/r6_rows*.jsonl') + glob.glob(f'{os.path.dirname(V7)}/*/results/*rows_min.jsonl'):
    for l in open(f):
        if l.strip():
            r = json.loads(l); s = re.sub(r'[^A-Z0-9]', '', (r.get('solicitation_number') or '').upper()); sol.setdefault(r['notice_id'], s or r['notice_id'])
def distinct(ids):
    seen, out = set(), []
    for n in ids:
        f = sol.get(n, n)
        if f not in seen: seen.add(f); out.append(n)
    return out
TOP = {}
for p, v3 in S3.items():
    b = v3['business']
    if form(b, p) != 'short': continue
    TOP[(b, 'rc2')] = distinct(S2[p]['rc2_top20']); TOP[(b, 'rc3')] = distinct(FIN[(b, v3['phrasing'])])
BIZ = sorted({b for b, _ in TOP})
def ai(b, n):
    x = L.get((b, n)); return [str(v).upper() for v in x['l']] if x else ['?', '?']
def truth(b, n, rng):
    l = ai(b, n); fit = l.count('FIT'); par = l.count('PARTIAL'); u = rng.random()
    if fit == 2: return 'D' if u < .97 else 'R' if u < .985 else 'N'
    if fit == 1: return 'D' if u < .5 else 'R' if u < .75 else 'N'
    if par: return 'R' if u < .7 else 'D' if u < .8 else 'N'
    if '?' in l: return 'D' if u < .3 else 'R' if u < .45 else 'N'
    return 'N' if u < .97 else 'R'
pd = lambda b, n: ai(b, n).count('FIT') / 2 + (.05 if 'PARTIAL' in ai(b, n) else 0)
# AI preview under the new rules (lo = both reviewers, hi = either)
print('AI preview, distinct solicitations, short phrasing: Direct lo-hi / n (floor = ceil(40% of n)); relevant lo-hi')
for rc in ('rc2', 'rc3'):
    tot = [0, 0, 0, 0, 0]; below = []
    for b in BIZ:
        ids = TOP[(b, rc)]; n = len(ids); dl = sum(ai(b, i).count('FIT') == 2 for i in ids); dh = sum('FIT' in ai(b, i) for i in ids)
        rl = sum(L[(b, i)]['lo'] for i in ids if (b, i) in L); rh = sum(L[(b, i)]['hi'] for i in ids if (b, i) in L)
        fl = math.ceil(.4 * n); tot = [tot[0] + n, tot[1] + dl, tot[2] + dh, tot[3] + rl, tot[4] + rh]
        if dl < fl: below.append(f'{b} {dl}-{dh}/{n}')
        if rc == 'rc3': print(f'  rc3 {b:12s} n={n:2d} floor={fl} direct {dl}-{dh}  relevant {rl}-{rh}')
    print(f' {rc}: pooled relevant {tot[3]/tot[0]:.0%}-{tot[4]/tot[0]:.0%}, pooled DIRECT {tot[1]/tot[0]:.0%}-{tot[2]/tot[0]:.0%} of {tot[0]}; Direct below floor (lo): {below}')
def lower95(k, n, N):  # one-sided 95% normal bound with finite-population correction
    ph = k / n; return ph - 1.645 * math.sqrt(ph * (1 - ph) / n * (N - n) / (N - 1))
def sim(rcs, recall_n, reps=300):
    out = []
    for it in range(reps):
        rng = random.Random(it); seen = {}
        lab = lambda b, n: seen.setdefault((b, n), truth(b, n, rng))
        for rc in rcs:
            for b in BIZ:
                ids = TOP[(b, rc)]; n = len(ids); fl = math.ceil(.4 * n)
                exp = sum(ai(b, i).count('FIT') == 2 for i in ids)
                order = sorted(ids, key=lambda i: -pd(b, i)) if exp >= fl else sorted(ids, key=lambda i: pd(b, i))
                d = nd = 0
                for i in order:
                    if lab(b, i) == 'D': d += 1
                    else: nd += 1
                    if d >= fl or nd > n - fl: break
            pool = [(b, i) for b in BIZ for i in TOP[(b, rc)]]; N = len(pool); rng.shuffle(pool); k = m = 0
            for bi in pool:   # sequential pooled sample; stop when the bound clears 60% either way (checked every 20, min 40)
                k += (lab(*bi) == 'D') if POOL_DIRECT else (lab(*bi) != 'N'); m += 1
                if m >= 40 and m % 20 == 0:
                    lo = lower95(k, m, N); hi = 2 * k / m - lo
                    if lo >= .6 or hi < .6: break
        out.append(len(seen) + recall_n)
    out.sort(); return out[len(out) // 2], out[len(out) // 10], out[9 * len(out) // 10]
for rcs, rn in ((['rc3'], 42), (['rc3'], 60), (['rc2', 'rc3'], 42), (['rc2', 'rc3'], 60)):
    med, p10, p90 = sim(rcs, rn); print(f'certify {"+".join(rcs)} recall {rn}: judgments median {med} (p10 {p10}, p90 {p90}); Eric at 30-45 s = {med*30/60:.0f}-{med*45/60:.0f} min')
