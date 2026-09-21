# Changelog

Internal engineering log — correctness fixes, security, and ops work that don't
belong in `docs/MARKETING-FEATURE-LITERATURE.md` (which is for sellable, user-facing
features only). User-facing capabilities are documented there; this file tracks the
plumbing.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Newest first.

---

## 2026-06-18 — Market Research accuracy sweep + admin password rotation

A data-integrity pass over every filter on the Market Research dashboard (each was
"renders fine, returns the wrong number"), the fact-check harness built to prevent
recurrence, and a full rotation of the admin password.

### Security
- **Rotate admin password — strip hardcoded literal from 173 admin routes**
  (`79792563`). The password was a hardcoded fallback
  (`process.env.ADMIN_PASSWORD || '$ADMIN_PASSWORD'` + `!== 'literal'` variants)
  in 173 files, so changing the env var alone did NOT rotate it — the old literal kept
  working everywhere. Stripped the literal so routes honor ONLY
  `process.env.ADMIN_PASSWORD`; every transform fails CLOSED (unset env → denies). New
  value set in Vercel + `.env.local`. Verified live: new password accepted, old
  rejected across all admin endpoints + crons. Cross-checked govcon-funnels/shop/
  LinkedIn — funnels uses its own `PURCHASES_ADMIN_PASSWORD` (not rotated), others
  clean.
- **Scrub old password + dead domain from CLAUDE.md** (`0f3bb23d`) — doc examples used
  the literal + dead `tools.govcongiants.org`; now `$ADMIN_PASSWORD` + `getmindy.ai`.

### Fixed — Market Research dashboard (10 data bugs)
- **Dollar figures didn't reconcile** (`3e754a8e`) — "$97.2B" headline next to "$1.5B"
  FPDS, from 3 different time windows. Introduced one canonical `MARKET_SPEND_WINDOW`
  (FY2023–2025) across find-agencies + fpds-top-n + TMR; headline card now reads the
  authoritative `spending_by_category` department total (not summed sampled awards).
- **6-digit NAICS inflated the market** (`41562c43`) — `expandNAICSCodes` swept a
  6-digit code to its whole 3-digit subsector (541512 → all of 541xxx, ~7×). Now
  `expandFullCodes=false` on spend widgets: 6-digit stays exact, typed prefixes still
  expand. Caches busted.
- **Keyword FPDS searches queried ALL federal spend** (`ee6ebe95`) —
  `marketFilterToUsaspending` returns a merged filter but fpds-top-n discarded the
  return value, so the keyword constraint never applied ("drones" → $2.1T = whole
  budget). Now $0.38B. (find-agencies/TMR captured the return correctly — only fpds.)
- **Set-aside filters returned $0 for 4 of 7 types** (`57ffca33`) — dead codes
  (HUBZone `HZBZ`/`HUBZ`, Tribal `IND`, plain `SDVOSB`) + panel→map key mismatch
  (SDVOSB/VOSB only in veteranMap, looked up only in setAsideMap). Every code now
  verified against live USASpending; find-agencies checks both maps. See memory
  `usaspending_setaside_codes`.
- **State filter was decorative** (`695aaa63`) — the States selection was displayed
  but never sent to the spend query (only zipCode was). Wired `locationStates` panel →
  TMR → find-agencies → `place_of_performance_locations`; added to cache key + effect
  deps.
- **Explicit States auto-expanded to national** (`f7f5df28`) — find-agencies'
  progressive geographic expansion (state→region→national when <20 agencies) overrode
  the user's explicit choice. Now skipped when states are explicitly set.
- **LOI greeting broke when CO name unknown** (`1e7d7870`) — `salutationName` split the
  `[Contracting Officer name]` placeholder → "Dear Mr./Ms. name],". Now "Dear Sir or
  Madam,".

### Fixed — other panels (spot-check sweep)
- **4 panel bugs** (`c33489ca`): Source Feed search box never queried SAM (ran on a
  1000-row client window) → now sends `q`+`keywordOnly`; Recompetes task-order NAICS
  truncated to 2-digit (`substring(0,2)`, 541512→54) → now exact; Forecasts State +
  Set-Aside filters had no UI → added; Recompetes Competition filter + location badge
  were backed by empty static data → hidden / replaced with real stats.
- **Forecasts filters bypassed by DoD injection** (`e3d96266`) — state/set-aside
  filters narrowed `agency_forecasts` but the DoD early-signal injection ignored them
  (state=ZZ returned 60 unfiltered signals). Now skips the injection when state/
  set-aside is set. Caught by the harness's bogus-value assertion.
- **Grants agency filter did nothing** (`68402945`) — sent `agency` but Grants.gov
  needs sub-codes (DOD/HHS top-level → 0 despite the facet listing them). Now fetches
  broadly and filters by `agencyCode` prefix (results carry "DOD-AMRAA"). Applied to
  `/api/grants` + the briefings grants pipeline.

### Fixed — ops / infrastructure
- **Pre-deploy gate targeted the dead legacy domain** (`40665a6c`) —
  `test-pre-deploy.sh` pointed at `mi.govcongiants.com` (now 308→getmindy.ai) without
  `-L`, so all 5 endpoint checks falsely failed and the gate short-circuited before
  `verify:data`. Repointed to getmindy.ai + added `-L`. Gate now runs all stages green
  (schema + 14 pre-deploy + 20 data-truth).
- **Anthropic provider probe false-flagged "down"** (`77c343bd`) — health probe POSTed
  `/v1/messages` with a hardcoded model name; a drifted model ID → HTTP 400, and
  `ping()` treated non-2xx as down. Now probes `GET /v1/models` (no model/body to get
  wrong) and `ping()` treats 400 as reachable. All 6 providers green.

### Added — fact-check harness (regression defense)
- **Data-truth harness** (`68402945`, `e3d96266`) — `scripts/verify-data-truth.ts`
  (`npm run verify:data`), wired into `predeploy`. Re-derives each dashboard number
  from live USASpending/Grants on every deploy and asserts: golden numbers (our API vs
  raw upstream), filter sensitivity (changing a filter must change the result), and
  set-aside code validity (every code returns real spend). Covers public + auth-gated
  routes (Forecasts via admin password; Source Feed via a locally-minted MI session
  token). 20 assertions, fails the build on any regression. Caught the Grants and
  Forecasts bugs above on its first runs. See memory `data_truth_harness`.

### Notes
- The old admin password still exists in git history; it's now worthless (no longer
  authenticates). Rotation neutralized the exposure without history surgery.
- `/daily-ops` skill + URLs moved to getmindy.ai and version-controlled in the
  `claude-config` repo (separate from this repo).
