# Search, matching, links and the Map

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## 🧭 Incumbent identity: location is corroboration, never identity (FROZEN 2026-09-22)

The sector/taxonomy guardrails in `incumbent-evidence.ts` reject a candidate whose NAICS
sector disagrees. They cannot see what actually produced both RC-3 false positives: the
distinctive-token overlap behind "high confidence" was **entirely geography**.

| Solicitation | Named | The whole evidence |
|---|---|---|
| `36C24226Q0857` VA demolition/abatement | AT&T (517110) | `East`, `Orange`, `Lyons` — the two VA campuses |
| `SPE60525R0222` DLA fuel (324110) | Lockheed PAC-3 (336414) | literally `United` and `States` |

A **same-sector** candidate can be built the same way, so taxonomy is a floor, not a cure.
**RULE D** (`src/lib/usaspending/incumbent-location-evidence.ts`): hits split into
`workHits`/`locationHits`; the ladder runs on work hits, location earns a capped +5 and can
never reach a tier; zero non-locational hits with no PSC match is never grounded.

⚠️ **The lexicon must never contain a word that can NAME THE WORK.** Federal agencies buy
roads, highways, forests and grounds — measured live in work sectors (23x/56x/115x):
`road` 740 · `forest` 709 · `park` 705 · `grounds` 433 · `bridge` 306 · `harbor` 263 ·
`highway` 24. Calling those geography deletes the strongest evidence a road or grounds
recompete has. ⚠️ **Never word-split a multi-word state name** — it leaked `island`, `new`,
`carolina`, `york` into the geography set, and `island` is a work object ("BAR ISLAND DAM
RECONSTRUCTION"). ⚠️ **The BUYER'S NAME is not geography.** The vocabulary is built from pop_* ONLY — never `agency`/`department`. Folding the buyer in made every word of it a place, which deletes the work evidence of the agencies whose name IS the work (FOREST SERVICE→`forest`, BUREAU OF RECLAMATION→`reclamation`, ARMY CORPS OF ENGINEERS→`engineers`). `noticePlaceVocabulary()` deliberately RECEIVES the buyer and ignores it, so the contract is asserted rather than accidental. Buyer-name evidence is still removed by NONDISTINCTIVE (applied first) and the buyer keeps its own +15 scoring axis. A SPECIFIC place arrives from the notice's own `pop_city`/`pop_state`
(threaded as `family_places`): "East Orange" is excluded because SAM records it for that
notice, never because it was typed into the file. `building`/`site`/`area`/`district` — and also `park`/`port`/`harbor`/`river`/`lake`/`island`/`coast` — are
already dropped upstream by `NONDISTINCTIVE` and are deliberately absent from the lexicon. Keeping
them out of the geo set is correct, but it does NOT make them usable work evidence: a "Harbor
Breakwater Repair" recompete still cannot score on `harbor`. Recorded as a known bound, not fixed here.

**RULE PRECEDENCE — decided, not implied** (`incumbent-rule-precedence.unit.test.ts`):
a **sector conflict beats PSC agreement**. Only independently verified identity (a
predecessor named on the notice, a shared PIID/UEI) overrides it — never taxonomy or token
overlap. So "a NAICS mismatch with real PSC evidence still grounds" is true **only within a
sector**. Stated cost: a building-repair notice (23) whose true predecessor went to an A&E
firm (54) under the same PSC is refused. We accept a missed incumbent over a fabricated one
— a withheld incumbent is visibly absent in `prior_awards`, a wrong one gets acted on.

**RULE C** — `get_incumbent_financials` requires `>= medium` AND `supported`, asserted at the
`build_pursuit_dossier` call site so a false incumbent cannot cascade into a named company's
SEC filings.

**A withheld report must withhold the ARTIFACT, not just the link.** The gate withheld
`deliverable.url` and persistence while still rendering the branded HTML — the thing a
customer forwards to their client. `deliverable.html` is now gated on the same verdict.
⚠️ Nothing engineering-facing may appear in generated client HTML; rationale goes in
TypeScript comments (stripped at build), never inside the template literal.

---

## 🔗 Record links vs market links — READ before emitting any per-record URL

**`docs/engineering/record-links-vs-market-links.md`** is the frozen rule (Eric, 2026-09-12):

> **Record links identify records. Market links identify markets. Profile filters belong on
> market links, never on record links.**

A record link (`?opp=<notice_id>`, `?recompete=`, `?company=`, `?buyer=`) carries the record's
id and **nothing that can exclude it**. A market link (`?naics=`, `?agency=`, `?state=`, `?ss=`)
carries a scope. **Never put a fact about the READER (their profile state/NAICS) on a link that
names ONE record** — the record was already selected for them upstream, so re-filtering at the
destination can only delete it.

**Why it is a rule:** the daily alert's "View opportunity" CTA emitted
`?naics=&subAgency=&state=<recipient's profile state>` instead of the notice id. The map's
scope-params IIFE (`opportunity-map/route.ts` ~8141) applies those through `__applySavedSearch`
in a 40×150ms retry loop, so boot painted broad results and ~1–2s later the filters emptied the
map — **5,416 → 0** on prod. `state` filters `pop_state`, populated on only 4,047/10,993 open
rows (36.8%); **571 of 2,078** NAICS × sub-agency scopes (27.5%) go to exactly 0 under any state
filter. The fix (#1441) was not to make the race less likely: `?opp=` alone makes the IIFE
early-return, **removing the wrong writer from this link class**. Guarded by
`alert-opp-deeplink.unit.test.ts`.

**Two habits it hardens:** *reuse the existing typed address* (`?opp=` already served Share,
Favorites and `/today` — the email was the only surface ignoring it), and *a sparse column is a
deletion risk, not a narrowing* (measure fill rate before filtering on it). And when a screen
renders then empties, diagnose from a **state timeline**, never the final URL.

---

## 🔁 Return continuity — the Map remembers the MARKET, not just the viewport (2026-09-21)

**Two localStorage keys, two different jobs. Do not merge them.**

| key | holds | written by | read by |
|---|---|---|---|
| `mi_map_last_view` | lat/lng/zoom (30d, US-only, z≥4) | map `moveend` → `window.__saveMapView` | the map constructor in `template.html`, **synchronously** |
| `mi_map_last_search` | `{mode, filters, t}` — **no bbox** | `fetchView()` → `window.__rememberMapState` (debounced 1.2s) | the boot restorer in `BOOT_VIEW_JS` → `window.__applySavedSearch` |

⚠️ **`mi_map_last_search` must never carry a bbox.** The viewport already has an owner that is
strictly fresher (moveend, not filter-change) and applies *before* boot. A second writer moving
the map after boot is the `?naics=&state=` race that took the map **5,416 → 0**.

⚠️ **Never remember a filter `__applySavedSearch` cannot give back.** `window.__mapStateMeaningful`
is the allowlist and it is a SUBSET of that restorer's `FILT` reset (+`q`), guarded by
`return-continuity.unit.test.ts`. `strategy` is deliberately absent — `_mapState` stores it
comma-JOINED while the restorer copies only keys on its `FILT` literal, so it would be silently
dropped and the "Picked up where you left off" pill would be lying. `fsc` likewise (it lives on
`window.__fscFilter`). `companies`/`buyers`/`dla` modes are not stored at all: the first two would
greet a returning anonymous visitor with the `__playersGate` modal, and dla's FSC filter is not in
the shape. **A half-restore is worse than none.**

⚠️ **An empty default map is not a session.** The meaningfulness check runs on BOTH the write and
the read side. On the write side it is what stops the boot `fetchView` — which runs with the empty
default *before* any restore lands — from overwriting a real memory with nothing.

⚠️ **The memory never fights the URL.** Any record link (`?opp= ?company= ?buyer= ?recompete=
?forecast=`) or market link (`?ss= ?agency= ?naics= ?state= ?strategy= ?q= ?mode= …`) or `?embed=`
stands the restore down. The URL is the more recent instruction.

Event: `returning_session_restored` (`tool_use`, `event_source='opportunity_map'`) with
`age_hours` + `returning` (age > 30 min) — a reload seconds later is restored but is **not** a
return, and counting it as one would inflate the one number this exists to move.

**Also fixed here: the anonymous save was UNREACHABLE.** #1601 put it on `window.savePursuit`,
which has **zero call sites** — measured on the serving production page, it appears exactly twice
(its own definition and its own sign-in retry callback). Every live button calls
`window.saveCurrentOpp` (13 occurrences), which had no anonymous branch; production confirmed it
with **0 rows in `anonymous_shortlist` and 0 `shortlist_saved` events, ever**. The branch now lives
in `saveCurrentOpp`, restricted to a SAM drawer with a canonical 32-hex `notice_id`
(`!CUR.kind && !CUR.isDla && /^[a-f0-9]{32}$/`), and callers passing a `done` callback
(`openProposalWorkspace`, `startCapture`) are excluded so their signed-in destinations still work.
**A save is still not a pursuit** — the label says "Saved", never "Tracked"/"In pursuits".
`window.__claimAnonWatches` (W1/#1600) called a bare `_uemail()` (and `_anonId`/`_track`/`_ss*`)
from SAVE_JS and threw — **fixed 2026-09-26 (P0-F)**; it now uses SAVE_JS's own `tok()/email()/_anonKey()`
and `window.__track/__ssMsg/__ssReset`. Guarded by `anon-watch-claim.unit.test.ts` (executes the claim in
SAVE_JS scope). The 37 pre-fix `anon:` watches are NOT reassigned — only the browser holding that anon id
can claim them.

---

## 👥 Proven Players — FILTER, then RANK (2026-10-04)

**Proven Player** = a unique UEI with actual federal award history under the selected NAICS.
Canonical order: **awards → UEI → NAICS → HQ geography → FILTER → RANK.** Never national rank →
geography filter. Audit: `tasks/players-naics-coverage-audit-2026-10-04.md`.

- ⛔ **`top_contractors_by_dimension` is a top-50 LISTICLE, not a population.** It powers `/top/*`
  only. Reading it as "the firms in NAICS X" then filtering by state is what made 541512/TX show
  **0 Players vs 327** real awardees and 45.9% of NAICS×state cells a false zero.
- Canonical dataset `players_naics_recipients` (`src/lib/players/dataset.ts`), query
  `src/lib/players/query.ts` (every scope is a WHERE before GROUP BY/ORDER BY/LIMIT), viewport
  geography `src/lib/players/geography.ts` (visible cities applied before ranking).
- **Four truth states** (`src/lib/players/truth.ts`): `success_nonzero` · `success_zero` ·
  `unavailable` · `coverage_incomplete`. Only `success_zero` may render 0. An error is never 0 and
  never the Players sales copy (that copy is for a 401/403 only). The legacy rollup answer is always
  `coverage_incomplete`. Copy: `src/lib/players/copy.ts` ("Top N shown", never "N companies exist").
- ⚠️ **HELD:** `PLAYERS_SOURCE=canonical` is OFF and the production table is NOT built. Required
  order: **BQ awards repair → awards reconciliation → `npm run players:rebuild -- --go` →
  `npm run players:rebuild -- --reconcile --go`** → then set the flag. The rebuild REFUSES while
  awards cohort completeness ≠ complete (no override). `PLAYERS_REBUILD_AFTER_INGEST=on` chains it
  after each ingest — turn on only after acceptance.
- Oracle: `npm run verify:oracles -- --only players` (fails on legacy by design);
  `--players-preview` proves the code in an ephemeral BQ session table (not acceptance).
- Registered Players (SAM registration NAICS) are a separate future population — never mix them in.
- **Merged dormant (#1812).** Activation runbook + open P1 follow-ups (Contractors panel null→0,
  set-aside after cap): `tasks/players-followups-2026-10-04.md`. Canonical identity is the **UEI**, never the name.

---

## 🔤 A MATCH IS A CLAIM — READ before touching /try, the match engine, or SEO page generation

**`docs/engineering/try-relevance-regression.md`** is the record; the frozen set is
`src/lib/beginner/__fixtures__/try-relevance-cases.ts`.

> **Only the business ACTIVITY may establish a match. Words that describe the company,
> the customer or the act of contracting — person, company, government, contracts,
> small, help — can never put an opportunity in "Matches what you described".**

**Why it is a rule.** On 2026-09-21 prod answered *"can a 2 person garbage company do
government contracts"* with 13 results, none about garbage: a DoD personnel-security
platform, a PERSONAL alert device, PERSONAL services contractors. Two causes, both
measured: the searched keyword was the literal word **`person`** (out of "2 person"),
because `keywordCandidates()` ranks by POSITION — true of expert phrasing, false of
beginner prose, which leads with who you ARE; and the gate was `title.includes(token)`
with **no word boundary**, so `person` ⊂ `personnel` ⊂ `personal`. Same class as the
earlier "Dale Carnegie *Building*" match. Measured heads before the fix: `small` for IT
support, `install` for roofing, `physical` for security guard, `agency` for staffing.

- **`src/lib/beginner/activity.ts` is the only place that decides what we search.** A
  ladder, not a score (summing per-token scores prefers LONGER phrases, which then match
  no SAM title at all — "clean office" 0 rows vs "clean" 40): distinctive single activity
  noun → anchored phrase → a typed-but-generic word → **ask a question**.
- **`src/lib/beginner/relevance.ts` decides what qualifies**, in three tiers —
  `direct` (activity term, word-boundary, in the title) · `broader` (a shortened form, a
  broader-search term, or a code overlap) · `reject`. **Expanding the user's word is safe
  (`cater`→`Catering`); shortening it is not (`trucking`→`Trucks`)** — an object is not
  the service.
- ⚠️ **/try resolves NO NAICS.** It passes `skipUsaSpendingCoverage`, so `naicsCodes` is
  always empty and `classification` is always `keyword_fallback`. A gate of the form
  "NAICS/PSC must intersect the resolved set" returns ZERO for every /try query. Codes
  corroborate or demote; they never admit. A NULL NAICS never deletes a title match.
- ⚠️ **Absent ≠ unrestricted.** `classifySetAside(null)` is `not_stated`, not `open`.
  **4,261 of 9,030 active open notices (47.2%)** carry no set-aside at all and every one
  used to render *"Who it's for: Any business that can do the work"*. A FILTER may assume
  NULL means Full & Open; a SENTENCE ON A CARD may not.
- ⚠️ **An RFI is not a bid.** Every card carries a `stage` (`open_bid` /
  `market_research` / `upcoming` / …) and the count carries its own mix. The original 13
  were 8 market-research + 1 pre-sol + 4 biddable under one "13 current opportunities".
- **Rejected with evidence, do not re-propose:** ranking activity words by
  `naics_vocabulary` (`physical` w1481 beats `guard` w1206; `window`→agriculture), and
  expanding the market from the direct hits' NAICS (the one live "garbage" hit is 562998,
  whose mined vocabulary is *grease trap cleaning*).
- **Gates:** `src/lib/beginner/try-relevance.unit.test.ts` (hermetic, drives the frozen
  set) + `npm run verify:beginner-try` (live cache; 11 pinned + 800 sampled searches).
- **SEO page generation stays blocked on this set passing** — every programmatic page
  inherits this matcher.
- **Adversarial round (same day) found the same class twice more, both now pinned:**
  ownership self-description (`woman owned small business that does catering` searched
  **`owned`** → nine Government-Owned fuel-depot contracts) and verbs that are also nouns
  (`we drive trucks` → **`drive`** → DISK DRIVE / AC DRIVE, 26 cards, zero trucking). A
  verb that IS the service also emits the compound the buyer writes — `crane rental`,
  `vehicle towing`, `alarm monitoring` — but **never for install/repair/replace/remove/
  clean**, where the object already names the work ("we install windows" narrowed from 36
  live notices to 1 before that was fixed).
- ⚠️ **PLURAL IS NOT DERIVATION, and the SQL keyword must be SINGULAR.** "we build fences"
  printed *"Mindy found 0 current opportunities"* above three live fence cards — 14 open
  fence notices existed. SAM's title search is an ILIKE substring, so `%fences%` cannot
  match "Fence". Measured after: fences 0→11, roofs 3→24, windows 2→24.
- ⚠️ **AN EXACT-TOKEN MISS IS NOT MARKET ABSENCE.** `/try` matches the words in a
  listing's TITLE. Zero open titles contain "lawn" or "mowing", while ~18 open
  grounds-maintenance notices (NAICS 561730) are exactly that business. No copy may say
  *"nothing matching is open"* or *"the open market is small"* — both shipped, and the
  second was live on the garbage case (1 title match reported as a small market beside
  ~20 open refuse/solid-waste notices). Say which words were searched and that the limit
  is the SEARCH. Guarded by the live oracle's `no_market_absence_claim` pin.
- ⛔ **There is NO body-text rescue, and the one that was built is RETRACTED.** A
  `detail-evidence.ts` fallback read the notice's description on an empty result and quoted
  the line; independent review measured **~19 of 26 hits (73%) wrong** — submission
  boilerplate, a table of contents, FAR clause text, a scope EXCLUSION quoted as proof.
  Removed 2026-09-21. Its own "multi-word terms must be a PHRASE within 40 chars" guard was
  **order-free proximity and did not work** (`"the staffing plan shall address medical
  surveillance requirements"` matched `"medical staffing"`). Evidence + the bar a
  replacement must clear: `src/lib/beginner/__fixtures__/body-relevance-cases.ts` and
  `tasks/body-relevance-followup-2026-09-21.md`. **Do not substitute another heuristic
  without clearing that bar**, and do not re-propose a word→code→market hop — three are now
  measured and rejected (`physical` outranks `guard`; 562998 → "grease trap"; `lawn` →
  333112 lawn-mower manufacturing).
- **`verify:beginner-try --sample` is a RECALL FLOOR, not a precision score** — nouns are
  harvested from live titles, and it only asserts not-empty / not-follow-up. A build
  returning the whole corpus would score 1000/1000. Precision lives in the frozen set and
  the pinned oracles.

## Keyword-first market research (June 8, 2026)

**The principle (Eric):** NAICS is the WRONG primary key. A product like "drones"
sprawls across **70+ NAICS codes** ($243M FY2025); the single obvious code (336411
Aircraft Mfg) is only **28%** → searching it alone MISSES 72% of the market. Worse,
336411 is BOTH over-broad (all aircraft) AND incomplete. So: **keyword is the
discovery key; NAICS is auto-derived invisibly** (its real job is set-aside SIZE
eligibility, not discovery). User never manages 70 codes.

**The 3-axis model** (memory: `naics-vs-psc-search`):
- **Keyword** = discovery (what's this about — most complete + precise; matches the
  contract text)
- **PSC** = what was BOUGHT (1550 "Unmanned Aircraft" — the literal product; the
  GovCon-pro insight is PSC > NAICS for search accuracy)
- **NAICS** = who the SELLER is + size/set-aside eligibility (the qualification axis)

**Implementation:**
- `src/lib/market/keyword-coverage.ts` — `keywordCoverage(keyword)` → total market
  $, all buying NAICS ranked, the smallest set covering ~90%, + top PSC ("what was
  bought"). **Phrase-resilient**: USASpending keyword search is EXACT-PHRASE, so it
  tries candidates most→least specific (full phrase → significant words, stopwords
  stripped) — otherwise sentences silently fall to the LLM.
- `target-market-research` accepts `keyword`; auto-derives the 90%-coverage NAICS
  set, returns `keyword_coverage` (total_market, naics_count, codes_used,
  coverage_pct, top_psc) for the lesson banner.
- `src/components/app/market/MarketCoverageBanner.tsx` — teaches the lesson
  ("drones = $243M across 70+ codes; obvious code = 28% → miss 72%; PSC = Unmanned
  Aircraft"). Renders only for keyword research.
- **Sport Mode**: keyword build applies the FULL coverage set (~8 codes), not top-3.
- **Onboarding** (`src/app/app/onboarding/page.tsx`): the describe-your-business
  step now grounds day-1 codes via `/api/suggest-codes` (full coverage), NOT the old
  hardcoded 3-per-industry map that broke new users' alerts by missing 72%.
- `suggest-codes` `groundCodesFromUsaspending` has the SAME phrase-candidate
  fallback (onboarding sends sentences).

**Gotcha:** USASpending keyword = exact phrase. Always reduce phrases to candidate
terms or you ground nothing → LLM fallback (defeats the whole point).

---

### Market Map data sources & caching (memory: `mindy-market-map-tmr-cache`)

The Market Research panel (`/app?panel=research`, `MarketResearchPanel.tsx`) has **two
data paths that can disagree**:

- **FPDS Leaderboards** (Top 10 Departments / Contracting Agencies / Vendors) →
  live `spending_by_category` via `/api/usaspending/fpds-top-n`. Not cached at that
  layer → always current & correct.
- **Stat cards** ("Relevant spending", "Agencies to review") → `/api/app/target-market-research`
  (TMR), **cached 24h in Supabase `agency_target_data_cache`**, rolled up as
  `rollupChartBuyers` = group rows by `subAgency||parentAgency||name`, take MAX `metric_top_total`.

**The "Spending by Agency" BAR CHART was REMOVED (PR #245, Jul 15 2026)** — its TMR-sourced
agency totals could not be reconciled with the FPDS leaderboards, so it read as "numbers don't
match." The FPDS leaderboards are now the sole agency-spend surface; the Small Business Mix donut
(Auto mode) and the TMR stat cards remain. (`SpendingByAgencyChart` component + its recharts
`BarChart`/`Bar`/`XAxis`/`YAxis` imports are gone from `MarketResearchPanel.tsx`.) The
TMR-vs-FPDS reconciliation notes below still apply to the surviving **stat cards**.

**When the stat cards disagree with FPDS, it's a STALE TMR cache, not a live bug.** (Jul 2026:
236220 showed Dept of State #1 at $13.5B — its all-NAICS total leaking via an old
broadened-sample fallback — vs its true $2.9B; $45.1B headline vs the real $94.4B.
The compute was already correct; the row was a pre-fix cache entry.)

**Fix lever = bump `SPEND_SCHEMA_VERSION`** in `src/app/api/app/target-market-research/route.ts`
(~line 436). The cache key embeds it (`${cacheToken}${stateSuffix}|${SPEND_SCHEMA_VERSION}`),
so bumping **orphans every entry fleet-wide** → next access recomputes with current code,
then re-caches 24h. **Now at `sv8`** (bumped sv7→sv8 in #235, Jul 15 2026); each bump is
documented inline.

**Ground truth for verification:** USASpending `spending_by_category` with
`award_type_codes:['A','B','C','D']` (contracts only), **exact** 6-digit NAICS
(`expandNAICSCodes(codes, false)` — do NOT sweep the 3-digit subsector), and the
canonical 3-FY `MARKET_SPEND_WINDOW`. `fpds-top-n`, `find-agencies`, and TMR all share
this filter so their dollars reconcile.

**Verify TMR live WITHOUT a browser** (data-level; the app UI is Pro-login-gated):
```bash
curl -s -X POST https://getmindy.ai/api/app/target-market-research \
  -H 'Content-Type: application/json' \
  -d '{"naicsCode":"236220","email":"eric@govcongiants.com","businessType":"","veteranStatus":"Not Applicable"}'
```
Since R1 (2026-10-04) the tier comes only from a verified session, so this unsigned curl
gets the **Free** view. To see the Pro rows or force a fresh compute, add a staff session
header (`-H "x-mi-auth-token: <token minted for the staff email>"`) and `"refresh":true`.
A claimed email alone no longer counts as staff. The cache key also splits on `business_type` + `veteran_status` + states,
so the form default `veteranStatus:'Not Applicable'` is a **different key** than an
omitted one. Response: `agencies[]` (each with `metric_top_total`), `relevant_spending`,
`cached`.

---

### Rate Limits & Caching

- **Standard tier:** 1,000 requests/day, 10/min
- **Cache TTL:** 24h for awards/entity, 1h for opportunities
- **Cache table:** `sam_api_cache` in Supabase
- **Fallback:** USASpending API (primary for Contract Awards)

### ⛔ CACHE-FIRST — read before you call SAM (Eric's #1 recurring correction on SAM work)

**Before ANY live SAM API call, check what we already have. Never call SAM for data that's
already cached or derivable — Eric has had to remind me EVERY time we touch SAM, which means
it wasn't a rule, it was a re-derivation. Now it's a rule.** The reflex, in order:

1. **`sam_api_cache`** — the SAM response cache. Entity lookups are `api_type='entity'`; the raw
   response (incl. UEI + `coreData.businessTypes.sbaBusinessTypeList` = the certs) lives in
   `response_data.entityData[0]`. Hundreds of firms are ALREADY here — harvest them first
   (`transformEntity` extracts the certs). A live SAM call for a firm we've already looked up is
   waste + burns the 10/min budget. *(2026-07-28: the SAIC set-aside backfill was re-calling SAM
   for 717 firms whose entity response was already sitting in `sam_api_cache`.)*
2. **Our own DB / BigQuery** — `sam_opportunities` (88K cached opps), `recipients`/awards in
   BigQuery (317K contractors), `recipient_certifications` (UEI→certs). If the answer is a field
   we already store, read it — don't re-fetch from SAM.
3. **`fetchSamOpportunitiesFromCache()`** for briefings/alerts — never the live opps API in a loop.

**Only call live SAM for what's genuinely missing** (a UEI/notice we've never fetched, or a
cache entry past TTL). When you DO backfill from SAM, seed from the cache first and hit the API
only for the gap. This is the "reuse, don't rebuild" GOS invariant applied to SAM specifically.

### Key Rules

0. **CACHE-FIRST (see the ⛔ block above)** — read `sam_api_cache` / our DB / BigQuery BEFORE any
   live SAM call. This is the rule Eric corrects most on SAM work; treat it as reflex, not an ask.
1. **No comma-separated NAICS** — make parallel requests
2. **Always cache responses** — 24h TTL minimum (write-side; #0 is the read-side companion)
3. **USASpending is primary for Contract Awards** — has bid count data
4. **Use MCP tools when available** — `mcp__samgov__*` for opportunities

### Env Variables

```env
SAM_API_KEY=xxx                    # Opportunities (existing)
SAM_CONTRACT_AWARDS_API_KEY=xxx    # Needs System Account
SAM_ENTITY_API_KEY=xxx             # Same as SAM_API_KEY
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/sam/utils.ts` | Shared rate limit, cache, error handling |
| `src/lib/sam/contract-awards.ts` | Contract Awards wrapper (uses USASpending) |
| `src/lib/sam/usaspending-fallback.ts` | USASpending API for bid counts |
| `src/lib/sam/entity-api.ts` | Entity Management API wrapper |
| `src/lib/sam/subaward-api.ts` | Subaward Reporting API wrapper |
| `src/lib/sam/federal-hierarchy.ts` | Federal Hierarchy API wrapper |
| `src/lib/sam/index.ts` | Unified exports |

---

## Full-text search + global lookup (June 11, 2026)

The "biggest challenge" fix — **titles lie; the body has the truth.** Four-corpus search
+ a header lookup bar. (See memories `sam_description_body_capture`, `market_research_invalid_naics`.)

### Body-text capture (descriptions were EMPTY cache-wide)
SAM's `/search` list endpoint returns `description` as a LINK (`…/noticedesc?noticeid=`),
not text. The sync stored the link → every `sam_opportunities.description` was empty →
body search matched nothing.
- `src/lib/sam/notice-description.ts` — resolves the link → plain text (HTML-stripped, NUL-safe).
- `/api/cron/backfill-descriptions` — batched/resumable, dispatcher-fired (uses prod SAM key
  server-side; LOCAL key 400s on noticedesc). 2 jobs: active + `?inactive=1`. Drains rows
  where description is null/a-link.
- `sync-sam-opportunities` OMITS `description` from the upsert (was storing the link + would
  clobber backfilled text on re-sync). New notices insert NULL; backfill fills within minutes.

### Search (mi-dashboard) — 4 corpora + archive + word-boundary
`src/app/api/mi-dashboard/route.ts` `buildSearchOr()`:
- Searches **title + description + sow_text + department** (sow_text = the extracted SOW/PWS).
- **Word-boundary** for code-like terms ("M7" ≠ "M776") via Postgres `\m..\M` `imatch` regex;
  ILIKE substring for phrases.
- **`?status=active|inactive|all`** — search the archive (~59k inactive notices). Default active.
- **Active search ESCAPES the profile-NAICS/states filter** (two `.or()` calls AND together in
  PostgREST → keyword search was trapped inside the user's codes). Default view = profile-scoped;
  explicit search = full corpus. Explicit `?naics=`/`?state=` still apply.

### Global lookup bar (`src/components/app/GlobalLookup.tsx`)
In the `/app` header (members-only). Resolves three identifier types:
- **Contract number (PIID)** → `AwardDetailDrawer` (reuses `/api/app/award-detail?piid=`).
- **Company name / UEI** → `/api/contractors/search-bq` → navigate to `/contractors/[slug]`.
- UEI checked before PIID (12-char collision). Focus hint lists the three types.

### Contractor search bug (was returning 0 for everything)
`queryCached` (`src/lib/bigquery/cache.ts`) DEFAULTS to `cacheOnly: true` — returns `[]` on a
cache miss to protect public/unauthed traffic from cold BQ scans. `searchRecipients` never set
`cacheOnly: false`, so the in-app Contractors panel + lookup returned 0 despite 317K rows. Fix:
`searchRecipients({ liveBq: true })` threads `cacheOnly: !liveBq`; the authed `search-bq` route
passes `liveBq: true`. Also: name-search now matches exact UEI too. Diagnostic: `/api/admin/bq-health`.

## Location search for opportunities (2026-07-16)

"Find all contracts in Florida" didn't work — Mindy matched agency/NAICS/DoDAAC but not
location. Root cause is a DATA gap, not just a missing filter: `sam_opportunities.pop_state`
(place of performance) is only **~36% filled** (SAM omits it on ~64% of notices — and it's
absent from `raw_data` too, so it's unrecoverable), while `office_address->>state` (the buying
office) is **~100% filled**.

**Fix = match place-of-performance OR buying-office state** (2-letter codes; both columns are
uppercase 2-letter). Widens FL ~51–55% (1694→2553 all / 136→211 open).
- `normalizeStateCode()` (`src/lib/utils/us-states.ts`) — full name ("Florida") or code → `FL`.
- `search_sam_opportunities` (`src/lib/chat/tier1-tools.ts`, TIER1 → auto-exposed on MCP) gained a
  `state` param + returns `location: {pop_state, pop_city, office_state}`. Filter:
  `.or('pop_state.eq.FL,office_address->>state.eq.FL')`.
- `mi-dashboard` state filter broadened to both columns (explicit + profile `location_states`),
  now normalizes full names from the URL.
- **Honest label:** location = "performed in — OR bought by an office in — <state>", because pure
  place-of-performance is sparse in SAM. Don't present it as comprehensive PoP.
- `/api/admin/backfill-pop-state` exists but recovers **~0** (SAM genuinely lacks the data); kept
  as an honest, idempotent no-op that would catch future recoverable rows. The sync already reads
  `placeOfPerformance.state.code` for new rows — unchanged.

---

## Past-contracts (AWARDS) search by location — MCP + BigQuery + USASpending (2026-07-16)

The opportunities fix above only covered OPEN notices. **Awarded/historical contracts** had no
location index either (Mindy matched awards by agency/NAICS/company but not geography). Fixed
across BOTH award data sources on the MCP surface. Unlike SAM opportunities, place-of-performance
is an **FPDS-required field**, so it's well-populated on awards — no ~36% sparsity problem.

- **A — new `search_past_contracts` MCP tool (USASpending).** The discoverable "what contracts
  were awarded in \<state\>" lookup. `src/lib/usaspending/awards-search.ts` (`searchAwardsByLocation`)
  hits `spending_by_award` (award types A/B/C/D + optional `include_idv`), `state_scope` =
  `pop` (place of performance, default) | `recipient` (awardee HQ) | `both` (union). USASpending
  ANDs its filters + forbids mixing contract/IDV type groups in one call, so `both` and IDV
  inclusion fire parallel requests merged/deduped by award id (SAM-NAICS parallel pattern). Wrapper
  `src/mcp/tools/past-contracts.ts` (2 cr, `_meta` always, `_ai_hint` gated, `normalizeStateCode`).
  Registered the two-path way + `server.ts` zod + smoke. **Verified live:** FL/541512 → L3Harris
  $1.8B pop=FL; `both` fires 2 requests, 0 off-state leaks.
- **B — fixed `search_contractors` NAICS+state bug (BigQuery).** `searchRecipients` SILENTLY DROPPED
  `state` on the NAICS path — that path reads the `topContractorsByDimension` rollup, which has no
  state column. Now filters via the joined `recipients r.state` (turns the LEFT JOIN into an inner
  match) + returns the firm's city/state. Cache key v3→v4. "Top 541512 firms in FL" finally honors FL.
- **C — added `state` to `find_capable_contractors` (BigQuery).** `findCapableSmallBusinesses` gained a
  `state` param (`recipient_state = @state` on the awards scan = firms HQ'd there) + returns
  `recipient_state`. Rule-of-Two market depth "in a state." Threaded through the tier2 def/execute.
  Cache key v1→v2.
- **D — added `state_scope` to `search_idv_contracts`.** The MCP path only ever filtered recipient HQ
  (never place of performance). `idv-search.ts` `stateFilterType` gained `'both'` (recursive
  pop+recipient merge); `state_scope` exposed on the wrapper/def/zod. Default stays `recipient`
  (backward compatible).
- **Shared-lib wins:** B/C/D fix the BigQuery/idv libs that the **in-app panels use too**, so the app
  and MCP both benefit (no separate mirror). B/C are best verified post-deploy via the live panels
  (cold BQ scans hit the quota kill-switch locally). tsc clean; 55/55 MCP+tier2 unit tests pass;
  stdio smoke = **39 tools**.

---

## Market spend: ONE shared query + the lead-vs-biggest split (2026-07-16, PRs #290/#293)

Triggered by Eric: *"people who are comparing us to another platform that uses NAICS may say our
data is incorrect."* Investigating that surfaced two real bugs and one architectural rule.

### 🔑 `src/lib/market/spend-query.ts` is THE canonical market query — always use it
The filter + scope decision used to live INSIDE route handlers, so every surface re-derived "what
market is this" on its own. That is exactly how TMR and the FPDS leaderboards drifted until their
agency totals couldn't be reconciled and the Spending-by-Agency chart had to be DELETED (#245,
"the numbers don't match"). **Anything that ranks/aggregates a market MUST call
`resolveMarketScope()` + `filtersForScope()` + `fetchSpendingCategory()`.** Never hand-roll the
filter, never copy it — a client-facing report disagreeing with our own panel is far harder to
defend than a delta against a competitor. Consumers today: `fpds-top-n`, `generate_market_report`.
(`target-market-research` still has its own copy — a known follow-up.)

### ⚠️ `allNaics[0]` is the LEAD, not the biggest — two different pcts
`keyword-coverage` deliberately PROMOTES the semantically-right code to the head of `allNaics`
("hvac" leads 238220 Plumbing/HVAC Contractors, the specialty trade, even though 236220 General
Building has 2.7× the dollars). So one field can't answer both questions:

| field | question | source |
|---|---|---|
| `topCodePct` | **displayed** — "the obvious code is only 28%, you'd miss 72%" | biggest by **dollars** |
| `leadCodePct` | **the ranking gate** — "is the code this keyword MEANS dominant?" | `allNaics[0]` |

They were ONE field, so the report and the Market Coverage banner rendered **"the single biggest
NAICS is only 0%"** for drones (reading the promoted 0.2% sliver 339930 instead of 336411's 28.4%).
`DOMINANT_NAICS_SHARE` reads **`leadCodePct`** — gating on the biggest would push "hvac" into NAICS
ranking led by GENERAL CONSTRUCTION, surfacing general contractors for an HVAC search (Eric:
*"it should be 238 since it's a specialty trade"*). Measured: 8/10 keywords have lead == biggest,
so this changed **zero** ranking outcomes.

### ⚠️ The dominant fall-through uses the LEAD CODE ONLY — never the coverage set
`buildMarketFilter()` returning null means "rank by the code", **not** "no market". `fpds-top-n`
treated null as an error and **404'd `security guard` ($6B), `janitorial services` ($1.9B) and
`roofing` ($578M)** — three of the most common small-business searches, dead in prod until #293.
And the fall-through must filter on the LEAD code alone: roofing's coverage set carries 236220,
where roofing is a $79M sliver of a $60B+ code → filtering the SET measured all federal building
construction (**top-3 $77.7B**) instead of roofing (**$1.34B**).

### The reconciliation line (the answer to "your data is wrong")
`generate_market_report` returns `basis{}` (what each section measured) + `reconciliation{}` —
*"336411 alone = $68.9M (28%) vs $242.7M across 42 NAICS → misses 72%"*. Show THEIR number on OUR
page and their figure becomes evidence for us. **Suppressed on the dominant path**, where we and
the NAICS tool use the same code and the line would be a lie the report tells about itself.

### 🐛 KNOWN, UNFIXED: keyword-coverage measures 1 FY, everything else measures 3
`keywordCoverage`/`codeMarketSize` use `fiscalYearTimePeriod()` (**one** FY); `MARKET_SPEND_WINDOW`
(fpds-top-n, TMR, find-agencies) is **three** FYs. So a report's headline total and its agency
table sit on different windows (drones $243M vs agencies summing to $347M). Invisible unless
someone sums the agency column — no single row contradicts the headline. Aligning would move every
public keyword total **1.6–3.5×** ("drones = $243M" → **$384M**, a figure used in marketing), bust
the TMR cache (`SPEND_SCHEMA_VERSION`), and regress `medical staffing`'s lead (561320 Temp Help →
621999 catch-all). Measured across 10 keywords: 8/10 unchanged, 2 gate flips (demolition, medical
staffing). **A product decision, not a bug to quietly fix.**

---
