# FROZEN — new-user onboarding (closed 2026-08-25)

**Do not redesign onboarding until sufficient traffic accumulates.**
Before ANY change to a new-user path:

```
npx tsx scripts/verify-new-user-migration.mts
```

## The operating rules

> **A broken contract is fixed immediately; a surprising behavior is measured before
> redesigning.**

> One signup is an observation. A pattern across several unrelated signups is a reason to
> act.

The first rule is the one that does the work: it separates *"the architecture is violated"*
— someone lands in `/app`, a legacy `next` is honoured, Skip writes a profile — from
*"users surprised us"*, which is data, not a defect. Only the first justifies acting on a
single instance.

## What shipped

| # | change |
|---|---|
| #1365 | one shared post-signup resolver — five legacy defaults replaced |
| #1366 | specificity ranking + `naics_source` provenance column |
| #1367 | setup outcomes — **Skip is not acceptance** |
| #1368 | Maps-native company setup, two screens |
| #1369 | the three `/welcome` choices wired to real destinations |
| #1370 | choice instrumentation |
| #1371 | gate hardened against HTML 404s |

## The record, corrected

Two claims I made during verification need setting straight, because the first was wrong:

* **#1370 DID land.** The delay was **propagation lag**, not a lost merge. I ran
  `merge-base --is-ancestor` before origin had caught up and drew a stronger conclusion
  than the evidence supported. The check was sound; my reading of it was not.
* **#1371 restored identical files** and caused **no functional change**.
* **The genuine defect was in the verification gate**: it accepted a rendered Next.js 404
  because that page is served with **HTTP 200 and `content-type: text/html`**. A route that
  had never deployed read as healthy — and the one check that *did* fail only failed
  because a 404 page cannot return 400.
* **The corrected gate proves route CONTENT and BEHAVIOUR**, not merely a status code.
* **Production passes 29/29**, and real instrumentation writes successfully.

⚠️ The lesson worth keeping is not "the merge was flaky". It is that **the verification
tooling reproduced the exact failure class the whole session was closing** — an evidence
failure reading as a fact — in the one place hardest to see, because the gate is what you
trust instead of looking. A status code is not proof a route exists.

## The contracts now enforced

| | |
|---|---|
| **INTENT** | a valid Maps `next` survives; MCP intent overrides a stale Maps `next`; no intent resolves to `/welcome`, never `/app/onboarding` |
| **SAFETY** | `/app/onboarding`, `/app?panel=settings`, `/briefings`, external and protocol-relative URLs are all rejected to `/welcome` |
| **TRUTH** | Screen-2 Skip creates no active profile state and claims no provenance |

Provenance in production: **1,726 `user_confirmed` · 7,928 `system_default` · 0
`derived_suggestion`**. That ratio is the redesign working — the placeholder truth is
VISIBLE now instead of hiding behind `naics_codes IS NOT NULL`.

## What the accumulated data should answer

Not to be acted on early:

* which door generic/referral users choose
* how many leave `/welcome` without choosing
* whether MCP-origin users correctly bypass `/welcome`
* whether Maps-origin users correctly resume instead of seeing `/welcome`
* of those choosing Company: how many finish Screen 1
* Confirm vs Use-Mindy's-suggestions vs Skip
* after each path, do they actually reach Map/MCP
* **most importantly: do they come back** — `signup → first value → D1 return`

Events land in `user_engagement` as `onboarding_step` / `onboarding`, carrying
`{step:'welcome_choice', choice, arrived_with_intent, arrived_with_next}` — the arrival
context is what separates *"chose the Map"* from *"was already headed there"*.
