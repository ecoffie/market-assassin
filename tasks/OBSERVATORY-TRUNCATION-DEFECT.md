# Observatory truncation defect (data integrity — HIGH)

**Found:** 2026-08-24, by the `audit-oversized-limits` guard built for the awards incident.
**Status:** OPEN. Captured deliberately outside the awards PR. Fix immediately after the
refresh worker is proven.

## What is wrong

Six Observatory query sites request far more rows than PostgREST will ever return.
`db-max-rows` is 1,000. `.limit(200000)` does not raise that ceiling — it returns
**1,000 rows and no error**. Every metric derived from those rows is computed from a
non-random prefix of the table (whatever the default order returns) and then presented
as a corpus-wide figure.

This is the same failure that cost getmindy.ai ~86% of its search impressions. It is not
a lint preference; it is a wrong number on a page.

## Expected versus observed

Measured against production, 2026-08-24:

| Query site | Rows it needs | Rows it receives | Coverage |
|---|---|---|---|
| `corpus()` — `observatory.ts:85` | 161,967 | 1,000 | 0.6% |
| `returnBehavior()` — `observatory.ts:145` | 161,967 | 1,000 | 0.6% |
| `attentionByAgency()` — `observatory.ts:175` | 5,485 | 1,000 | 18.2% |
| `discoveryIndex()` — `observatory.ts:200` | 24,810 | 1,000 | 4.0% |
| `decisionTime()` — `observatory.ts:242` | 2,022 | 1,000 | 49.5% |
| `report-intel.mjs` (4 sites) | up to 161,967 | 1,000 | 0.6%+ |

## The headline error

`corpus()` reports distinct users by building a `Set` over the rows it received:

    const { data } = await sb.from('user_engagement').select('user_email, created_at').limit(200000);
    const users = new Set(rows.map(r => r.user_email).filter(Boolean)).size;

Measured directly:

- **Displayed:** 23 distinct users
- **Actual:** 2,579 distinct users
- **Error:** −99.1%

`lastDay` is also wrong (2026-08-24 displayed vs 2026-08-25 actual) because the newest
events fall outside the truncated window. `returnBehavior()` builds its entire
distinct-active-days-per-user curve from the same 1,000 rows, so its `n` and every
percentile in the habit curve inherit the same 0.6% sample.

## Affected metrics and reports

Behavior domain only. The supply-side metrics use exact `head: true` counts and are
unaffected — that distinction matters and should survive the fix.

- `corpus` — events / **users** / firstDay / **lastDay**
- `return_behavior` — the habit curve, and its `n`
- `attention_by_agency` — rank order (already self-discloses the cap; see below)
- `discovery_index` — browse-without-pursue ratio
- `decision_time` — average discovery → pursuit
- `scripts/report-intel.mjs` — the same five, wherever that script's output was used

Output channels declared on these metrics: `annual`, `white_paper`, `press`, `weekly`.

## Were these published?

**Unresolved — must be answered before any restatement.** The metrics declare `press`
and `white_paper` channels, so the question is whether anything reached an external
audience carrying the wrong user count. Check the annual/white-paper drafts and any
outbound deck for a distinct-user figure near 23, or any habit-curve `n` under ~100.

Not every site is equally silent. `attentionByAgency()` already carries an honest note —
"Rank order from a N-event sample (PostgREST 1000-row cap)" — and is labelled `beta`.
That one disclosed the constraint; the other five did not.

## Exact query sites

    src/lib/analytics/observatory.ts:85    .limit(200000)  user_engagement   corpus()
    src/lib/analytics/observatory.ts:145   .limit(200000)  user_engagement   returnBehavior()
    src/lib/analytics/observatory.ts:175   .limit(60000)   user_engagement   attentionByAgency()
    src/lib/analytics/observatory.ts:200   .limit(60000)   user_engagement   discoveryIndex()
    src/lib/analytics/observatory.ts:242   .limit(50000)   user_pipeline     decisionTime()
    scripts/report-intel.mjs:117           .limit(200000)  user_engagement
    scripts/report-intel.mjs:155           .limit(60000)   user_engagement
    scripts/report-intel.mjs:186           .limit(60000)   user_engagement
    scripts/report-intel.mjs:220           .limit(60000)   user_engagement

## Interim posture (do this before the fix lands)

