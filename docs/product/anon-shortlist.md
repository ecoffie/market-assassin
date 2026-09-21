# W2 — Let an anonymous visitor keep a listing

**Date:** 2026-09-21 · Action · Habit

## The customer problem

Someone opens an opportunity on the Map, decides it is worth keeping, clicks
save — and is asked to create an account first.

## The evidence (production, 30 days)

Opportunity Map funnel, by distinct users:

| Step | Users |
|---|---:|
| `cards_shown` | 8,460 |
| `map_view` | 7,307 |
| `listing_open` | **2,021** |
| `pursuit_started` | **53 (2.6%)** |

96% of Map users (8,254 of 8,583) are **not signed in**, and `savePursuit` calls
`requireSignIn('save this to your pursuits')`.

**The listing is not failing to explain itself.** It already carries the "Why
this opportunity" chips, Should-I-bid, and the M-Estimate band. The drop from
2,021 → 53 is a **permission failure, not a comprehension failure** — which is
why this PR adds no new explanation, no new score and no new panel.

## Before → After

**Before:** signed-out click on Save → sign-in modal → account flow.

**After:** signed-out click → **"✓ Saved"**, held against the same stable
`anon:<uuid>` the map's telemetry already uses. A repeat click says
**"✓ Already saved"** rather than failing.

Signed-in behaviour unchanged. `/api/pipeline` is not touched — asserted by a
test that checks the file is absent from this diff.

## What powers it

`user_pipeline` as-is — **no migration**. `user_email` has no FK, and the table
already carries `UNIQUE (user_email, notice_id)`: exactly the dedup key a
shortlist needs. Anonymous rows are tagged `source = 'opportunity_map_anon'`, so
they are distinguishable and invisible to every signed-in pursuits view (those
query by the account's email). **No new data dependency.**

## The claim path

`claimAnonShortlist` moves a shortlist onto a real account and **never
overwrites an existing pursuit** for the same notice — those rows are reported as
`alreadyTracked` and left alone, because the account's own pursuit is the better
record.

Counting uses `{ count: 'exact' }`, never a `RETURNING` payload (INT-005), and a
NULL count is reported as **unknown, never zero**.

## Analytics

`shortlist_saved` (with `anonymous: true`), emitted **only on a new save** so a
repeat click cannot inflate the funnel. One event.

## What would cause a revert

- `shortlist_saved` stays near the 53-user baseline → the sign-in wall was not
  the binding constraint and the drop is about the opportunities themselves.
- Anonymous rows appearing in a signed-in user's pursuits view → isolation broken.
- A spike in `alreadyTracked` on claim → people are shortlisting things they
  already pursue, i.e. the surfaces are not distinct enough.

## Map-first

This is the Map's listing drawer. A claimed shortlist becomes a pursuit, which
already has its own map affordances.

## Relationship to W1

W1 lets an anonymous visitor keep a **market** (a saved search). This one lets
them keep a **listing**. They share the identity source (`_anonId()`) but not
code — each carries its own validator so the two PRs merge independently, in
either order. If both land, a future claim can upgrade watches and shortlists
together.
