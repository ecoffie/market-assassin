# Silent failure registry

**The classes discovered by the data & measurement integrity audit, 2026-08-23.**

> Systems that can produce a **successful-looking answer** without having successfully measured
> or executed the thing they claim to represent.
> — Eric

None of these throw. Each one returns a plausible result that a human then acts on. That is what
makes them different from ordinary bugs, and why they survived years of green builds.

---

**Machine-readable half:** `src/lib/integrity/failure-classes.ts` (stable `INT-###` ids, the
detector for each, and `undetectedClasses()` — the honest backlog of classes no gate catches yet).

**⚠️ This registry is EVIDENCE, not architecture.** The audit is requirements discovery for a
future integrity system; the taxonomy gets frozen and the contracts designed only when the audit
reaches **zero unresolved findings** — not zero warnings. A first attempt at those contracts was
written on 2026-08-23 and deliberately reverted for being ahead of the evidence.

## MARKET STATE vs EVIDENCE STATE (frozen 2026-08-23)

> **Limited competition = a claim about the market. Unknown competition = a claim about Mindy's
> evidence. Those must never collapse into each other.** — Eric

The same intellectual error in different clothes — every line below is a real or narrowly
avoided instance in this codebase:

| evidence failure | must NOT become |
|---|---|
| no bidder data available | zero bidders |
| supplier qualification unknown | supplier unqualified |
| no observed PSNS award | never worked with PSNS |
| no engagement instrumentation | zero usage |
| source unavailable | zero records |
| count query failed | zero suppliers (→ a FAR 19 set-aside recommendation) |
| USASpending fetch failed | **a niche market** (found live in `market-scan`, 3 exit paths) |

Vocabulary: `assessMarket()` / `MarketAssessment` in `src/lib/integrity/claim-contract.ts`. An
indeterminate market renders as `undetermined — <why>` and can never borrow a market word.

## The two rules these waves produced

### No source ≠ zero
If the underlying relation or query **cannot be established**, the measurement is `unknown` or
`missingSource` — **never `0`**. A zero is a claim about the world; absence of a source is a
claim about our own plumbing, and conflating them fabricates data.

### No execution ≠ success
A job can be **technically error-free while accomplishing none of its intended work**.
Operational success requires **evidence of the intended effect**, not merely the absence of an
exception. A cron that skipped every user is a failed run, not a successful one.

---

## The registry

| # | Class | What it looks like | Real instance found |
|---|---|---|---|
| 1 | **Truncated list treated as population** | 1,000 rows returned, no error, no flag; caller calls it "all" | `user-breakdown` reported **1,000 users** of **10,667** |
| 2 | **`null → 0` fabricated measurement** | `count ?? 0` turns "I don't know" into a load-bearing zero | `snapshot-metrics` recorded 9 days of fake zeros (190 emails erased) |
| 3 | **Missing relation masquerading as empty** | Table doesn't exist → `count=null, HTTP 204, error=null` — *no error at all* | `forecasts?mode=coverage` reported **0 sources / 80% gap**; real: 11 sources / **94.5%** |
| 4 | **Legacy classification against current data** | Matcher still hunting a shape the product stopped emitting | `feature-usage` matched legacy URLs after consolidation → **0 views** for every feature |
| 5 | **Capped RETURNING receipt on an uncapped mutation** | The write touches every row; the receipt returns ≤1,000 | recompete prune under-reported against a **137,186-row** candidate set |
| 6 | **Dead operation reported as success** | Nothing happened; the job returns `success: true` | `weekly-digest` skipped **every** user (its table doesn't exist) and reported success |
| 7 | **Monitoring query itself incomplete** | The guard cannot see the population it guards | `email-guard` read ~1,000 of **2,633** daily sends — the over-send monitor under-reported over-senders |
| 8 | **Diagnostic probe itself invalid** | The measurement tool has the bug it is measuring | a probe sampling `alert_log` hit the same 1,000-row cap; a `curl -w` printed blank and was read as "HTTP 000 / network blocked"; a deploy-status poll matched the TABLE HEADER instead of a deployment row, so it never observed the status change |
| 9 | **Edit command succeeds without the intended change** | A string-replace whose anchor misses **writes nothing and exits 0** | `aggregate-profiles` shipped "fixed" and unchanged; recurred 3 more times the same day |
| 10 | **Partial population corrupts ORDERING, not just counts** | A ranking / "top N" computed over a truncated read. No count is displayed, so nothing looks wrong — but the ORDER is what the human acts on | `target-market-research` ranked agencies from **6.6%** of open notices; which agency was #1 depended on the first page |
| 11 | **Truncation BEFORE batching = a permanently unreachable segment** | The audience is truncated, *then* filtered and batched — so rows past the cap never reach the cursor and **re-running never helps** | `weekly-alerts` (~1,028 users never queued on any cycle) and `send-alert-invite` (1,000 of 10,670) |

---

## The verification chain

Class 9 happened **twice**, so an editing command returning successfully is no longer evidence.
Every code change now runs the full chain:

```
edit succeeded → intended text/code EXISTS in the target → behavior test passes
              → production behavior verified where applicable
```

Concretely: grep or read back the target symbol **after** writing, then run the test, then check
the live surface. And a green local build is **not** a Vercel build — `merged` is not `deployed`
(a route that `require()`d a script outside the app bundle compiled locally and failed on
Vercel, so prod silently served old code).

---

## Class 8 in practice: a probe must prove it is observing its subject

**2026-08-26.** A background loop waited for a Vercel production build:

```bash
vercel ls --prod | grep -m1 "Production" | grep -oE "● (Ready|Building|Error)"
```

`-m1 "Production"` matched the **column header** (`... Environment ...`), not a deployment
row. The status extraction then found nothing, the loop never saw `Ready`, and the build was
reported as "still building" for **10 minutes after it had actually finished in 3**. The
deploy was healthy the entire time; only the measurement was broken.

Nothing errored. The loop ran, exited cleanly on kill, and produced a confident wrong answer
about production state — which is the whole point of this registry: *the dangerous failures
are not the ones that crash.*

**The rule:** a probe must establish that it is reading a row that describes its subject,
not merely text that pattern-matches. Concretely:

- **Anchor on a field only a real record has** — a URL, an id, a timestamp — never on a word
  that also appears in a header, a legend, or a label.
- **Assert the match is non-empty before interpreting it.** An empty capture means *did not
  observe*, never *not yet true* — the same `unknown ≠ zero` rule this registry applies to
  counts, applied to status.
- **Prefer a structured source over scraped text** where one exists (`--json`, an API), since
  column layout is not a contract.
- **Prove it can flip.** A watcher that has never once emitted its success line is
  indistinguishable from a watcher that cannot.

Silence from a probe is not evidence of the thing not having happened. It is evidence of
nothing at all.

## Why this is worth more than the finding count

The engineering outcome is not a set of corrected routes. It is a sharper definition of five
words the product uses constantly:

- **known** — we measured it, and can point at the source
- **zero** — measured as none, distinct from unmeasured
- **success** — the intended effect happened, not merely no exception
- **complete** — the whole population, not the first page
- **verified** — a human checked all four against live data, and the check could have failed

## See also
- `docs/engineering/a-number-is-a-product-feature.md` — the standing principle
- `docs/engineering/postgrest-1000-row-cap.md` — the mechanism behind classes 1 and 5
- `GET /api/admin/platform-health` → `decisionMetricsIntegrity` — the live state