Until repaired, **the Observatory must not describe these five metrics as complete or
production-grade.** Downgrade their maturity and state the sample honestly, the way
`attentionByAgency` already does. A wrong number labelled `beta` is a known limitation;
the same number labelled production-grade is a false claim.

## The fix

1. Distinct counts and min/max belong in the database, not in a JS `Set` over a page.
   Use an RPC or `{ count: 'exact', head: true }` — a distinct-user count should never
   be derived from a row pull at all.
2. Where rows genuinely must be materialised (the habit curve needs per-user day sets),
   page with `readAllPages()` from `src/lib/paged-read.ts` and **refuse to publish unless
   `exhausted` is true**. Partial data must degrade to a disclosed sample, never to a
   confident wrong number.
3. Remove each fixed call's baseline entry — the ratchet requires it.

---

# RESOLUTION (2026-08-25)

## What was done

All nine query sites were converted from row pulls to **in-database aggregates**.
Six new `SECURITY DEFINER` functions (migration `20260825_observatory_aggregates.sql`),
each returning ONE row — there is nothing left to truncate:

| Function | Replaces |
|---|---|
| `observatory_corpus()` | `corpus()` — events, distinct users, true date span |
| `observatory_return_behavior()` | the habit curve, whole population |
| `observatory_attention_by_agency(int)` | agency ranking |
| `observatory_discovery_index()` | browse-without-pursue |
| `observatory_decision_time()` | discovery → pursuit |
| `observatory_dna_attention(int)` | DNA strand tally |

Verified against ground truth, every figure exact:

| Metric | Before (truncated) | After | Truth |
|---|---|---|---|
| corpus distinct users | **23** | **2,788** | 2,788 ✓ |
| corpus events | 165,119 | 165,119 | 165,119 ✓ |
| agency-tagged events | 1,000 | 5,490 | 5,490 ✓ |
| decision rows | 1,000 | 2,144 | 2,144 ✓ |
| discovery opens | truncated | 502 | 502 ✓ |

Grants restricted to `service_role`; `anon` and `authenticated` verified DENIED by
role assumption. The oversized-limit baseline ratchet fired correctly and debt
dropped **52 → 43**.

## What the fix revealed

Making these metrics readable for the first time exposed two problems that
truncation had been hiding. Both are disclosed rather than published.

### 1. `decision_time` measures nothing (instrumentation defect)

**98.7% of stamped rows show a gap under one second** (2,117 of 2,144).
`discovered_at` is written at save time, not at discovery, so the column measures
the round-trip of a single click.

A near-zero median here is **not** the finding "contractors decide instantly" — it
is the finding "we are not capturing discovery." Publishing the former would have
been worse than publishing nothing. The metric now returns `maturity: 'research'`
with an explicit `NOT PUBLISHABLE — instrumentation defect` note.

Fixing truncation alone would have made a broken instrument look rigorous.

**Needs:** a real discovery event (first impression of an opportunity) before this
can report anything.

### 2. The DNA tally rests on a much smaller base than it appears

17,239 events carry a `dna` key, but **16,889 hold an EMPTY array**. Only 350
events contribute the 1,111 strand occurrences.

The aggregate was correct; the denominator was misleading. `observatory_dna_attention`
now returns `tagged_events` and `events_with_strands` separately, and the note
states the real base is 350, not 17,239.

## Was anything published?

**Still unresolved.** These metrics declare `press` and `white_paper` channels. The
question remains whether anything external carried the wrong user count — check any
annual/white-paper draft or outbound deck for a distinct-user figure near 23, or a
habit-curve `n` under ~100.

## Note on maturity labels

Several metrics stay `beta`/`collecting` after this fix. That is now honest for a
different reason: the constraint is **population size** (small, self-selected user
base), not **sampling**. The notes say so explicitly, because "directional because
the corpus is early" and "directional because we only read 0.6% of it" are very
different admissions.

---

# WHAT "FIXED" MEANS HERE (preserve this distinction)

**The system did not recover decision time. It correctly stopped claiming a result
that the current instrumentation cannot measure. That is the right outcome.**

This matters because the two look similar in a status report and are opposite in
substance. Four metrics genuinely recovered — they now compute over the complete
population instead of a 1,000-row prefix. `decision_time` did not recover and
should not be described as fixed: the repair's contribution there was to make a
broken instrument legible, and then to stop reporting it.

