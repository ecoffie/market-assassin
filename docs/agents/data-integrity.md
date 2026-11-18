# Data integrity rules and gates

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## 📐 A number is a product feature — READ before building anything that DISPLAYS a number

**`docs/engineering/a-number-is-a-product-feature.md`** is the frozen principle (Eric,
2026-08-23). If Mindy displays `10,667`, `47%`, `$1.8B`, `80 suppliers` or `3.4 bidders`, that
number gets the same discipline as a button or an API: **provenance · completeness · current
semantics · honest failure · a test**.

**Why it is a rule and not a preference:** the audit found the failure mode twice, and neither
instance crashed anything. `onboarding-funnel` made drop-off look worse than reality;
`admin/user-breakdown` reported **1,000 users when the truth was 10,667**. Eric: *"Mindy's most
dangerous data bugs are not errors that crash the product; they are numbers that look plausible
enough to influence a decision"* — the cap *"was not creating small errors. It was creating
different realities."*

Two rules fall out, both already enforced in code: **don't assert what the system can derive**
(the integrity block's audit date reads the ledger — a hand-typed date would be a tiny factual
error inside the dashboard built to prevent tiny factual errors), and **don't turn unknown into
zero** (`count ?? 0` on a missing table is fabrication — see Bug Prevention Rule #11).

**Integrity OS (Phase 1, shipped 2026-08-23)** — `docs/PRD-integrity-os-phase1.md` +
`src/lib/integrity/contracts.ts`. The enforcement layer underneath Mindy, not a dashboard:
*Mindy should never make a consequential claim without being able to establish the evidence
supporting it.* `canDefendClaim(kind, evidence)` refuses a claim and cites the failure class.
⚠️ **HARD CONSTRAINT, enforced by CI:** every contract must trace to an `INT-###` class from the
completed audit — `contracts.unit.test.ts` fails the build on an untraceable type, a nonexistent
class id, or anyone adding a SCORE (a composite hides the uncertainty it should surface). **4 of
11 classes have automated controls**; Phase 2 is closing that gap, and the maturity measure is
"every known class has a control", not "a linter catches everything".

**The silent-failure registry** — `docs/engineering/silent-failure-registry.md` — catalogues the
9 classes this audit found, each with the real instance behind it (truncated list as population ·
`null → 0` · **missing relation masquerading as empty** · legacy classification · capped RETURNING
receipt · **dead operation reported as success** · **monitoring query itself incomplete** ·
diagnostic probe itself invalid · **edit command succeeds without the intended change**). Read it
before adding a data surface. Two rules from it: **no source ≠ zero** (unestablished query →
`unknown`, never `0`) and **no execution ≠ success** (a job needs evidence of its intended effect,
not just no exception).

**"The filters are broken" is usually NOT the filters** — `docs/engineering/filter-investigation-rule.md`
(frozen 2026-09-12). Before touching filter code: read the user's EXACT saved filter from
`saved_searches.filters` (not a paraphrase) and compare **total truth vs surface-visible truth**.
The 2026-09-12 Opportunity Map incident found 7 filter defects, 4 of them real and one severe
(multi-state failed OPEN to the ENTIRE corpus, PR #1435) — and **none was the cause**. Only 4.7%
of open opps had coordinates, so every filter was correct and a user with 42 real matches saw "1".
Geocoding took coverage 4.66% → 95.66% and `naics=541611` from **0 → 22**. Second half of the rule,
also learned the hard way: an APPROXIMATED saved search is a DIFFERENT search — dropping `fullOpen`
and using NAICS prefixes where the user saved exact 6-digit codes made a healthy map look 99%
broken *inside the incident report itself* (reported 31/24/42, actual 1/6/3). Permanent guard:
**market truth != mappable count** (`src/lib/opportunities/map-truth-disclosure.ts` + its gate).

**Two rules frozen 2026-08-23, both learned the hard way:** (1) **never infer write impact from a
capped RETURNING payload** — `UPDATE … .select()` updates every row but returns at most 1,000, so
counting it under-reports; use `{ count: 'exact' }` and treat a null count as unknown, not zero.
(2) **a verification must prove the change actually landed** — a string-replace whose anchor misses
writes nothing and exits 0, so re-read the target after every programmatic edit and prefer a
per-line audit over a summary count.

**Check the live state first:** `GET /api/admin/platform-health` → `decisionMetricsIntegrity`.
It reports the RISK SPLIT, not a warning count — currently **0 operational / 63 admin-review**
material risks, 23 documented-bounded, 10/10 claim routes verified. **Triage rule for what
remains:** fix only when a route can materially change a human decision or silently mutate
incomplete data; otherwise prove boundedness and document the waiver. Any NEW claim-producing
route starts in `CLAIM_ROUTES_UNVERIFIED` and is only promoted after a human verifies all four
checks against live data — verified is EARNED, not a label that decays.

The goal is **not zero warnings**; it is *no important decision made from a number Mindy cannot
defend*. This matters most in the government market: a contractor seeing a wrong dashboard count
is bad, a **contracting officer** using a wrong supplier count or competition measure in an
**acquisition decision** is a much higher bar — which is why this work is infrastructure for the
government product, not a detour from it. **Analytics cleanup is NOT the current priority** —
see "Current priority order" below.

---

## Bug Prevention Rules

1. **Never `continue` after Supabase failure** — always run KV operations unconditionally.
2. **Never match comma-joined strings directly** — split on delimiters first.
3. **Formatting must be consistent server + client** — markdown must render correctly.
4. **Always persist state after generation** — upsert to database immediately.
5. **Arrays must be `.join(' ')` not interpolated** — avoid `${array}` producing comma-joined.
6. **Never `.slice()` user data silently** — make caps explicit or configurable.
7. **Use unified `user_notification_settings` table** — Old tables (`user_alert_settings`, `user_briefing_profile`) were dropped. All code uses unified table now.
8. **Always add fallback NAICS** — If user has no NAICS, use defaults: `541512, 541611, 541330, 541990, 561210`.
9. **Supabase LIKE uses `%` not `*`** — For pattern matching, use `naics_code.like.236%` not `naics_code.like.236*`. The `*` wildcard returns 0 results.
10. **All KV operations must have try-catch fallback** — KV quota can be exceeded (500K requests/month on free tier). Functions must gracefully degrade: rate limits allow requests, abuse checks return false, access checks return null. See `src/lib/abuse-detection.ts` and `src/lib/access-codes.ts` for patterns.
11. **`count ?? 0` is DATA FABRICATION — a null count means UNKNOWN, never zero.** Measured:
    a table that does NOT exist returns `count=null, error=null, HTTP 204` — **no error at all**
    (a real empty table returns `count=0, 200`). So `?? 0` destroys the only signal separating
    *missing* from *empty*, and the zero is usually load-bearing. Bind `{ count, error }`,
    **throw/surface** on error, and render null as `unknown` — never `0`. It reads as defensive
    null-handling; it is not. **What it has already cost:**
    `scripts/reset-mindy-user-activity.ts` — a null count hit `if (n === 0) continue` and
    **cancelled the delete** for five `vault_*` tables that never existed (the real ones are
    `user_identity_profile` / `user_past_performance` / `user_capabilities_library` /
    `user_team_members` / `user_boilerplate_docs` — names were guessed from the FEATURE name,
    not read from `20260526_profile_vault.sql`). It reported a clean `0 rows` for months, and
    `opportunity_shares` (keyed `sharer_email`, not `user_email`) survived every "reset" (#307).
    `cron/snapshot-metrics` — a swallowed 400 + `?? 0` recorded a real 0 for **nine days**
    (07-07 → 07-15, **190 emails erased**). The gate now blocks new instances (rule B below).

---

## The silent-failure gate (`scripts/audit-supabase-errors.mjs`, Jul 16-17 2026)

Runs as a hard-blocking step of the pre-push gate (see `.githooks/pre-push`
for current numbering). **Two rules, two different bugs:**

| Rule | Fires on | Fix |
|---|---|---|
| **A** swallowed-error read | `const { data } = await` with **no `error` bound** AND a hardcoded **multi-column** `.select('a, b')` (≥2 cols; `*` and single-col are ignored by design — they don't drift) | bind `{ data, error }`, surface it |
| **B** count-null | `count ?? 0` / `count \|\| 0` with no `error` bound **from the query** | see Bug Prevention Rule #11 |

**Baseline ratchet:** existing debt is recorded in `tests/fixtures/supabase-errors-baseline.json`
(**103** = 74 rule-A + 26 rule-B + 3 `.mjs`), so it blocks nothing today — anything **NEW** fails
the push. `--list` prints every finding; `--update-baseline` accepts the current set.
**Drive it toward zero; never re-baseline reflexively** (see the wart below).

**⚠️ It was blind on FOUR independent axes, each individually reasonable.** Fixing one proved
nothing about the others — every widening found the next one still hiding:

1. `EXCLUDE` skipped `/(admin|cron)/` and `scripts/` — *"they degrade loudly enough and aren't
   user-visible."* **Backwards.** Nobody reads a cron's stdout, so a silent read there is worse.
   That exclusion is why every scar came from those directories (#311).
2. `SCAN_ROOTS = ['src']` — never walked `scripts/` **at all**, so dropping the EXCLUDE alone
   would have changed nothing (#311).
3. No count-null rule — so unblinding still would NOT have caught #307. Rule A is structurally
   blind to it: a count query has no multi-column select, and the error may be bound correctly
   150 lines earlier and never consulted at the coalesce (#312).
4. The walk matched `/\.(ts|tsx)$/` — every `scripts/*.mjs` stayed invisible **to both rules**
   regardless (#314).

**Two traps if you edit the rules** (both were real, both found by testing not assuming):
- **Strip comments first.** Several fixes now QUOTE `count ?? 0` while explaining the bug.
  Flagging those is a false positive, and false positives are what make people reflexively
  `--update-baseline` and erode the ratchet.
- **A bare `/\berror\b/` token is not error handling.** It let `cron/pursuit-changes` through
  because an auth guard 5 lines up returns `NextResponse.json({ error: 'Unauthorized' })`.
  Require error genuinely bound from an `await` (or a `.error` read). That alone hid 5 sites.

**Prove a rule change, don't trust it:** inject the bad pattern into a real file → expect exit 1
→ revert → expect exit 0. A first attempt at this looked like the ratchet was broken; the probe
was a single-column select, which rule A ignores by design.

**Known wart:** the baseline keys on `path:line`, so an edit that shifts lines in a known file
surfaces a **false NEW finding**. Re-baseline deliberately, never reflexively.

**Standout debt in the baseline (not fixed):** `admin/data-health` does `count || 0` with no
error bound — the endpoint whose job is reporting data health would report a fabricated 0.

---

## The rank-then-filter gate (`scripts/audit-rank-then-filter.mjs`, Jul 2026)

Runs as a hard-blocking step of the pre-push gate (see `.githooks/pre-push`
for current numbering). Catches the **"rank globally, then filter to a user's scope"** bug
class at its source. (Memory: `rank_then_filter_starves_local`.)

**The bug, in one line:** a query RANKS by dollars (`sortBy:'total_obligated'` / an award
fetch ordered by amount) with a `limit`, and its result is shown on a SCOPED view (a map
viewport / state / NAICS / agency segment) — but the scope filter is applied AFTER the
rank+limit instead of INSIDE the fetch. So the top-N globally is all national whales
(MIT / Raytheon / L3Harris) and the actual local/segment firms never survive the limit to
reach the post-filter. **The scope filter must come BEFORE the limit, never after.**

This exact class hit the **Opportunity Map THREE times** — companies map, value-range, and
initial zoom — each a `searchRecipients({ sortBy:'total_obligated', limit:N })` that ranked
over the whole 317K-firm corpus and only then narrowed to the viewport, so a state with no
top-100-national firm rendered an empty map. **#457** fixed the companies map by threading
`state` INTO the `searchRecipients` call. This gate stops the next `companiesPins`-style
regression from shipping.

**The rule (a tuned line-scan over the ranked-fetch HELPERS, not a SQL/AST parser).** A call
is FLAGGED when ALL of:
1. It calls a ranked-fetch helper — `searchRecipients` / `findCapableSmallBusinesses` /
   `searchAwardsByLocation`. (These encapsulate the ranked fetch and take flat scope params,
   so a call site is reliably classifiable — a raw `spending_by_award` fetch hides its scope
   in a POST body and is NOT, so it's deliberately out of scope; the companiesPins class
   always goes through a helper.)
2. It's ranked by dollars + limited — `sortBy:'total_obligated'` (or `searchAwardsByLocation`,
   which always orders by amount desc) AND a `limit`.
3. It passes NO scope in the SAME call — none of `state`/`naics`/`psc`/`agency`/`recipient`/
   `bbox`. (This is exactly what #457 added — the fix is a scope arg on the ranked call.)
4. The surrounding ~40 lines SCOPE the result afterward (`bbox`/`inBbox`/`viewport`/`Pins`/
   `.filter(`/a `state`/`naics` narrowing) — the "then filter" tell. Without it a global
   ranking is a legitimate national listicle, so it does NOT flag.

Two guards learned by testing: **strip comments first** (a fix that quotes `sortBy:'total_obligated'`
while explaining it must not flag), and **skip the helper's own `function` definition** (the
lib file names the helper but isn't calling it — that was a false positive on `awards-search.ts`).

**Baseline ratchet:** `tests/fixtures/rank-then-filter-baseline.json`, keyed on `path:line` +
a short snippet (the snippet reduces the `path:line`-drift false-NEW that bites the sibling
gates). `--list` prints every finding; `--update-baseline` accepts the current set. Exit 0 =
no NEW findings; exit 1 = a new site blocks the push. **Baselined at 1:**
`src/lib/gov-contacts/sblo-lookup.ts:192` — a company-NAME lookup (`search: companyName`) that
ranks by $ only to pick the biggest substring match for a single named prime, then re-selects
by closest normalized name; genuinely global (resolving one company, not a scoped listing), so
it's OK. **Prove a rule change, don't trust it:** inject a scopeless
`searchRecipients({ sortBy:'total_obligated', limit:100 })` into a bbox-filtered function →
expect exit 1 → add `state` → expect exit 0 → revert (done when this gate shipped).

---
