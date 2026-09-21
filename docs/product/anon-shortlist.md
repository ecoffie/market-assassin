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

## 🔒 Security rework (review round 2)

Three defects were found in review. All three are fixed, and each is enforced in
**both** the application and the database.

### 1. Unauthenticated claim → another user's pursuits
`claim` accepted an arbitrary `email` and wrote rows into that account.
**Fixed:** claim requires a verified MI session and derives the account from
`session.session.email`. The route never reads `body.email` (asserted by test).

### 2. `user_pipeline` semantics — **reuse rejected**
I originally argued reuse was safe because signed-in *views* filter by email.
**An audit of all 63 consumers proved that insufficient — six read the table
GLOBALLY with no `user_email` filter:**

| Consumer | Why it matters |
|---|---|
| **`cron/pursuit-changes`** | selects every non-archived row with a notice_id and **SENDS EMAIL** to `owner_email \|\| user_email` — it would try to email a UUID |
| `lib/analytics/observatory.ts` | anonymous browsing counted as pursuit activity |
| `lib/admin/demand-heatmap.ts` | same |
| `admin/dashboard` | same |
| `admin/map-funnel` | same |
| `admin/qualify-customers` | same |

So anonymous rows now live in a **dedicated `anonymous_shortlist` table**.
`user_pipeline` means exactly what it meant before this feature existed.

### 3. Client-supplied opportunity metadata
The browser sent `title`, `agency`, `naicsCode`, `responseDeadline`.
**Fixed:** it sends **only `noticeId`**. Everything else is resolved from
`sam_opportunities` at save and at promotion.

### Proven at the database layer (exact-DDL validated, then rolled back)

| Attack | Result |
|---|---|
| owner = `victim@example.com` | **23514** CHECK violation |
| `notice_id` = `FAKE-NOTICE-DOES-NOT-EXIST` | **23503** FK violation |

### Abuse controls (existing KV limiter, no new framework)
60 writes/hour per IP · 30/hour per anon id · ≤ 50 listings per identity · an
**unverifiable count refuses** the write (503) rather than allowing an unbounded one.

## What powers it

A new `anonymous_shortlist` table holding **only** `owner_anon_id`, `notice_id`,
`created_at` and the claim stamps — deliberately not a copy of the pursuit
schema. `UNIQUE (owner_anon_id, notice_id)` dedups a repeat save. Opportunity
metadata is never stored; it is read from `sam_opportunities`. **No new data
dependency beyond the existing opportunity corpus.**

## The claim path

`claimAnonShortlist` promotes a shortlist into a **verified** account and **never
overwrites an existing pursuit** for the same notice — those are reported as
`alreadyTracked` and left alone.

**Order matters:** a shortlist row is marked claimed *only after* its pursuit
write succeeds, so a failure leaves the shortlist intact and the user can retry.
Promoted rows are tagged `source='opportunity_map_claimed'`.

**It is reachable, not dead code:** a signed-in visitor whose browser holds an
anonymous shortlist promotes it automatically on Map load.

## Restore

On Map load a signed-out visitor's kept listings render **✓ Saved** without
clicking again. A failed read is reported as UNKNOWN (503) and the UI leaves the
buttons alone — it never renders "nothing saved" from a failure.

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
