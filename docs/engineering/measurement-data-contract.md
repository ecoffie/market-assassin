# The Mission Control measurement contract

**Two rules that apply to every number Mindy reports. Both were learned the expensive way,
in three separate places each, before being written down.**

Recorded 2026-08-23, at Eric's direction, after the same two distinctions were re-derived
independently during the supplier-count audit, the Proposal usage question, and the map
analytics work.

---

## Rule 1 · `null` is not `0`

| value | means |
|---|---|
| `null` | **We don't know yet.** Not measured, not observed, or the read failed. |
| `0` | **We measured it and nobody did it.** A real, defensible finding. |

These are different facts about the world and must never render as the same number.

**Why it matters more than it sounds.** A missing emitter and genuine non-use look
*identical* downstream. Both produce an empty result set. If the surface coalesces them to
`0`, the report says "nobody uses this feature" with total confidence — and someone acts on
it. The decision to gate, deprecate, or de-fund a feature is exactly the decision that gets
made off a fabricated zero.

**Where this has already cost us:**

- **FAR-19 supplier counts.** `|| rows.length` turned an unavailable COUNT into the length of
  the current page — a failed count query would have reported "50 capable suppliers" and fed a
  set-aside recommendation. Now `null`, and the recommendation refuses rather than guesses.
- **`count ?? 0`** — a table that does not exist returns `count=null, error=null, HTTP 204`.
  No error at all. `?? 0` destroys the only signal separating *missing* from *empty*. This is
  Bug Prevention Rule #11 and a pre-push gate.
- **Proposal funnel.** Steps report `null` until an emitter has actually been observed in
  production. A fresh deploy's zeros are not evidence of non-use.

**In practice:** bind `{ data, count, error }`, surface the error, and render an unknown as
`unknown` / `not yet measured` — never `0`, never `—` that reads as zero.

---

## Rule 2 · Intent is not completion

**Intent events** tell you what someone *tried* to do.
**Completion events** tell you what actually *happened*.

They must never be casually summed into one funnel step.

**The near-miss that produced this rule.** The map's proposal surface emits `compliance_run`
from `__wsRunCompliance` — which fires on the **redirect** to `/app`, before any compliance
runs. The server-side event, which fires when the matrix is genuinely extracted, was
originally given the *same token*. One user clicking through would have produced two
`compliance_run` events for one real run, and the step would have reported double its true
completion count. Renamed `compliance_completed`; the map's token is reported separately as
`intentOnlyUsers` and never folded in.

**In practice:**

- Name them differently. `*_run` / `*_started` / `*_clicked` for intent; `*_completed` /
  `*_exported` for completion.
- Count them in separate fields. A funnel step's headline is COMPLETION; intent is reported
  beside it.
- **A large intent-minus-completion gap is a drop-off, not usage.** It is a genuinely useful
  signal — it locates where people fall out — but it is not evidence anyone got value.
- Emit completion at the point the work actually finished, not where it was requested. Where
  a route has several exits (three `Packer.toBuffer` returns), emit once at the last common
  point: per-exit emitters are how one path silently goes uninstrumented.

---

## Why these are one document

Both rules protect the same thing: **a number that reaches a human must mean what the human
thinks it means.** A fabricated zero and an inflated funnel step fail identically — they are
confident, plausible, and wrong, and nothing about them looks broken.

See also `a-number-is-a-product-feature.md` (a number IS a product surface, held to the same
standard as UI) and `silent-failure-registry.md` (the 11 production failure classes).
