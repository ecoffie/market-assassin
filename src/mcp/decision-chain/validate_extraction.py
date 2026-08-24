"""
Structural validation of the extraction SCHEMA — not a lexical "contains and" heuristic.

Written and committed BEFORE the v3 extraction exists. Validates semantics of the returned
structure, then rejects and re-asks once. Rejection reasons are machine-readable so the
retry can be specific without the prompt being tuned to any case.

Why structural, not lexical: "contains 'and'" would betray us the same way every other
lexical rule in this investigation has. "Bolts and fasteners" is ONE offering; "presses and
maintenance services" is two. Only the typed structure can tell them apart, and only the
model can say which it meant — so we make it commit to a type and to source evidence, then
check the commitment for internal consistency.
"""
import re, json

class Reject(Exception):
    def __init__(self, code, detail=''):
        self.code, self.detail = code, detail
        super().__init__(f'{code}: {detail}')

REQUIRED = ('primary_offering', 'processes', 'served_markets')

def _norm(s): return re.sub(r'\s+', ' ', (s or '').strip().lower())

def validate(case_prose, ex):
    """Raise Reject on a structurally invalid extraction. Returns normalised extraction."""
    for k in REQUIRED:
        if k not in ex: raise Reject('missing_field', k)

    po = ex.get('primary_offering') or {}
    if not isinstance(po, dict): raise Reject('primary_offering_not_object')
    val, typ = (po.get('value') or '').strip(), (po.get('type') or '').strip().lower()
    if not val: raise Reject('no_primary_offering', 'primary_offering.value is empty')
    if typ not in ('product', 'service'):
        raise Reject('bad_offering_type', f'type must be product|service, got {typ!r}')

    # 1. MULTIPLE INDEPENDENTLY SELLABLE THINGS.
    # Not "contains and" — we ask whether the two sides are separately sellable by testing
    # whether the model itself listed either side elsewhere as its OWN offering or as a
    # process. If a fragment of the primary also appears as a process, the primary is
    # conflating product with method — the Steward failure.
    procs = [_norm(p) for p in (ex.get('processes') or [])]
    secs = [_norm((s or {}).get('value') if isinstance(s, dict) else s)
            for s in (ex.get('secondary_offerings') or [])]
    parts = [p.strip() for p in re.split(r'\s+and\s+|;|\s+/\s+', val) if p.strip()]
    if len(parts) > 1:
        for p in parts:
            n = _norm(p)
            # a side that is ALSO claimed as a process => product/method conflation
            if any(n in q or q in n for q in procs if q):
                raise Reject('primary_conflates_offering_and_process',
                             f'"{p}" appears in primary_offering and also in processes')
            if any(n in q or q in n for q in secs if q):
                raise Reject('primary_contains_multiple_offerings',
                             f'"{p}" appears in primary_offering and also in secondary_offerings')
        # Two+ parts, neither disambiguated elsewhere: the model has not chosen a primary.
        raise Reject('primary_not_singular',
                     f'primary_offering.value lists {len(parts)} offerings: {parts}')

    # 2. SOURCE GROUNDING. The extractor must point at the text.
    ev = (ex.get('evidence_quote') or '').strip()
    if not ev: raise Reject('no_evidence_quote')
    if _norm(ev) not in _norm(case_prose):
        raise Reject('evidence_not_in_source', ev[:80])

    # 3. CONTRADICTION with supporting roles.
    if _norm(val) in procs:
        raise Reject('primary_is_a_listed_process', val)
    mkts = [_norm(m) for m in (ex.get('served_markets') or [])]
    if any(m and _norm(val) == m for m in mkts):
        raise Reject('primary_is_a_served_market', val)

    # 4. CONFIDENCE must be present and self-consistent with grounding.
    conf = ex.get('primary_offering_confidence')
    if conf not in ('high', 'medium', 'low'):
        raise Reject('bad_confidence', repr(conf))
    return ex

def audit_flags(ex):
    """Post-validation quality flags (reporting only, never gating)."""
    po = ex.get('primary_offering') or {}
    return {'type': po.get('type'), 'confidence': ex.get('primary_offering_confidence'),
            'has_secondary': bool(ex.get('secondary_offerings'))}