A metric that says "NOT PUBLISHABLE — instrumentation defect" is doing its job.
Do not treat its `research` maturity as a regression to be closed out.

## Deployed board — verified 2026-08-25 13:47 UTC

    CORPUS  events=165,155  users=2,788  span=2026-04-28 .. 2026-08-25

| metric | maturity | n | state |
|---|---|---|---|
| `sb_participation` | production | 37,192 | unaffected (exact head-counts) |
| `awarded_setaside_mix` | production | 51,208 | unaffected (exact head-counts) |
| `return_behavior` | beta | **2,788** | recovered — full population |
| `attention_by_agency` | beta | 61 | recovered — all 5,490 tagged events |
| `discovery_index` | collecting | 44 | recovered — complete counts |
| `decision_time` | **research** | 2,144 | **suppressed, not recovered** |

`decision_time` reports 2,143 of 2,144 rows stamped under one second apart.

## Open follow-ups

### A. Publication-history audit — COMPLETE (2026-08-25). No external exposure.

Swept docs, tasks, decks, drafts, and content across market-assassin, govcon-funnels,
govcon-shop, Bootcamp, and ~/docs for "23 users", cohort figures under 100,
habit-curve claims, and the stale "1,486 users".

**Result: no white paper, press draft, annual report, deck, published page, or sent
email states any figure derived from the truncated Observatory queries.** Every hit
was INTERNAL or an unbuilt DRAFT.

| Location | Figure | Class | Disposition |
|---|---|---|---|
| `docs/REPAIR-LEDGER.md` L108 | `1,486 users`, `return 95.7%/median 10`, attention ranking | INTERNAL | **Annotated in place** as SUPERSEDED — historical record preserved, not rewritten |
| `docs/strategy/mindy-enterprise-onepager.md` L77 | `~23 users` | INTERNAL | Already flagged stale by its own author; sits inside an explicit *"Internal note (not for the prospect)"* fence. Different metric (`mcp_call_log` MCP users), numeric coincidence only. Prospect-facing body carries zero engagement stats. |
| `docs/REPAIR-LEDGER.md` L108 | browse-vs-pursue 27 users, sharing 19 | INTERNAL | Same annotated row |
| `docs/AUGUST-30-CHECKPOINT.sql` L5–6 | `returned on 2+ days: 7 of 35` | INTERNAL | Sourced from `mcp_call_log`, not `user_engagement` — outside this defect's blast radius |
| `docs/strategy/PRD-procurement-intelligence-report.md` | decision-time, browse, attention | DRAFT | Marked `**Status:** SPEC (not built)`; uses the placeholder `"median decision time was N days"` — no figure ever committed |
| `src/content/institute/paper{1,3,4,5}*.md` | — | PUBLIC | **No behavioral figures at all.** Built on public FPDS/SAM supply-side data, which the defect never touched. Already relabeled "Research Concepts" pending a mature Observatory standard — that gate held. |

**Why nothing leaked:** the `/institute` papers were downgraded to "Research Concepts"
before publication precisely because the Observatory standard wasn't mature. A process
gate caught what the code did not.

**Residual gap (outside the filesystem):** Gmail, Slack, Google Drive, and live
getmindy.ai were not searched. Since these metrics declare `press` and `white_paper`
channels, a sent deck or email could exist beyond this audit's reach. Checking Drive
and sent mail would close it.

**A note on 2,579 vs 2,788:** the original writeup recorded 2,579 distinct users on
2026-08-24; verification on 2026-08-25 measured 2,788. Both are correct — the corpus
grew by ~209 users in a day. Neither figure is truncated, and the discrepancy is not
an inconsistency to reconcile.

### ~~A. Publication-history audit (not yet done)~~

Search reports, white papers, press drafts, blog posts, decks, and annual summaries
for claims derived from the truncated data. Look for:

- "23 users" or any distinct-user figure near it
- cohort sizes below 100
- habit-curve claims (median active days, return rate) with a small `n`

For each hit, record whether it was **internal**, **drafted**, or **publicly
released**. Correct public material if any exists — and do not silently overwrite
the historical record; a correction is itself part of the record.

### B. `discovered_at` instrumentation (separate product task)

Define `discovered_at` as **the first recorded impression of an opportunity** —
not save time, not open time, not pursue time. Then validate coverage before
republishing any decision-time metric. Until both are true, `decision_time`
stays `research` and reports no figure.
