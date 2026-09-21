# The 1,000-row cap is a data-integrity hazard

**Why two CI gates exist for one line of PostgREST behaviour. Read this before simplifying them away.**

Recorded 2026-08-22, after four separate incidents in a single day.

---

## The failure mode

> A query returns the first 1,000 rows, the caller treats that as the population, and the UI
> presents a plausible-but-wrong number.

PostgREST caps a response at **1,000 rows regardless of `.limit()`**. It does not error, does not
warn, and does not set a flag. `data.length === 1000` is the only tell, and nobody checks it
because the number that comes out the other end *looks fine*.

That is what makes this different from an ordinary bug. A crash announces itself. This produces a
confident, plausible figure that a human then acts on.

---

## The four incidents

All four happened on **2026-08-22**. Each was found by accident, not by a check.

### 1 · MCP adoption reported the wrong denominator

After the live session, an adoption query reported **"24 accounts all-time, 0 new."**
The truth was **59 accounts and 23 first-ever connections** — 70% growth in real users in a day.

Both figures were truncation artifacts: 1,779 rows exist, the select returned 1,000.

Caught only because *29 today vs 24 ever* is arithmetically impossible. Had the numbers been
merely low rather than self-contradictory, the strategy conversation would have proceeded on a
fabricated denominator.

### 2 · A drainer would have silently done 6% of its job

`drain-descriptions.ts` used `.limit(50000)` and received exactly 1,000 rows. It would have
resolved 1,000 of 17,748 descriptions **and printed a success summary**.

### 3 · The existing gate was aimed at the wrong half

`audit-unranged-selects.mjs` deliberately skipped read-only scripts. Its own comment argued:

> *"a read-only script that truncates prints a wrong number; a WRITING script that truncates
> mutates the wrong rows. Only the second is gated."*

Sound reasoning — until the numbers started driving priorities. A wrong number that reaches a
decision is not less costly than a wrong write; it is harder to detect, because nothing is
visibly broken.

### 4 · The reignite audience was computed from 1,000 of 8,802

`/api/admin/dashboard` → `getBootcampRollout`'s fallback path read `user_notification_settings`
with no `.range()` on a predicate matching **8,802 rows**.

`configuredReal` and `needsSetupReal` — the numbers that define who gets a re-engagement
campaign — were derived from the first 1,000 and reported as the whole population.

Proven against live data: the same predicate returns **1,000 unpaginated vs 8,802 paginated**.

---

## Why two gates, not one

| gate | scope | catches |
|---|---|---|
| `audit-unranged-selects.mjs` | `scripts/` | a backfill that mutates the wrong population, or a report that prints a wrong number |
| `audit-api-truncation.mjs` | `src/app/api/` | a route that derives a count, cohort, percentage, or eligibility from an unpaginated read |

They stayed separate because the shapes differ. A script is a whole file you can classify
(does it write?). An API route has dozens of selects, most of them legitimately unbounded —
so the API gate has to classify each **call site**, not the file.

---

## The rule, and why it is narrow on purpose

There are **935 `.select()` calls** under `src/app/api`. Flagging all of them would make this the
first gate someone disables. A finding requires **all three**:

1. **A list read** — not `count:'exact'` / `head:true`, which cannot truncate.
2. **Unbounded** — no `.range()`, `.limit()`, `.single()`, or `.maybeSingle()` nearby.
3. **Population use** — the result feeds `.length`, `.filter`, `.reduce`, `.map`, `new Set()`,
   `Object.keys()`, or a sort. **A row fetched to read one field is fine; a row counted is not.**

That lands on **131 of 935** — a 14% hit rate. Precision is the feature.

### The escape hatch requires a reason

```ts
// truncation-ok: config table, capped at 12 rows by schema
const { data } = await supabase.from('alert_config').select('*');
```

A genuinely bounded query should have to say **why the cap cannot affect correctness**. An
unexplained suppression is a future incident.

---

## Verified behaviour

Proven by injection when the gate shipped — the only validation that means anything:

| pattern | result |
|---|---|
| the actual 8,802-row bug from incident 4 | **blocked** |
| `.range(0, 999)` | passes |
| `count:'exact', head:true` | passes |
| fetched but never counted | passes |
| `// truncation-ok:` waiver | passes |

Both gates **strip comments before matching**. This is not cosmetic: `audit-unranged-selects.mjs`
was flagging a sentence in a sibling gate's own header — 4 of 20 findings were false. False
positives are what make people reflexively `--update-baseline`, which is how a ratchet stops
meaning anything.

---

## If you are about to change this

**Do not widen it into every `.select()`.** The narrowness is what keeps it credible.

**Do not delete the baselines to "start clean."** They record accepted debt; blocking all 131 at
once guarantees someone disables the gate instead.

**Prove any rule change by injection** — inject the bad pattern, expect exit 1; fix it, expect
exit 0; revert. A gate you have not seen go red is a gate you have not tested.

**The lesson generalises past PostgREST.** Any API that silently truncates, samples, or caps is a
data-integrity hazard the moment its output becomes a claim. Accuracy and precision are not the
same thing — a number can be arithmetically correct for the rows you happened to receive and
still be false about the population it is presented as describing.
