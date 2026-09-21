# Search Brain — common-language query resolver (Eric 2026-08-01)

## Value proposition (Eric's words)
"Everyone gives you the data, we give you the brain." Someone types **common language** —
"8a", "wosb", "women owned", "service disabled vet", "hubzone", OR capability terms like
"cyber, cloud, compliance, network, server" — and gets **the same right results across the
board** (Open / Recompete / Forecast), on the ONE merged Opportunities map.

## Vision artifact (Andre @ CypherIntel walkthrough)
https://claude.ai/code/artifact/86eee8f2-8e24-43c3-9043-0d429c7948bb
- Step 1 search bar: `cyber, cloud, compliance, network, server · Q4 FY26` → resolves to a
  MIXED set of Open (green) + Forecast (violet) + Recompete (amber) on one color-coded map.
  Forecast pins carry no "View sol" (not posted); open pins link to SAM.
- Confirms: multi-concept natural-language query, resolved uniformly across horizons. The
  "brain" is intent resolution, not dumb ILIKE.
- (Also validates the two-map split: Map 1 = the WORK (open+forecast+recompete), Map 2 = the
  PLAYERS (companies+buyers) — the "who's the incumbent / who to call" hop.)

## The resolver (building)
`src/lib/search/query-intent.ts` — classify raw query → intent, applied per-source:
- **set-aside term** (natural language synonyms: 8a/8(a)/eight-a, wosb/women-owned,
  edwosb, sdvosb/service-disabled-vet, vosb/veteran, hubzone, sdb, sb, isbee/buy-indian) →
  the RIGHT set-aside columns per source (SAM set_aside_code 8A/8AN + set_aside_description
  "8(A)…"; recompete/forecast set_aside_type "8(A)/8(A) COMPETITIVE"). DLA has none → honest N/A.
- **NAICS** (2-6 digits, comma-list) → naics filter (exact 6-digit / prefix).
- **PSC** (4-char alnum w/ a letter) → psc filter.
- **keyword** (free text, incl. MULTI-TERM "cyber, cloud, compliance") → OR ilike across
  title/description/naics_description/agency/incumbent per source.

## Per-source searchable columns (grounded 2026-08-01)
- SAM: title, description, naics_code(s), psc_code, set_aside_code, set_aside_description
- Recompete: incumbent_name, description, naics_code, naics_description, psc_code, psc_description, set_aside_type
- Forecast: title, description, naics_code, naics_description, psc_code, psc_description, set_aside_type
- DLA: nsn, fsc, description (no NAICS/PSC/set-aside — honest N/A for those intents)

## Same-spelling-different-source reality (why the brain is needed)
8(a): SAM code 8A/8AN, SAM desc "8(A) SOLE SOURCE"; recompete type "8(A)"; forecast
"8(A) SOLE SOURCE / 8(A) COMPETITIVE / 8A COMPETED". A dumb ilike matches inconsistently.

## Status
- Resolver lib written (setAside + naics + psc + keyword). NEXT: wire into all 3 horizon
  routes (opportunity-map SAM path, recompete-map, forecast-map) so one query = uniform
  results. Then verify a set of common-language queries returns consistent counts across.
