"""Evidence gate v1 (frozen lexicon). A candidate passes only if a SENTENCE from the
notice body (description or SOW text, never the title) contains a trade term.
Returns the quoted sentence so a human can check it."""
import re,json
def clean(t):
  t=re.sub(r'<[^>]+>',' ',t or ''); t=re.sub(r'&[a-z#0-9]+;',' ',t); return re.sub(r'\s+',' ',t).strip()
def sentences(t):
  for s in re.split(r'(?<=[.!?;])\s+|\s+(?=\(\w\)\s)|\s+(?=\d+\.\d*\s+[A-Z])|\s+[•▪●]\s+',t):
    s=s.strip()
    while len(s)>400:  # window very long run-ons
      yield s[:400]; s=s[350:]
    if len(s)>=12: yield s
def term_re(term):
  parts=[re.escape(w) for w in re.split(r'[\s-]+',term)]
  return re.compile(r'\b'+r'[\s-]+'.join(parts)+r'(?:s|es)?\b',re.I)
class Gate:
  def __init__(self,lex,kind): self.R={k:[(t,term_re(t)) for t in v] for k,v in lex[kind].items()}
  def check(self,biz,title,body):
    hits=[]
    for s in sentences(clean(body)):
      ts=[t for t,r in self.R[biz] if r.search(s)]
      if ts: hits.append((s,ts))
    title_hit=[t for t,r in self.R[biz] if r.search(title or '')]
    if not hits: return dict(passed=False,role='ABSTAIN',sentence=None,terms=[],n_sentences=0,title_terms=title_hit)
    best=max(hits,key=lambda h:len(set(h[1])))
    return dict(passed=True,role='PRIME_CANDIDATE' if title_hit else 'SUB_SCOPE',sentence=best[0],terms=sorted(set(best[1])),n_sentences=len(hits),title_terms=title_hit)
