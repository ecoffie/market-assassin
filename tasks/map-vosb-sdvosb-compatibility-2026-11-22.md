# Map set-aside: splitting VOSB out of SDVOSB: compatibility assessment (2026-11-22)

Status: **assessment only. No code change yet.** Requested by Eric via Agent 4 before any PR: "never silently change what an existing saved search or alert returns."

## Finding
`src/lib/opportunities/map-data.ts` `SET_GROUPS` puts the veteran-owned codes `VSA`/`VSB` into the map's **SDVOSB** group: `['SDVOSBC','SDVOSBS','VSA','VSB','SDVOSB']`. Every other classifier in the repo treats VSA/VSS/VSB as **VOSB**, a wider group:
- `search/query-intent.ts:145`
- `chat/tier1-tools.ts:197-198`
- `alerts/saved-search-email.ts:65`
- `briefings/pipelines/sam-gov.ts:250`
- `scripts/enrich-recompete-setaside.ts`

This is verified against the repo, not against live data (no DB/USASpending access from the cloud session).

## Verdict
**No data migration is needed, provided the stored key `'SDVOSB'` keeps exactly today's meaning.** Saved searches and URLs store the bare group key, with no record of when it was saved. So `'SDVOSB'` cannot be narrowed in place. A separate SDVOSB-only choice needs a **new key**.

## Where set-aside keys are persisted
- `saved_searches.filters` (JSONB; migration `20260725_saved_searches.sql`) holds `setAside` / `setAsideMulti` as raw group keys. Anonymous watches (`src/lib/map-watch/anon-watch.ts`) write to the same table.
- The map's last-search entry in browser localStorage holds the same keys.
- URL: `?setAside=SDVOSB`.
- Free-text alerts and query-intent (`setAsideOrExpr`) do not use `SET_GROUPS`.

## Consumers: before / after / preservation
| Consumer | Before | Naive split | Preservation |
|---|---|---|---|
| `applyMapFilters` (`map-filters.ts:261`): map Open, Maps Open discovery, saved-search alert cron, search-delivery-status, market dashboard, watchlist, buying-agencies, CAI | `SDVOSB` → `SDVOSBC,SDVOSBS,VSA,VSB,SDVOSB` | VSA/VSB rows silently drop out | Freeze the legacy `SDVOSB` code list. New keys: `SDVOSB_ONLY` (SDVOSBC, SDVOSBS, SDVOSB) and `VOSB` (VSA, VSS, VSB) |
| Map client (`opportunity-map/route.ts`): checkboxes, saved-search restore (~5579), deep link (~10148), localStorage | one SDVOSB box | controls and results disagree | Restore legacy `SDVOSB` as both boxes checked; keep the raw token until the user changes a set-aside box |
| Pin bucket: `mapSetAside`, `KIND_TO_GROUP.vosb`, `SET_COLOR`, `SET_LABEL`, client `SETMAP`, `SET_TO_EVC`, `SETGROUPS` | VSA pin = green "SDVOSB" | a VOSB pin falls to "None" and reads as unrestricted | Add VOSB to all three client maps; `KIND_TO_GROUP.vosb` → `'VOSB'` |
| `opportunity-detail/route.ts:46,409` (label fallback) | VSA labelled "SDVOSB" | "VOSB" | display only |
| `sow-card-facts.ts:290` (`TEXT_LABEL_TO_GROUP`) | consistent | false mismatch (VSA code vs "VOSB" text) | map VOSB → `'VOSB'` |
| `genome.ts` (sync cron → `opportunity_dna`) | strand label "SDVOSB Set-Aside" | new syncs: "Veteran-Owned Set-Aside" | label only; the key `set_aside` and the strategy filter are unchanged; old rows keep the old label until recomputed |
| `contacts-map/route.ts:547` (own BigQuery buckets) | `SDVOSB` = SDVOSB text | new keys match no bucket → 0 firms | translate `SDVOSB_ONLY` → `SDVOSB`; `VOSB` → notApplicable or a new bucket |
| Recompete map (`maps-recompete-discovery.ts:143`, exact `set_aside_type = key`; frozen path) | literal `'SDVOSB'` | new keys match nothing | translate `SDVOSB_ONLY` → `'SDVOSB'`, `VOSB` → `'VOSB'` (whether recompetes store `'VOSB'` is inferred, not measured) |
| Forecast map / saved-search Forecast | ignores setAside / presence only | — | no change |
| Market report (`market-report.ts:113`, own USASpending map) | `SDVOSB` → SDVOSBC, SDVOSBS (already excludes VOSB) | new keys dropped silently | add `SDVOSB_ONLY` and `VOSB` → [VSA, VSS] |

