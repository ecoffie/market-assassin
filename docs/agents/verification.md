# Verification recipes

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## Verification Recipes — how to PROVE each surface works (rule #2)

The concrete "it works" evidence, centralized so skills/agents stop re-deriving it.
"It compiles" ≠ "it works." **A 200 with 0 rows is a FAIL, not a pass.**

Two scripts encode these rules — prefer them over hand-rolled `curl` / inline `createClient`
probes. They exit non-zero on failure, so an agent can't mistake a red run for a green one.

**Live surfaces** — `scripts/verify-live.mjs`:
```bash
npm run verify:live -- /api/recompete /forecasts        # status + row count + timing
npm run verify:live -- /api/<route> --min-rows 1        # 200 with 0 rows → FAIL
npm run verify:live -- /pricing --expect-text "$149" --no-rows
npm run verify:live -- /api/<route> --post --json       # POST + machine-readable out
```
Rows are found under `results`/`data`/`rows`/`items` or `_meta.grounded`. A 3xx to login on a
gated page = OK, but note it. Default host is `https://getmindy.ai` (`--host` to override).

**Database** — `scripts/db.mjs` (read-only):
```bash
npm run db -- <table> --count                            # how many rows
npm run db -- <table> --eq owner_email=x@y.com --limit 5
npm run db:check -- <table> <column>                     # did the migration REALLY land?
```
Never trust "Success. No rows returned" from the SQL editor — `db:check` is the proof.

**Cron is registered** — it's a `cron_jobs` row, **NOT** `vercel.json`. The dispatcher ticks
roughly HOURLY, so a `*/10` expression really fires ~once/hr. Columns are
**`job_name` / `cron_expr` / `enabled`** (NOT `name`/`cron_expression`/`active`), and `enabled`
is the *string* `'true'`:
```bash
npm run db -- cron_jobs --select job_name,cron_expr,enabled --eq enabled=true
```

**Env var is in prod:** `vercel env ls production | grep -i <VAR>`. Remember a var only binds on
a build *after* `vercel env add` — trigger a fresh deploy.

**Panel renders what the API returns** (rendered rows == API rows): `/verify-panel <name>`.

**Backfill/drainer progress:** `/backfill-status <job>` (drained vs stalled vs progressing).

**Full deploy proof** (everything a ship touched): `/verify-prod`.

### What actually exists (keep this honest)

Referencing a command that doesn't exist is worse than referencing none — the model burns turns
looking for it. **If you add or remove one, update this table in the same commit.**

