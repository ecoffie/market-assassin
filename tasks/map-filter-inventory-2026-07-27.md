# Opportunity Map — filter/sort inventory (GROUNDED, per-dataset) — 2026-07-27

**Eric:** "we have so many options we can add like SAP-friendly, spending increase — MA has many ways
that sorted/filtered data already proven. Maybe it applies to gov buyers or contracts and not active,
which is why we should inventory everything."

**The rule:** every filter/sort MUST map to a REAL, populated column (no dead controls). A signal that's
perfect on one dataset is dead on another — so this is measured PER DATASET.

## Column population — MEASURED (500-row sample each, 2026-07-27)

### OPEN (sam_opportunities)
| Column | Filled | Filter/sort viable? |
|---|---|---|
| set_aside_code | 100% | ✅ (already in Filters) |
| notice_type | 100% | ✅ (already) |
| pop_state | 100% | ✅ (already) |
| psc_code | 98% | ✅ (already) |
| response_deadline / posted_date | 100% | ✅ (already: Closing/Posted) |
| has_sow_doc | 89% | ✅ (already: "with documents") |
| points_of_contact | 100% | ✅ (already: "with a contact") |
| **intel_value_range (M-Estimate)** | **4%** | ⚠️ WEAK — Value pill works but 96% have no estimate; a value filter starves |
| attachments | 23% | already folded into has-docs |

### AWARDED / RECOMPETE (recompete_opportunities) — the richest untapped dataset
| Column | Filled | Filter/sort viable? |
|---|---|---|
| **contract_type** | **99%** | ✅✅ **THE SAP-FRIENDLY SIGNAL** — PURCHASE ORDER 25,860 / DELIVERY ORDER 77,586 / DEFINITIVE 20,821 / BPA CALL 9,936. Filter "🟢 SAP-friendly (purchase orders)" vs "🔒 vehicle-gated (delivery orders)". NOT YET a filter — only a drawer badge. HIGH VALUE. |
| **potential_total_value** | **100%** | ✅ Value range filter (already server-honored) + sort by $ |
| **recompete_likelihood** | **100%** | ✅ NEW — filter/sort by likelihood (high/medium/low). Proven field, unused as a filter. |
| **lead_time_months** | **100%** | ✅ NEW — "expiring within N months" (the recompete window) as a real filter/sort |
| awarding_agency / sub_agency | 100/99% | ✅ (agency pill + Filters) |
| naics_code | 100% | ✅ (Industry + Filters) |
| place_of_performance_state | 100% | ✅ (already, #502) |
| incumbent_uei | 99% | ✅ (enables task-order lookups) |
| **set_aside_type** | **0%** | ❌ DEAD on Awarded (USASpending feed omits it) — HIDE the set-aside filter here |
| **psc_code** | **0%** | ❌ DEAD on Awarded — already hidden (#502) |

### AGENCY-LEVEL signals (apply to a buyer/agency, not a single opp — filter by the opp's agency)
| Signal | Source (proven) | Viable? |
|---|---|---|
| **SAP-friendly buyer** (agency's PO share) | `computeBuyerBehavior()` (buyer-behavior.ts) — LIVE on drawers | ✅ Compute per agency, filter opps whose buying agency is SB-friendly. GOS #11 as a FILTER. |
| **Spending increase / trending-up agency** | `budget-authority.ts` `getBudgetForAgency()`+`classifyAgencyTrend()`+winners/losers by %Δ | ✅ Real (47 toptier agencies, FY change %). Filter/flag opps at agencies whose budget is UP. Heavier (join agency trend); coverage = toptier only. |

### COMPANIES (BigQuery searchRecipients) — sort-rich already
- Already: sort by $ won, award count, set-aside firms first (COMPANY_SORT_OPTIONS).
- NEW viable: none measured yet beyond these; searchRecipients is quota-sensitive.

### GOV BUYERS (federal_contacts)
- department_ind_agency 100% (agency filter ✅). No $ / set-aside on a contact row → most value filters N/A.
- Agency-level SAP-friendly / spending-trend COULD annotate a buyer (their agency's behavior).

## RANKED recommendation (highest value, already-proven, real column)
1. **SAP-friendly filter on AWARDED** (contract_type, 99% filled) — 🟢 SAP-friendly / 🔒 vehicle-gated toggle. Turns the proven drawer signal into a filter. #1.
2. **Recompete likelihood + lead-time filters on AWARDED** (both 100%) — proven fields, currently unused as filters.
3. **SAP-friendly buyer filter on OPEN** — via computeBuyerBehavior on the opp's agency (agency-level).
4. **Spending-increase flag/filter** — budget-authority trend, toptier agencies (heavier; do after 1-3).
5. **New SORTs**: Awarded "most likely recompete", "expiring soonest", "highest value"; these are low-risk.

## DEAD controls to AVOID (measured 0% — would be dead)
- Set-aside filter on Awarded (set_aside_type 0%).
- PSC filter on Awarded (already hidden).
- A hard value filter on OPEN as PRIMARY (intel_value_range only 4%) — keep it, but it starves.

## Next
Eric picks from the ranked list; build only measured-viable filters, each hidden on datasets where its
column is dead (extend the existing `disabledIdsFor` / `mfv-<mode>` visibility system). No dead controls.
