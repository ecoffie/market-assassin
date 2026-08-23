"""
Option 3 prototype — taxonomy selects candidates, award spend only ranks them.

    capability prose -> phrases -> NAICS index/title vocabulary -> candidates
                                                                     |
                                       award spend ranks ONLY among candidates

Award-description text NEVER enters candidate selection, so ammunition contracts that
describe machining cannot make a machine shop into an ammunition maker.

Prototype in Python to keep it comparable to baseline_eval/lift_eval (identical inputs).
Ports to TS once it clears the bar.
"""
import json,re,math,unicodedata
from collections import defaultdict

FX="src/mcp/decision-chain/fixtures/"
TAX=json.load(open(FX+"taxonomy/naics-2022.json"))

STOP=set("""the and for of to in a an with all any per from by on at as is are be will shall
that this these those other others misc miscellaneous general new used not except including
include includes support services service systems system provide provides providing provided
contract contracts award awards order orders purpose delivery deliver fixed price option
year years fy each into under over its their our your they them it also more most such
than then when where which who whom what while""".split())

# --- Hygiene layer A: generic modifiers may not stand alone as evidence. ---
# NOT a market blacklist. These are suppressed as SOLO tokens only; they still count
# inside multi-word phrases ("small arms" survives, bare "small" does not.)
GENERIC_SOLO=set("""small large big new old major minor primary secondary total full complete
partial standard custom special specialty advanced modern basic simple complex heavy light
high low medium precision quality commercial industrial military federal national regional
local domestic foreign multi single dual triple various assorted mixed combined integrated
main central main general""".split())

def norm(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode()
    return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',s.lower())).strip()

def toks(s): return [w for w in norm(s).split() if w and w not in STOP]

def phrases(text,maxn=3):
    """Capability phrases from prose: n-grams up to maxn, solo generics suppressed."""
    w=toks(text); out=[]
    for n in range(maxn,0,-1):
        for i in range(len(w)-n+1):
            g=w[i:i+n]
            if n==1:
                if len(g[0])<4 or g[0] in GENERIC_SOLO or g[0].isdigit(): continue
            else:
                if not any(len(x)>=4 and x not in GENERIC_SOLO for x in g): continue
            out.append(" ".join(g))
    seen=set(); r=[]
    for p in out:
        if p not in seen: seen.add(p); r.append(p)
    return r

# ---- Build inverted index over taxonomy vocabulary -------------------------------
# Document frequency over ENTRIES gives IDF, so ubiquitous words ("manufacturing",
# "services") carry little weight and distinctive ones ("machine shop") carry a lot.
_ENTRY_TOKENS=[]; _CODE_OF=[]
for e in TAX["entries"]:
    _ENTRY_TOKENS.append(set(toks(e["entry"]))); _CODE_OF.append(e["code"])
for code,title in TAX["titles"].items():
    if len(code)==6:
        _ENTRY_TOKENS.append(set(toks(title))); _CODE_OF.append(code)

_DF=defaultdict(int)
for ts in _ENTRY_TOKENS:
    for t in ts: _DF[t]+=1
_N=len(_ENTRY_TOKENS)
def idf(t): return math.log((_N+1)/(_DF.get(t,0)+1))+1.0

# phrase -> entries containing ALL its tokens
_POSTING=defaultdict(set)
for i,ts in enumerate(_ENTRY_TOKENS):
    for t in ts: _POSTING[t].add(i)

def entries_matching(phrase):
    pt=[t for t in toks(phrase) if t]
    if not pt: return set()
    sets=[_POSTING.get(t,set()) for t in pt]
    if not sets or any(len(s)==0 for s in sets): return set()
    out=set.intersection(*sets)
    return out

# ---- Candidate selection: TAXONOMY ONLY -----------------------------------------
def candidates(description, max_phrases=60):
    ph=phrases(description)[:max_phrases]
    score=defaultdict(float); ev=defaultdict(set)
    for p in ph:
        pt=toks(p)
        hits=entries_matching(p)
        if not hits: continue
        # Specificity: a multi-word phrase matching a short entry is strong evidence.
        w=sum(idf(t) for t in pt)*(1.0+0.6*(len(pt)-1))
        # Spread the phrase's weight over the entries it hit — a phrase matching 200
        # entries says almost nothing; one matching 1-2 entries is decisive.
        share=w/math.sqrt(len(hits))
        for i in hits:
            code=_CODE_OF[i]
            elen=len(_ENTRY_TOKENS[i]) or 1
            cover=len(set(pt)&_ENTRY_TOKENS[i])/elen   # how much of the ENTRY was matched
            score[code]+=share*(0.35+cover)
            ev[code].add(p)
    if not score: return []
    # Normalise for uneven entry counts (332710 has 3 entries, 238210 has 49).
    per_code=defaultdict(int)
    for c in _CODE_OF: per_code[c]+=1
    out=[]
    for c,s in score.items():
        out.append({"code":c,"title":TAX["titles"].get(c,""),
                    "taxonomy_score":s/math.sqrt(per_code[c]),
                    "matched_phrases":sorted(ev[c],key=len,reverse=True)[:5],
                    "entry_count":per_code[c]})
    out.sort(key=lambda x:-x["taxonomy_score"])
    return out

# ---- Confidence / abstention ----------------------------------------------------
MIN_SCORE=1.2      # absolute evidence floor
MIN_MARGIN=1.15    # top must lead runner-up by this ratio
def resolve(description, spend=None, topk=8):
    """spend: optional {code: dollars} used ONLY to order among taxonomy candidates."""
    cands=candidates(description)[:topk]
    if not cands: return {"selected":None,"reason":"no_taxonomy_match","candidates":[]}
    top=cands[0]; second=cands[1]["taxonomy_score"] if len(cands)>1 else 0.0
    for c in cands:
        c["award_evidence"]=(spend or {}).get(c["code"])
    confident = top["taxonomy_score"]>=MIN_SCORE and (second==0 or top["taxonomy_score"]/second>=MIN_MARGIN)
    return {"selected": top["code"] if confident else None,
            "reason": None if confident else ("weak_evidence" if top["taxonomy_score"]<MIN_SCORE else "ambiguous_tie"),
            "confidence": round(top["taxonomy_score"],2),
            "margin": round(top["taxonomy_score"]/second,2) if second else None,
            "candidates":cands}
