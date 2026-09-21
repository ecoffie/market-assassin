"""
Extractor-quality audit — scored INDEPENDENTLY of the NAICS outcome.

Written BEFORE the v2 extraction was inspected, so the tests cannot be shaped by what the
extractor happened to produce. Judges the extraction by string inspection only; it never
looks at a resolver result or an expected code. That is the point: it separates a stage-2
extraction failure from a stage-1 matching failure without inferring either from the answer.

Four flags per ROLE-CONTRACT-FROZEN.md.
"""
import json, re, sys

# Vocabulary defined from the CONTRACT's exclusion list, not from observed failures.
PROCESS_TERMS = re.compile(r'\b('
    r'machining|milling|turning|welding|fabricat\w*|stamping|forming|plating|casting|forging|'
    r'assembly|assembling|cutting|grinding|hobbing|waterjet\w*|coating|stress reliev\w*|'
    r'manufacturing process|deep draw|progressive die|extrusion|molding|'
    r'integration|installation|procurement|sourcing|fulfillment|processing'
    r')\b', re.I)

MARKET_TERMS = re.compile(r'\b(?:for|to|serving|across)\s+(?:the\s+)?('
    r'automotive|aerospace|defense|federal|government|military|healthcare|commercial|'
    r'industrial|agencies|agency|customers|clients|markets?|industries|sector'
    r')\b', re.I)

# A service that is ANCILLARY to a product. Not a blanket "services are not products" rule —
# the contract explicitly allows a service to be the primary offering.
ANCILLARY_SERVICE = re.compile(r'\b('
    r'maintenance|repair|support services|managed services|technical support|help desk|'
    r'after-?sales|warranty|training services'
    r')\b', re.I)

COMPOUND = re.compile(r';|\s+/\s+|\band\s+(?:also\s+)?\b.*\b(?:services|products|equipment|parts|systems)\b', re.I)

def audit_case(cid, r):
    core = (r.get('core_primary') or '').strip()
    sec = r.get('core_secondary') or []
    svcs = r.get('services') or []
    flags = {}
    flags['served_market_leaked_into_core'] = bool(MARKET_TERMS.search(core))
    flags['process_leaked_into_core'] = bool(PROCESS_TERMS.search(core))
    # Ancillary service displaced product: core names a support service AND a product-looking
    # noun exists only in secondary/services.
    core_is_ancillary = bool(ANCILLARY_SERVICE.search(core))
    product_elsewhere = any(re.search(r'\b(equipment|machinery|press\w*|pump\w*|parts|components|ammunition|hardware|devices|presses)\b', s, re.I)
                            for s in list(sec) + list(svcs))
    flags['ancillary_service_displaced_product'] = core_is_ancillary and product_elsewhere
    flags['compound_core_unresolved'] = bool(COMPOUND.search(core))
    flags['_core'] = core
    flags['_defect_count'] = sum(1 for k, v in flags.items() if k.startswith(('served','process','ancillary','compound')) and v is True)
    return flags

def main(path):
    d = json.load(open(path))
    cases = d['cases'] if 'cases' in d else d
    rows = {cid: audit_case(cid, r) for cid, r in cases.items()}
    tot = {k: sum(1 for v in rows.values() if v.get(k) is True)
           for k in ('served_market_leaked_into_core','process_leaked_into_core',
                     'ancillary_service_displaced_product','compound_core_unresolved')}
    print(f"EXTRACTION AUDIT — {len(rows)} cases (independent of NAICS outcome)\n")
    for k, v in tot.items(): print(f"  {k:38} {v}")
    clean = sum(1 for v in rows.values() if v['_defect_count'] == 0)
    print(f"\n  clean extractions: {clean}/{len(rows)}")
    print("\n  cases with defects:")
    for cid, v in sorted(rows.items()):
        if v['_defect_count']:
            f = [k for k in ('served_market_leaked_into_core','process_leaked_into_core',
                             'ancillary_service_displaced_product','compound_core_unresolved') if v[k]]
            print(f"    {cid:5} {v['_core'][:58]:58} {f}")
    json.dump(rows, open('/tmp/extraction_audit.json','w'), indent=1)
    return rows

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'src/mcp/decision-chain/fixtures/role-extraction-v2.json')