| Invoke | Kind | Does |
|---|---|---|
| `/verify-prod` | command | Proves everything the latest ship touched is live |
| `/verify-panel` | command | Rendered rows == API rows (the facet-bug class) |
| `/backfill-status` | command | Drained vs progressing vs stalled |
| `npm run ledger:audit` | script | Re-greps every fix's proof anchor in `docs/REPAIR-LEDGER.md` against the code — catches REVERTS (a stale preview that only LOOKS reverted is not flagged; it checks the code). `--ref main` audits what ships. Add a ledger row in the SAME commit as every non-trivial fix. |
| `npm run verify:search` | script | ORACLE test for every search surface — hits the LIVE DB + asserts CORRECTNESS vs ground truth (not just non-empty): a real term returns notices that genuinely contain it; a garbage term returns 0 (no fabrication); a code-like term word-boundary-matches (M7 ≠ M776); **Andre's multi-word query "cyber cloud compliance network server"** returns many rows (regression guard — it once returned 0) and the top-10 match MORE terms than the bottom-10 (ranking works); location "FL" is genuinely pop-OR-office FL. Exits non-zero on any mismatch. `-- --json` machine-readable. |
| `npm run verify:beginner-try` | script | SAM-cache oracle for `/try`. Never calls USASpending. Pinned regressions (lidar sentence, fix doors, janitorial, HVAC≠Dale Carnegie, vague follow-up, garbage empty) plus a reverse sample: distinctive nouns taken from live `sam_opportunities` titles, wrapped in beginner sentences. If the cache has the noun, `/try` must not return empty/follow-up. `-- --sample 250` (default) · `-- --pinned` · `-- --json`. |
| `node scripts/acquisition-scorecard.mjs` | script | READ-ONLY 7-day acquisition scorecard (new vs re-touched vs source-modified, latency, one id spot-check). Exits 2 and prints unknown — never zero — when Supabase credentials are missing. `--json` for the machine-readable report. |
| `npm run verify:oracles` | script | ORACLE test for the high-stakes NON-search surfaces where a confident-but-wrong output changes a BID decision (and a green build + unit tests would miss it — the search 1000-row-cap bug passed 11 unit tests + a green build). **scope**: a state-scoped contractor search returns firms genuinely IN that state, not the national top-N-by-$ (the map "national whales only" starvation — proven: drop the state scope → 15/15 off-state leaks). **report**: `generate_market_report`'s agency table uses the canonical 3-FY `MARKET_SPEND_WINDOW`, not a 1-FY window (proven: 1-FY shows $28.6B vs the correct 3-FY $86.0B for 541512 — the "your data is wrong" gap). **contacts**: a known DoDAAC (W912PL → LA District) returns THAT office's real `@usace.army.mil` roster, not a dept-wide `osd.osbp` fallback. **alert**: `normalizeNAICSForPersist` keeps a 6-digit code EXACT — never fans 541512 into the whole 51-code 541 family (the cross-industry alert flood). **pricing**: `get_pricing_intel` keeps grounded/degraded DISTINCT — a real NAICS is grounded=true, a no-input call is an honest empty (grounded=false, degraded=false, validation_error), and an ERRORED CALC is degraded=true — so the documented 429-swallow trap ("no rates exist" when CALC merely throttled) can't return. **mwin**: a PARTIAL win-prob match (same NAICS+agency, wrong set-aside, no capability) keeps its earned NAICS+agency credit (≥40) and lands strictly between the no-profile floor (30) and a strong match (98) — the GRADIENT guard that `verify:m-scale`'s strong-total(98)+fallback checks don't cover (proven: drift the real agency weight 15→0 → partial drops to 37 < 40 → FAIL). **filters**: every Filters-tab filter (NAICS/PSC, set-aside group, Full & Open, notice type, state, closing window, agency) runs through the SHARED `applyMapFilters` (used by BOTH the viewport API and saved-search alerts) against the LIVE corpus and must (a) genuinely NARROW (count < baseline) and (b) return rows that ALL satisfy the predicate — the existing unit test only asserts the PostgREST expression SHAPE (a stub query), so it can't catch a filter that matches the wrong column or narrows nothing (proven: point NAICS at psc_code → 0 rows → FAIL). This is the check that CAUGHT the Agency-"Navy" bug: the Agency field's own placeholder is "e.g. Navy" but Navy lives in `sub_tier`, not `department`, so a dept-only match returned 0 of ~2,043 active Navy opps — fixed to match department OR sub_tier. **freshness**: the 63M-row BQ `usaspending.awards` table (backs /awards, contractor DB, Past Awards horizon) is fed by the WEEKLY ingest (`scripts/ingest-usaspending-awards.ts` → `npm run ingest:awards:apply`); the check asserts `MAX(action_date)` is within 21 days of the government (proven: budget 21→1d → 2-days-behind FAILS). This is the guard that makes a STALLED ingest fail loudly instead of silently serving stale awards (it got to ~101 days behind before this existed). Two independent guards: this oracle + the `check-data-freshness` cron reminder (a `data_sources[bq_awards]` weekly row; the ingest auto-stamps `last_built` on a successful `--apply`, so a real run clears the nag). **recompete-count** (2026-08-04): the Expiring-Contracts headline count. A NARROW filter (541512/6mo) returns an EXACT vehicle count that reconciles ±5% with a direct DB count and is NOT capped; a BROAD filter (no NAICS, 60mo → whole 130k-row table) hits the `GROUP_FETCH_CAP=6000` FLOOR so `capped` is true and the UI MUST render "6,000+" — the guard against the documented "9,450 total in database" cap-as-a-hard-total lie (proven: compare to a wrong-NAICS DB count → delta 100% FAIL; shrink the broad window so total<6000 → FLOOR FAIL). **forecast-match** (2026-08-04): the Upcoming-Buys NAICS filter over `agency_forecasts`. A real 6-digit NAICS returns forecasts that ALL carry exactly that code (route uses `.eq` for 6-digit — no sibling-code leak); a bogus NAICS (999999) returns 0 (honest miss, never fabricated) (proven: swap `.eq` for a 3-digit prefix `.ilike` → allExact=false FAIL; point "bogus" at a real code → 677 rows FAIL). Each check is proven by inject→red→revert→green. `-- --only <scope\|report\|contacts\|alert\|pricing\|mwin\|filters\|freshness\|recompete-count\|forecast-match>` runs one; `-- --json` machine-readable. |
| `npm run verify:m-scale` | script | Proves the two branded Mindy numbers are GROUNDED, like verify:live for a route. **M-Estimate™**: the `opp_value_range` RPC's low/median/high must EQUAL the real 25th/50th/75th percentiles of `recompete_opportunities` re-derived from raw amounts (no drift/stale RPC), + the honest-miss gate (bogus NAICS < 8 comparables → null, never a fabricated band). **M-Win**: a fixed profile+opp must produce the EXACT documented factor total (25+25+15+15+10+8=98), so a weight change can't silently move the score. `-- --naics <code>` to check another market; `-- --json` machine-readable. Exits non-zero on any mismatch. |
| `npm run verify:maps-account` | script | Required Maps chrome regression. Source greps HMAC `b64json(parts[0])`, never-`?` initials, Players=`companies`. `-- --live` curls the **currently serving** host (before merge that can be the previous good build). `-- --live --expect-sha <release>` waits until production's `maps-account-build` stamp matches, then fails if it does not. Missing HMAC secrets → **NOT TESTED**; a configured secret that gets HTTP 401 → **FAIL**. Does not Google-login or paint the avatar — browser acceptance stays required. `-- --self-test` pins the 401/SHA reporting. |
| `npm run tidy:branches` | script | Prunes LOCAL branches already fully merged into origin/main — the residue GitHub's `delete_branch_on_merge` can NEVER clear (it deletes its copy of the branch, not yours; verified 2026-08-17 that the setting was already ON and working — 0 merged branches on origin — while the local list had reached 516). **Dry-run by default; `-- --go` deletes.** Refuses to touch main, the current branch, any branch checked out in a WORKTREE (~25 live here), and anything with ≥1 unmerged commit. Uses `git branch -d`, never `-D`: the safe form refuses a branch whose UPSTREAM has commits the local ref lacks, and that refusal is information. ⚠️ "Remote is gone" is NOT evidence the work landed — a SQUASH merge rewrites the commit so the original ref never looks merged; measured, 39 of 44 gone-remote branches still held unmerged commits. Only the commit count decides. A `post-merge` hook REPORTS the count on main (never deletes on its own). |
| `/ui-fix` | command | Render fixes — only after the data is proven right |
| `/check-access` `/kv` `/admin-endpoint` `/email-template` `/stripe-handler` `/product-page` `/test-sam-api` | commands | Repo-specific recipes (`.claude/commands/`) |
| `/deploy` `/rootcause` `/from-screenshot` `/email` `/plan-first` `/session-update` `/reconcile-todo` | commands | Global (`~/.claude/commands/`) |
| **fix-and-ship** | agent | The whole loop: symptom → cause → fix → proof → live |
| **ship** | agent | Working tree → deployed → confirmed on the live URL |

### The screenshot-debug decision tree (the 386-turn loop)
A number/label on screen looks wrong → diagnose in THIS order before touching a component:
1. **Wrong DATA?** Query the source table/API, compare to screen. A "No X found" when data exists, or a stale figure = a **query/wiring bug** → fix the backend, don't mask it in the UI. (Most "still shows X" loops are this.)
2. **Stale CACHE?** DB is right but screen is old → fix the cache layer (KV / last-good / SWR), not the component.
3. **UI RENDER?** Data is right, presentation wrong → the component. Apply standing UI standards (counts at top · names not codes · chips clickable · spinner on load · legible contrast · vertical bars · no dead empty-state · jargon defined).
Then: `/ui-fix` (render) → `/verify-panel` (prove) → `/deploy` → `/verify-prod`. Or hand the whole
loop to the **fix-and-ship** agent, which owns symptom → cause → fix → proof → live in one shot.
