# C2: direct / related-market / other result groups (Agent 3, 2026-11-14)

**Status:** slice 1 (library) + slice 2 (Ask Mindy / MCP `find_opportunities` output, approved by Eric 2026-11-14) on `feat/agent3-c2-evidence-groups`; not merged. Map: design only (section 7). Alerts: measurement only (section 8). Approved
direction (Eric, 2026-11-14): classify Open results into three groups with the existing evidence rules, keep the
invariant `direct + related + other = Ask Mindy's total`, never present related-market notices as confirmed direct
matches, do not change shared retrieval or official NAICS/PSC classifications, separate PR, release-controlled.

## 1. The groups come from Agent 1's released classifier, not a new one

| Group | `labelOpenRow(...).cls` (find-opportunities.ts, unmodified) |
|---|---|
| direct | `DIRECT_MATCH` (buy-side code or visible buy-side text establishes the work) |
| related | `RELATED_MARKET_CANDIDATE` (related-family code, or only the buyer's name carries the words) |
| other | `WEAK_NON_MARKET`, including rows recalled only by a company's registered code |

One function maps class → group; every surface calls it. No SQL re-implementation (Agent 1, C2 review condition 4:
two classifiers drift, the #245 failure).

## 2. Compatibility findings (measured on main at c344af64b)

**F1. Ask Mindy's evidence counts are not totals today.** `find_opportunities` classifies only its candidate window
(`OPEN_FETCH_CAP` = 500 rows, ordered by deadline) and reports `evidence_counts` for DIRECT and RELATED only; "other"
is never counted. `matched_count` is the exact full count. For any search with more than 500 matches, or with any
"other" rows, `DIRECT + RELATED != matched_count` in today's output (example, the chat search tested 2026-11-14 on main: `matched_count` 1,279 but
`evidence_counts` DIRECT 269 + RELATED 38 = 307, i.e. the 500-row window minus its "other" rows). So the invariant can only hold if the three groups are counted over the FULL
matched set, on every surface, from the same function. Making Ask Mindy report full-population group totals is a
change to Agent 1's tool output and needs Agent 1's sign-off; this plan proposes it as an ADDITIVE field
(`evidence_totals`), leaving `evidence_counts` untouched.

**F2. "Other" absorbs statement-of-work-only matches.** The labeller judges visible text (title, description); a
notice the search admitted only through its statement of work is `WEAK_NON_MARKET` (Agent 1's rule: evidence not shown
is not evidence). A surface that counts only direct matches will therefore count fewer notices than it retrieves, by
design. The groups must always be shown together so nothing reads as dropped.

**F3. Cost of full counts.** Labelling is cheap (2–41 ms per search); fetching the fields it needs is not:
1.2–2.8 s and 0.5–8.8 MB for searches of 151–1,224 matches (janitorial services 151, security guard services 370,
cyber/cloud list 740, construction 1,224). A whole-market result (~9,200 notices) would be ~60 MB per request. So full
totals are computed only when `matched_count <= 3,000`; above that the breakdown is reported as UNAVAILABLE (null with a
reason, never 0 and never a window sample presented as a total).

**F4. Alerts: counting only direct matches changes delivery.** Today's alerts run the legacy evaluator (no labeller).
The canonical evaluator (#2043) stays OFF. When it is on, gating "new matches" on direct-only would stop emails for
watches whose new rows are all related/other. Measured for the one alerting watch on the janitorial preset
(`0e41b9aa`): 3 direct of 19, still emails. This slice does NOT change alert sending; the email can show the groups
later, and direct-only gating needs Eric's explicit OK with a per-watch measurement.

**F5. Scope.** Open horizon only. Coming back has its own classes (`HOLDER_SIGNAL`, `classifyComingBackEvidence`);
Coming soon has none. They keep their current behaviour.

**F7. The Map and Ask Mindy count different units.** The Map's headline (`totalForFilters`) counts UNIQUE LISTINGS
(rows deduplicated by solicitation, `countDistinctListings`) and `marketTotalForFilters` adds unmapped ROWS; Ask Mindy's
`matched_count` counts notice ROWS. The invariant is therefore defined per surface in that surface's own unit. This
slice counts notice rows (Ask Mindy's unit). Putting groups on the Map's listing headline needs a listing-level rule
(proposed: a listing takes its best row's group, direct > related > other) and Eric's call on which number the Map
shows.

**F8. Full-set totals are too slow for the Map request path.** Live on the Map plan (17 searches, invariant held on
all 17): 1.5–15 s per search (janitorial list 9.7 s, construction list 14.7 s, bakery 12.1 s). Several of these
searches already run 8–9 s on production and intermittently hit Postgres statement timeouts (pre-existing, measured on
the previous deployment too). So no surface is wired in this slice; Map wiring needs a cached or precomputed result
(per plan hash, short TTL) first. Agent 4 reached the same constraint for its vector lane.

**F6. Map UI.** The Map's client code is out of scope for this slice. The API gains additive fields behind the flag;
wiring them into the Map UI is a separate, reviewable change.

## 3. Release controls

`OPEN_EVIDENCE_GROUPS` env flag, same contract as the other canonical flags (only the literal `'true'` turns it on).
OFF = API responses byte-identical to today (tested, including `find_opportunities`: slice 2's two fields are absent
while the flag is off; `find-evidence-totals.unit.test.ts`). No migration, no data write, no alert change.

## 4. Implementation slices

1. **This PR (slice 1):** `src/lib/opportunities/evidence-groups.ts`
   - `evidenceGroupOf(cls)`; `groupOpenRows(rows, plan, cap, anchor)` (wraps `labelOpenRow`);
   - `openEvidenceTotals(client, req)` → `{ direct, related, other, total, complete, reason }`: pages the full matched
     set (light columns), refuses above 3,000 (`complete: false`, groups null), and asserts
     `direct + related + other === total` (a mismatch returns null groups, never a wrong sum);
   - NOT wired into the Map API in this slice (F8); a test asserts the Map route does not import the module.
   - Tests: mapping, invariant, null-not-zero above the cap / on failure, flag contract, labels identical to
     `labelOpenRow` for the same rows. `scripts/verify-evidence-groups.ts` is the live invariant check.
2. **Slice 2 (needs Agent 1):** `find_opportunities` adds `open_now.evidence_totals` from the same function, so
   Ask Mindy, MCP and the Map report identical group totals for the same plan.
3. **Slice 3 (needs Eric):** Map UI shows "N direct matches · M related-market · K other", never a bare direct count;
   a search with 0 direct and N related reads "0 direct matches · N related-market notices".
4. **Slice 4 (needs Eric, after #2043 is approved):** alert emails show the groups; direct-only sending only with
   explicit approval and a per-watch impact table.

## 5. Phrase handling

Not started (Eric, 2026-11-14). Agent 4 is investigating Data Core's semantic search, statement-of-work intelligence
and hidden-opportunity recovery; any new matching proposal is coordinated with Agent 4 first. C2 proposes none.

## 6. Agent 1 review of slice 1 (2026-11-14): no objection; conditions for slice 2

1. Additive `open_now.evidence_totals` in `find_opportunities` is acceptable, with: `evidence_counts` unchanged; a new
   `evidence_counts_scope` field disclosing that those counts are window-scoped (500 rows, deadline order, DIRECT and
   RELATED only), closing today's "window read as population" gap; `evidence_totals` null + reason when not computed,
   never 0; `complete: true` only when every row was classified. It changes a public MCP tool's output, so it needs
   Eric's approval and an MCP-CHANGELOG entry (credits unchanged). Ask Mindy's renderer does not show it unless wired.
2. `find_opportunities` should call `evidenceCapability` (one derivation), keeping the pinning test.
3. Cost: never add the full-set read to every call. (a) If `matched_count` <= the 500-row window, the window IS the full
   set: exact totals from rows already fetched, no extra cost. (b) Above it, `evidence_totals: null`, reason
   `not_computed_over_window`. (c) Background totals cached per plan version and query only if Eric wants them for big
   searches. The 3,000 cap applies to Map/alert surfaces, not MCP.
4. Every count names its unit (listings on the Map; rows in MCP and Ask Mindy).

Slice 2 therefore costs nothing on the request path and needs Eric's approval of the tool-output change.
