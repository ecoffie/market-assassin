"""
Stage 2 — role-aware classification. Stage 1 (taxonomy_resolver) is UNCHANGED and reused.

    prose -> role extraction -> taxonomy candidates -> role-aware ranking -> abstention

The single change from Run 2: candidates are generated from the CORE PRODUCT/SERVICE role
only. Process, equipment, served-market, inputs and past-performance are retained as
supporting context and are NOT allowed to vote on the industry.

No threshold, weight or confidence rule from taxonomy_resolver.py is altered — this file
calls it with different INPUT TEXT. That is the whole intervention, and it is deliberate:
if role separation is the missing ingredient, changing only the input should show it.
"""
import sys, json
sys.path.insert(0, 'src/mcp/decision-chain')
from taxonomy_resolver import candidates as taxonomy_candidates, resolve as flat_resolve

def resolve_role_aware(roles, spend=None, topk=8):
    """roles: the stage-2 extraction dict for one company."""
    core = (roles.get('core_product_service') or '').strip()
    if not core:
        # Degradation rule (ROLE-AWARE-DESIGN.md): never silently fall back to flat
        # matching — that is the behaviour Run 2 falsified.
        return {"selected": None, "reason": "no_core_product_service_extracted", "candidates": []}

    # Rank on the core role alone.
    cands = taxonomy_candidates(core)[:topk]
    if not cands:
        return {"selected": None, "reason": "no_taxonomy_match_on_core", "candidates": [], "core": core}

    # Supporting roles may DISAMBIGUATE between candidates already in the set, but can never
    # introduce one. A tie broken by served market is legitimate; a served market that
    # invents a candidate is the served-market confusion we are trying to remove.
    support = ' '.join(
        (roles.get(k) if isinstance(roles.get(k), str) else ' '.join(roles.get(k) or []))
        for k in ('production_process', 'equipment_capability', 'inputs_materials')
    ).strip()
    if support:
        sup = {c['code']: c['taxonomy_score'] for c in taxonomy_candidates(support)}
        for c in cands:
            # Small corroboration bonus, capped so support can reorder near-ties but never
            # overturn a clear core signal.
            c['support_score'] = sup.get(c['code'], 0.0)
            c['final_score'] = c['taxonomy_score'] * (1.0 + min(c['support_score'], 5.0) / 50.0)
    else:
        for c in cands:
            c['support_score'] = 0.0
            c['final_score'] = c['taxonomy_score']
    cands.sort(key=lambda c: -c['final_score'])

    top = cands[0]
    second = cands[1]['final_score'] if len(cands) > 1 else 0.0
    # Same confidence rule as stage 1 — deliberately unchanged.
    from taxonomy_resolver import MIN_SCORE, MIN_MARGIN
    confident = top['final_score'] >= MIN_SCORE and (second == 0 or top['final_score'] / second >= MIN_MARGIN)
    for c in cands:
        c['award_evidence'] = (spend or {}).get(c['code'])
    return {"selected": top['code'] if confident else None,
            "reason": None if confident else ("weak_evidence" if top['final_score'] < MIN_SCORE else "ambiguous_tie"),
            "confidence": round(top['final_score'], 2),
            "margin": round(top['final_score'] / second, 2) if second else None,
            "core": core, "candidates": cands}


# ---------------------------------------------------------------------------------------
# Two-dimensional confidence: EXTRACTION confidence x TAXONOMY-MATCH confidence.
#
# Added because Run 4 showed a clean-looking primary offering extracted from genuinely
# ambiguous prose (Douglasway) producing a high taxonomy score and a confident wrong answer
# (622110 General Medical Hospitals). Taxonomy similarity alone does not represent
# end-to-end certainty.
#
# This is NOT a retune of MIN_SCORE/MIN_MARGIN — those are untouched. It is an ADDITIONAL
# gate: a low-confidence, weakly-grounded extraction cannot produce a confident answer no
# matter how cleanly its invented abstraction matches the taxonomy.
# ---------------------------------------------------------------------------------------
def resolve_v3(ex, spend=None, topk=8):
    """ex: a VALIDATED typed extraction (validate_extraction.validate, offerings[] schema)."""
    from validate_extraction import primary as _primary, secondaries as _secondaries
    p = _primary(ex) or {}
    roles = {
        'core_product_service': p.get('value'),
        'production_process': ex.get('processes') or [],
        'equipment_capability': [],
        'inputs_materials': ex.get('inputs') or [],
    }
    out = resolve_role_aware(roles, spend=spend, topk=topk)

    # Secondary offerings are a fallback ONLY when the primary yields no candidate.
    if out.get('selected') is None:
        for s in _secondaries(ex):
            v = s.get('value')
            if not v: continue
            alt = resolve_role_aware({**roles, 'core_product_service': v}, spend=spend, topk=topk)
            if alt.get('selected'):
                alt['used_secondary'] = v
                out = alt
                break

    # Two-dimensional confidence: EXTRACTION x TAXONOMY-MATCH. Unchanged from Run 5 —
    # MIN_SCORE / MIN_MARGIN are still untouched. A 'low'-confidence primary means the prose
    # never said what is delivered, so no taxonomy score can make the answer safe.
    ec = (p.get('confidence') or 'low').lower()
    out['extraction_confidence'] = ec
    if ec == 'low' and out.get('selected') is not None:
        out['selected'] = None
        out['reason'] = 'low_extraction_confidence'
    return out
