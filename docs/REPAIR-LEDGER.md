# Repair Ledger — the running tally of fixes (audit against reverts)

**Why this exists (Eric, 2026-07-27):** "Earlier I saw Draw was fixed, now it's messed up
again. What would help is a ledger of repairs — a running tally we can audit to make sure
nothing reverted." Concurrent Claude sessions share one checkout and switch branches under
each other; a fix can silently disappear, or a **stale preview** can *look* like a revert when
the code is actually fine. This ledger is the source of truth for "is fix X still in?"

## How to use it

- **Every non-trivial fix/feature gets ONE row here, in the same commit as the fix.** No row =
  not shipped, same rule as slash commands in CLAUDE.md.
- Each row carries a **PROOF anchor**: an exact string that must be present (`grep`-able) in a
  named file. That's what makes the ledger *auditable* rather than a memory.
- **To audit** (catch reverts): run `npm run ledger:audit` (or `node scripts/audit-repair-ledger.mjs`).
  It re-greps every proof anchor against `main` (or the current tree) and reports any that
  VANISHED — those are real reverts. A green audit means every recorded fix is still present.
- **A stale/old PREVIEW is not a revert.** Before filing "X reverted", confirm the preview URL
  is built from a commit that *contains* the fix — the audit checks the CODE, not a screenshot.
- Newest at the top. Never delete a row; if a fix is intentionally rolled back, add a new row
  documenting the rollback and set the old row's Status to `SUPERSEDED by <date>`.

## Columns

`Date` · `Area` · `Fix` · `Proof anchor` (string → file) · `Verified` (how proven) · `Status`

---

## Opportunity Map

| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-07-27 | Map · Draw button | Draw button is **plain text "Draw", no icon** (copy Zillow) — no pen-nib SVG | `'<button class="mpill" id="drawBtn">Draw</button>'` → `src/app/opportunity-map/route.ts` | grep in main + branch; both plain text | ✅ LIVE (main) |
| 2026-07-27 | Map · Draw button | Draw button positioned **top-right** of the map (was lost to bottom during a refactor) | `id="drawBtn"` rendered in the top-right map-control group | screenshot 08-18 shows top-right | ✅ LIVE (main) |
| 2026-07-27 | Map · Top bar | Set-aside top-bar pill **replaced by Agency pill**; set-aside moved into Filters | `id="agencyBtn"` present; no top-bar `saselBtn` in the bar | filter-parity tests; PR #511 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Top bar | Notice-type top-bar select **replaced by Value pill** (range + histogram + 2-knob slider, $2M cap) | `id="valPanel"` → `src/app/opportunity-map/route.ts` | PR #505/#507/#509/#510 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Header | Data-source badge **removed from sidebar header** → drawer Overview only | no data-source badge in the sidebar header block | verified on prod | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters (Awarded) | **SAP-friendly / recompete-likelihood / expiring-within** filters added, recompete-only (no dead controls); no "low" likelihood (0 rows) | `contract_type', ['PURCHASE ORDER', 'BPA CALL']` → `src/app/api/app/recompete-map/route.ts` | 84/84 map tests; **HTTP verified live** — baseline 125,986 → friendly 34,290 / gated 72,098 / high 39,595 / ≤6mo 77,494 / combined 3,446 (all narrow, none zero) | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters (Open) | **SAP-friendly BUYER** filter — 3 honest PO-share tiers (most/somewhat/vehicle) on the buying agency; Open-only (no contract_type on opps); ~1% agencies unclassified, never force-bucketed | `SAM_DEPARTMENT_TIERS` → `src/lib/opportunities/sap-friendly-agencies.ts` | 35 lib+parity tests; **HTTP verified live** — active baseline 9,945 → most 2,050 (21%) / somewhat 7,578 (76%) / vehicle 190 (2%), all narrow, none zero | ✅ LIVE (main) |
| 2026-07-27 | Map · Recompete pins | Task-order **city precision** honored (`map_loc_source==='task_order_city'` → precision:'city') so ~99.6K recovered cities aren't invisible | `map_loc_source === 'task_order_city'` → `src/app/api/app/recompete-map/route.ts` | #506 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Industry pill | Industry dropdown is the human-first primary selector; NAICS/PSC live in Filters | `__INDUSTRY_PRESETS` build + `id="naicsBtn"` | verified live | ✅ LIVE (main) |

## Guardrails / gates (meta-repairs)

| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-07-27 | Client-JS gate | `check-drawer-js.mjs` cooks each map `<script>` template + `new Function()`-parses it (tsc can't see syntax errors inside template literals) | `scripts/check-drawer-js.mjs` exists; pre-push step 1b | runs green this session | ✅ LIVE |

---

*Seeded 2026-07-27. Add a row in the SAME commit as every fix. Audit with `npm run ledger:audit`.*
