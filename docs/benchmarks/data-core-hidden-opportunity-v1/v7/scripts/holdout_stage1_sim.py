# Fail-first staging (Eric 2026-11-15: guards or steel failing fails RC3 regardless): judge the near-bar businesses first, census of the Direct floor.
# Reuses holdout_load_v3's preview data and simulated human. Run: python3 -I scripts/holdout_stage1_sim.py
import os, sys, random, math, collections
V7 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.argv = [sys.argv[0], '--pooled-direct']
src = open(f'{V7}/scripts/holdout_load_v3.py').read().split("for rcs, rn in (")[0]
import io, contextlib
g = {'__file__': f'{V7}/scripts/holdout_load_v3.py', '__name__': 'h3'}
with contextlib.redirect_stdout(io.StringIO()): exec(compile(src, 'h3', 'exec'), g)
TOP, truth, ai, pd = g['TOP'], g['truth'], g['ai'], g['pd']
for stage in (['guards', 'steelbldg'], ['guards', 'steelbldg', 'paving']):
    fails = collections.Counter(); loads = []; anyfail = 0
    for it in range(2000):
        rng = random.Random(it); n_j = 0; failed = False
        for b in stage:
            ids = TOP[(b, 'rc3')]; n = len(ids); fl = math.ceil(.4 * n)
            order = sorted(ids, key=lambda i: pd(b, i))   # most-likely-not-Direct first: a fail is reached fastest
            d = nd = 0
            for i in order:
                n_j += 1
                if truth(b, i, rng) == 'D': d += 1
                else: nd += 1
                if d >= fl or nd > n - fl: break
            if d < fl: fails[b] += 1; failed = True
        anyfail += failed; loads.append(n_j)
    loads.sort()
    print('stage', '+'.join(stage), f'judgments median {loads[1000]} (p10 {loads[200]}, p90 {loads[1800]});',
          f'P(any fails) {anyfail/2000:.0%};', {b: f'{fails[b]/2000:.0%}' for b in stage})