## Defects that exist today (each changes current results, so each needs its own disclosed PR)
1. **Alerts ignore set-asides chosen in the map's Filters panel.** The alert cron and search-delivery-status read only `setAside`, never `setAsideMulti`, which is what the Filters panel writes (`opportunity-map/route.ts:4798`). A customer who saved "SDVOSB only" from the panel gets unfiltered alerts.
2. **Plain-English search appends lowercase keys** (`'sdvosb'` / `'vosb'`; route.ts 1979, 10775). `SET_GROUPS.find` is case-sensitive, so these fall through as raw codes that likely match nothing (inferred).
3. **VSS is in no code list.** VSS pins render as SDVOSB (via `classifySetAside`), but the SDVOSB filter excludes them.
4. **Multi-value set-aside on Recompete and the market report** is matched as one literal string (`SDVOSB,SB`).

## Minimal PR (if approved)
- **`map-data.ts`:**
  - the legacy `SDVOSB` group keeps its exact codes and is hidden from the checkboxes;
  - add `SDVOSB_ONLY` and `VOSB`;
  - add `LEGACY_SET_ALIASES = { SDVOSB: ['SDVOSB_ONLY','VOSB'] }`;
  - pin bucket: VSA/VSS/VSB → VOSB.
- **Other files:**
  - `opportunity-map/route.ts`: checkboxes, restore logic, client maps;
  - translations in `maps-recompete-discovery.ts` (frozen path, needs approval), `contacts-map/route.ts` and `market-report.ts`;
  - `sow-card-facts.ts` and `KIND_TO_GROUP`.
- **New tests:**
  - legacy `SDVOSB` (setAside, setAsideMulti, URL, stored filters) yields the identical `.in()` list to main;
  - `VOSB` yields VSA/VSS/VSB, and `SDVOSB_ONLY` excludes VSA;
  - one test per translation.
- **Tests to update / re-run:**
  - update `set-aside-truth.unit.test.ts` and `sow-card-facts.unit.test.ts`;
  - re-run `maps-recompete-discovery`, `anon-watch`, filters-pill-toggles, filters-badge-count, `genome`, full-open-filter, state-multiselect and the cross-surface-plan gate.
- **Map-contract gate** (`.claude/commands/verify-map-contract.md` → `.cursor/skills/map-contract-verify/SKILL.md`):
  - the `src/app/opportunity-map/*.unit.test.ts` invariants;
  - `scripts/verify-filter-contract.mjs` (add an SDVOSB-legacy / SDVOSB_ONLY / VOSB case);
  - authenticated, anonymous and mobile journeys (need a signed-in browser, so not possible from the cloud session);
  - `scripts/truth-canary.mjs`, `npm run verify:oracles`, `scripts/audit-rank-then-filter.mjs`, `npm run verify:ma-skills`.

## Not verified (needs read-only DB access: Claude Local)
- Row counts for VSA / VSS / VSB in `sam_opportunities`.
- How many `saved_searches` store `SDVOSB` in `setAside` vs `setAsideMulti`.
- Whether `recompete_opportunities.set_aside_type` stores `'VOSB'`.
- Whether `opportunity_dna` labels are read from the DB at render time.
