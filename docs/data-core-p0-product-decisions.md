# Data Core P0 Product Decisions

**Status: DECISION SUPPORT ONLY — nothing implemented, no file edited, no copy
changed, no data source switched, no store merged.**
**Date: 2026-09-12 · Inputs: census 0A–0D (#1445–#1448), controls plan (#1449), Phase 1 (#1450)**

> A control cannot decide what the product means.

Both decisions were correctly refused by Phase 1. Each is traced to live code
below, with options and one recommendation.

---

# Decision 1 — Agency SAT Friendliness

## Current behavior

`src/data/agency-sat-friendliness.json` → 19 agencies, each with
`satPercent`, `microPercent`, `level`, `badge`.

**Read by three files** (resolved imports, comments stripped):

| File | Surface | Customer-facing? |
|---|---|---|
| `src/app/api/cron/send-notifications/route.ts:42` | daily alert emails | ✅ **yes** |
| `src/lib/briefings/delivery/sam-green-email-template.ts:12` | Daily Market Intel email | ✅ **yes** |
| `src/app/api/admin/send-all-briefings/route.ts:22` | admin trigger of the same emails | via the above |

## Evidence — ⚠️ THE CENSUS FRAMING WAS INCOMPLETE

Phase 0B recorded *"19 opinion-based percentages rendered as badges in customer
alert emails."* **Tracing the render path shows the percentages are NOT rendered.**

```ts
// sam-green-email-template.ts:856
const renderBadge = (label: string, style: string): string =>
  `<span style="...">${escapeHtml(label)}</span>`;

// :910
satInfo.badge ? renderBadge(satInfo.badge, getSatBadgeStyle(satInfo.level)) : ''
```

`renderBadge` receives **only `satInfo.badge`** — a string. `satPercent` is
returned by `getSatBadgeForAgency` and used **nowhere in any customer output**;
it is consumed internally, and `level` selects the badge colour.

**What a customer actually sees**, across all 19 agencies:

| Badge | Agencies |
|---|---|
| `✅ Easy Entry` | 9 |
| `🏷️ SAT-Friendly` | 8 |
| *(none rendered)* | 2 (`badge: null`, `level: low`) |

**No percentage, no methodology, no source, no "as of" date is shown to the
customer.** There is no link to a derivation.

So the live defect is **narrower and different** than the census recorded: it is
not fake precision on screen — it is an **unreproducible editorial label** on
19 of ~250–307 agencies (~6–8% coverage), with no stated bound.

### A reproducible derivation ALREADY EXISTS in the codebase

`src/app/api/reports/generate-all/route.ts:871` computes the same concept from
live award data:

```ts
const satPercent = totalCount > 0 ? (satCount / totalCount) * 100 : 0;
const microPercent = totalCount > 0 ? (microCount / totalCount) * 100 : 0;
const accessibilityLevel = satPercent > 50 ? 'high' : satPercent > 25 ? 'moderate' : 'low';
```

fed by `satContractCount` / `microContractCount` / `contractCount` flowing from
`find-agencies`. **The product already knows how to derive this measurably** —
the static JSON is a parallel, frozen, unreproducible copy of a computation that
exists elsewhere. That is class 5 (duplicate stores) as much as class 2.

## Product risk

| Risk | Severity |
|---|---|
| A contractor decides where to pursue based on "✅ Easy Entry" | **Real** — the label's entire purpose is to influence targeting |
| Fake precision on screen | **None** — no number is displayed |
| Silent coverage bound (19 of ~250–307 agencies) | **Moderate** — absence of a badge reads as "not easy," but is usually just absence of data |
| Values drift from reality | **Real and unbounded** — `_updated: 2026-04-16`, no producer, no mechanism to recompute |
| Registry says "re-derive or remove" and it still ships | **Governance** — flagging is not a control (Phase 0B) |

## Options

### A. Keep as a measured percentage
Wire the badge to the existing `generate-all` derivation and show the figure with
its basis. **Valid** — a reproducible formula and defensible source exist.
*Cost:* the email path has no `find-agencies` call today; it would need one, or a
precomputed table. Adds per-send latency or a new pipeline.

### B. Keep as an editorial / heuristic signal ✅
Keep the **labels** (which is all that ships today), and make their editorial
status explicit and bounded — no percentage unless measured.
*Cost:* copy work only. Preserves the customer-visible behaviour that exists.

### C. Remove from customer output
Delete the badges.
*Cost:* loses a targeting signal customers may use; discards a real if
unreproducible judgment.

## Recommendation — **B now, A as the successor**

**B, because the product is already behaving as B** — it renders labels, not
numbers. Option B makes the honest thing explicit rather than changing what
customers see: mark the signal as editorial, state the coverage bound (19
agencies), and keep the percentages as internal threshold inputs, never as output.

**Not C:** the signal is used at the right moment (choosing where to pursue) and
a reproducible derivation exists — deleting it discards value that can be earned
back.

**Not A now:** A is the correct end state, but it changes the send path and
needs a precompute decision. Doing B first costs a copy change and removes the
integrity contradiction immediately; A can follow without another product
decision.

This also matches the Phase 0A taxonomy: an **honest limitation** (Yellow) is
partial coverage *represented honestly*. Today the coverage bound is unstated,
which is what makes it Red. B is precisely the move from Red to Yellow.

## What would change if approved
- `agency-sat-friendliness.json` gains explicit `_basis` / `_coverage` metadata (editorial, 19 agencies, as-of date).
- Badge copy states the signal is a heuristic, not a measurement.
- `satPercent` / `microPercent` are documented as **internal threshold inputs, never customer output**.
- The registry's "re-derive or remove" note is replaced by a decision record pointing at A as the successor.
- **No percentage is added to any email.**

## What remains unknown
- Whether any customer has acted on a badge (no engagement instrumentation on it was found).
- Whether the 19 agencies were chosen by volume, by editorial judgment, or arbitrarily — **the selection criterion is unrecorded**.
- Whether `generate-all`'s SAT figures would reproduce the 19 hand-set values (not measured; would require running that path per agency).

---

# Decision 2 — Contractor Corpus

## Current behavior

**Resolved surface → source matrix** (imports and query refs, comments stripped):

| Surface | Source | Fallback | Customer-facing |
|---|---|---|---|
| `/contractors` **index** | `src/data/contractors.json` (static, 2,768 → ~2,710 deduped) | none | ✅ public SEO |
| `/contractors/[slug]` **profile** | **BigQuery** `recipients` / `recipients_rollup_merged` | `contractors.json` for unresolved slugs | ✅ public SEO |
| `/api/contractors/search-bq` | **BigQuery** `searchRecipients({ liveBq: true })` | none | ✅ in-app (authed) |
| `/api/contractors` | `src/lib/contractor-database.ts` → `contractors.json` | none | ✅ |
| `/api/teaming/suggest` | `contractors.json` | none | ✅ |
| `/api/dsbs-scorer/benchmark` | `contractors.json` | none | ✅ |

**The index and the profile pages disagree about what the database is.**

## Evidence

- `page.tsx:41` metadata: **"290,000+ Federal Contractors"**; body renders `totalCount` ≈ **2,710**. **107×.**
- The 290K claim is **true of BigQuery** — `marketing-stats.ts:31` documents `recipients_rollup_merged` = 292,848; Phase 0D measured **296,445** live.
- `contractors.json`: **no producer exists**, introduced `b3590dc4` (2025-12-27), **1 commit, frozen 8.5 months**.
- Contact coverage in the static store: `sblo_name` **2.6%**, `email` **1.4%**, `phone` **1.2%**.
- `registry.ts:203` claims `coveragePercent: 95` for Contractors (C2 now prints this contradiction every run).

## Corpus map

| Store | Rows | Unique value | Producer |
|---|---|---|---|
| BigQuery `recipients_rollup_merged` | **296,445** | the full award universe; one row per company; `child_ueis[]` | `build-derived.sql` ✅ |
| `contractors.json` | 2,768 | **contact fields**: `sblo_name`, `email`, `phone`, `has_subcontract_plan`, `agencies` | ❌ none |
| `prime-contractors-database.json` | 3,502 | curated SBLO + award context (`supplierPortal`) | importer only |
| `sblo-roster-2026-06.json` | 200 | canonical Jun-2026 SBLO research | ❌ manual |
| `tier2-contractors-database.json` | 207 | unknown; name collides with the `tier2_sblo` key | ❌ unknown |

**Field ownership is genuinely disjoint.** BigQuery has `recipient_name`, `uei`,
`total_obligated`, `award_count`, `naics`, `state`, `city`, `child_ueis` — and
**no contact data at all**. The static stores have contacts and no award universe.
`sblo-lookup.ts` already documents this ("BigQuery has award data, NOT
liaison-officer contacts").

## Cost / latency constraint (decisive)

`src/lib/bigquery/recipients.ts:164` — public SEO callers are **deliberately
cache-only**; only authed Mindy callers pass `liveBq: true`, because a cold BQ
scan on public traffic is what exhausts the daily query quota (`cache.ts`
documents that exhausting it makes **every** query fail project-wide for a day).

The `/contractors` index is `revalidate = 86_400` and statically generated — so
**"just point the index at BigQuery" is not free**. It needs a cached/derived
listing, not a live scan.

## Options

### A. BigQuery is canonical
Index, search and slugs all derive from `recipients_rollup_merged`; static JSON
becomes fallback/enrichment only.
*Pro:* one answer to "what is the contractor database?"; the 290K claim becomes
true everywhere. *Con:* the index needs a cached derivation (cost guard above);
**contact fields have no BigQuery home** and would be orphaned.

### B. Curated store is canonical
The small corpus is the product; change "290,000+" to ~2,700.
*Pro:* honest immediately, no infra. *Con:* **discards the real moat** — 296,445
companies with live award history — and contradicts `[slug]` pages already
serving from BQ. Would make the product smaller than it is.

### C. Hybrid with explicit roles ✅
Each store gets one job and each surface names its population.

## Recommendation — **C, with these precise roles**

| Store | Role | Serves | Claim it may make |
|---|---|---|---|
| **BigQuery `recipients_rollup_merged`** | **the canonical contractor population** | `/contractors` index (via a cached derivation), search, `[slug]` | "296,000+ federal contractors" — the only store allowed to make a corpus-size claim |
| `contractors.json` | **enrichment overlay only** (contact fields) | teaming suggest, DSBS benchmark, `[slug]` fallback | may claim nothing about corpus size; must state its own contact coverage |
| `sblo-roster-2026-06.json` | **the SBLO/teaming contact layer** (canonical, Jun-2026) | `get_sblo_contact` | already correct, already documented |
| `prime-contractors-database.json` | broader SBLO fallback, older provenance | `sblo-lookup` tier 2 | unchanged |
| `tier2-contractors-database.json` | **unresolved — needs disposition** | 2 consumers | none until traced |

**Why C over A:** A is the right *direction* and C encodes it — BigQuery becomes
canonical for the **population**. But A as stated orphans the contact fields,
which have no BigQuery home and are the only reason the static store exists. C
gets A's coherence without deleting a capability.

**Why C over B:** B would shrink the advertised product to 1% of the real corpus
while `[slug]` pages already serve 296,445 companies. It makes the index honest
by making the product wrong.

**The rule C enforces:** *only the canonical population store may make a
corpus-size claim.* That single sentence resolves the 107× title/body defect
without choosing between "the title is wrong" and "the body is wrong" — the title
is right about BigQuery, and the body must therefore come from BigQuery too.

## What would change if approved
- `/contractors` index derives its listing from a **cached** BigQuery derivation (respecting the `liveBq` cost guard) — **not a live scan**.
- The index body and its title then describe the same population.
- `contractors.json` is re-scoped to enrichment; `registry.ts`'s `coveragePercent: 95` is either derived from the contact fields or deleted (C2 keeps printing until then).
- `tier2-contractors-database.json` gets a disposition pass.
- **No store is deleted or merged in this change.**

## What remains unknown
- Whether a cached BQ-derived index can hold the current SEO ranking (title already claims 290K, so the *claim* is stable; the **listing contents** would change).
- Whether the 132 unmerged roster companies (Phase 0A) belong in the enrichment overlay.
- What `tier2-contractors-database.json` (207 rows) is for — **still untraced**.
- Whether `/api/teaming/suggest` and `/api/dsbs-scorer/benchmark` degrade acceptably at 1.4% email coverage — **not measured**.

---

# Cross-cutting principle

> **Which numbers are measurements, which are editorial judgments, and which
> datasets are canonical populations?**

| Category | Definition | Examples found in the census | Rule |
|---|---|---|---|
| **Measurement** | Derived from a source by a stated, reproducible formula; can be recomputed and will change when reality changes | `bq_awards max(action_date)`; `naics_vocabulary` 25,252; `generate-all`'s `satPercent = satCount/totalCount`; TMR spend totals | May be stated as a number. **Must** carry its basis and an as-of date. |
| **Editorial judgment** | A human ranking/label that encodes experience, not arithmetic | the SAT `✅ Easy Entry` badge; `agency-sat-friendliness` levels; the 19-agency selection | May be shown as a **label**, never as a percentage. Must state that it is a judgment and its coverage bound. |
| **Canonical population** | The one store that defines "how many of X exist" | BigQuery `recipients_rollup_merged` (contractors); `sam_opportunities` (open opps); `sblo-roster-2026-06` (SBLO contacts) | **Only the canonical store may make a corpus-size claim.** Every other store is an overlay and must say which population it covers. |

**The blur is the bug.** Every P0 in this memo is one category wearing another's
clothes: an editorial judgment carrying a numeric percentage
(`agency-sat-friendliness`), an enrichment overlay making a corpus claim
(`/contractors` index), and a hardcoded literal impersonating a measurement
(`coveragePercent: 95`). Keeping the three categories distinct — and labelling
each dataset with exactly one — prevents the whole class, which is why this
principle belongs above both decisions rather than inside either.

---

# Compliance

**Nothing implemented.** No file edited beyond this document. `agency-sat-friendliness.json`
unchanged; no percentage removed; no email copy changed; `/contractors` unchanged;
no data source switched; no store merged; no BigQuery query altered; no fallback
edited; no registry row added or deleted; no provenance repaired; no contacts
backfilled; no customer-facing behaviour changed.

**Awaiting approval on both recommendations before any implementation.**
