"""
Structural validation of the extraction schema — v2, conjunction parsing REMOVED.

Run 5 was voided because the previous version inferred semantic multiplicity from surface
punctuation (re.split on "and"/";"/"/"). That is the same category of mistake the resolver
itself had been making, relocated into the guardrail.

This version checks ONLY what the schema can prove. Multiplicity is expressed by the
extractor in the STRUCTURE — a typed offerings[] list with exactly one is_primary — so
"offset and digital printing presses" stays ONE offering if the model emits it as one, and
ammunition + fuzing can be one family or two linked offerings without any regex guessing.

Deliberately NOT implemented: any rule attempting to detect whether two offerings are
"really" one family. The extractor owns that semantic decision; the evidence span makes it
auditable.
"""
import re, json

class Reject(Exception):
    def __init__(self, code, detail=''):
        self.code, self.detail = code, detail
        super().__init__(f'{code}: {detail}')

CONF = ('high', 'medium', 'low')

def _norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())

def validate(case_prose, ex):
    """Raise Reject on a structurally invalid extraction. No lexical parsing of values."""
    offs = ex.get('offerings')
    if not isinstance(offs, list) or not offs:
        raise Reject('no_offerings', 'offerings[] missing or empty')

    prim = [o for o in offs if isinstance(o, dict) and o.get('is_primary') is True]
    if len(prim) == 0: raise Reject('no_primary_offering', 'no offering has is_primary=true')
    if len(prim) > 1:
        raise Reject('multiple_primary_offerings', f'{len(prim)} offerings flagged is_primary')

    src = _norm(case_prose)
    for o in offs:
        if not isinstance(o, dict): raise Reject('offering_not_object', repr(o)[:60])
        if not (o.get('value') or '').strip(): raise Reject('offering_missing_value')
        t = (o.get('type') or '').strip().lower()
        if t not in ('product', 'service'):
            raise Reject('bad_offering_type', f'{o.get("value")!r} type={t!r}')
        # Source grounding — every offering, not just the primary.
        ev = (o.get('evidence_span') or '').strip()
        if not ev: raise Reject('no_evidence_span', str(o.get('value'))[:50])
        if _norm(ev) not in src:
            raise Reject('evidence_not_in_source', f'{str(o.get("value"))[:30]} :: {ev[:60]}')
        c = (o.get('confidence') or '').strip().lower()
        if c not in CONF: raise Reject('bad_confidence', f'{o.get("value")!r} confidence={c!r}')

    # Supporting roles must not silently substitute for an offering: if the extractor put
    # NOTHING in offerings but populated processes, that is a missing offering, not a valid
    # extraction. (offerings[] non-empty is already enforced above; this catches the
    # degenerate case where the only offering is a verbatim copy of a served market.)
    mkts = {_norm(m) for m in (ex.get('served_markets') or []) if m}
    p = prim[0]
    if _norm(p.get('value')) in mkts:
        raise Reject('primary_is_a_served_market', str(p.get('value'))[:50])

    return ex

def primary(ex):
    for o in ex.get('offerings') or []:
        if o.get('is_primary') is True: return o
    return None

def secondaries(ex):
    return [o for o in (ex.get('offerings') or []) if not o.get('is_primary')]
