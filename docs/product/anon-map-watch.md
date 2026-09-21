# W1 — Let the 96% keep something

**Date:** 2026-09-21 · Discovery · Habit · Action

## The customer problem

A contractor finds a market on the Map, wants to keep it, and cannot — unless
they already have an account. The moment of intent is met with a sign-in wall,
then a demand to *name* something before any value is delivered.

## The evidence (production, 30 days)

| Measure | Value |
|---|---|
| Distinct users on the Opportunity Map | **8,583** |
| …signed in | **329** |
| …**anonymous** | **8,254 (96%)** |
| Users who have EVER saved a search | **41** (0.5% of monthly map users) |
| Users visiting one day only, never returning | **8,329 of 9,569 (87%)** |
| Anonymous visitors returning on ≥2 days | 147 |

Map funnel: 8,460 `cards_shown` → 7,307 `map_view` → 2,021 `listing_open` →
**53 `pursuit_started` (2.6%)**.

The Map is the centre of the product, carries the traffic, and converts almost
nothing — because its only "keep" action is closed to 96% of its users.

## Before → After

**Before:** signed-out click → `openSignInModal` → account flow → `window.prompt`
for a name → save.

**After:** signed-out click → **saved immediately** against the stable
`anon:<uuid>` already in localStorage, named from what they are looking at
(`NAICS 541512 · Navy · FL`) → **"✓ Watching"** → *optional* email ask.

Signed-in behaviour unchanged. `/api/app/saved-searches` untouched.

## What powers it

`saved_searches` as-is — **no migration**. `user_email` is plain TEXT with no FK
or CHECK. `_anonId()` already exists for telemetry. Same filter/bbox/mode
snapshot the signed-in path takes. **No new data dependency.**

## 🔒 Security hardening (review round 2)

**The defect found in review:** `action='claim'` accepted an arbitrary `email`
from the request body and set `alerts_enabled = true` on it. Any holder of an
anon uuid could point Mindy's alert email at a victim's address.

**The fix:** the claim branch now requires a **verified MI session** and derives
the account from `session.session.email`. The caller cannot name the recipient
at all, so there is no address to abuse. The anonymous **save** is unchanged and
still needs no account — value continues to come before sign-in.

**Defence in depth:**

| Control | Where |
|---|---|
| anon rows written `alerts_enabled=false` | `saveMapWatch` |
| alert cron also excludes `anon:%` owners | `applyDueSavedSearchScope` — second lock |
| an anon id can never become an "account" | `claimAnonWatch` guard |
| 30 writes/hour per IP · 10/hour per anon id | existing `checkRateLimit` (KV) |
| ≤ 25 watches per anon identity | `MAX_ANON_WATCHES` |
| an unverifiable count **refuses** the write | `held == null` → 503 |
| payload shape + 4 KB cap | `checkWatchPayload` |

No new security framework — the repo's existing KV rate limiter and MI session
are reused.

## ⚠️ Two safety details

1. **`alerts_enabled` DEFAULTS TO TRUE.** Anonymous rows set it `false`
   explicitly, or the alert cron (`.eq('alerts_enabled', true)`) would try to
   email an address that is not an address. Alerts turn on **only** via the
   explicit claim path.
2. **INT-005, caught by the gate on my own code.** `claimAnonWatch` originally
   counted an `UPDATE … .select('id')` RETURNING payload as the write total —
   the documented capped-receipt trap. Now uses `{ count: 'exact' }`, and a NULL
   count is reported as **unknown, never zero**.

## Analytics

`watch_created` (with `anonymous: true`) and `watch_claimed`. Two events, using
the existing `_track` convention.

## What would cause a revert

- `watch_created` stays near the 41-user baseline → the wall was not the binding constraint.
- Any anonymous row reaching the alert cron → alert leakage (structurally prevented; asserted in tests).
- Claim rate ≈ 0 → people keep things but never identify themselves. A different, still-useful product fact.

## Map-first

This **is** the Map. The watch is the map's own state, and restoring one drives
the existing `?ss=` deeplink path.

## Threat model, stated plainly

An anon id is client-supplied, so anyone holding a uuid can read/write that
watch. A watch holds only PUBLIC opportunity filter state and no PII; ids are v4
uuids. Accepted trade for letting 96% of traffic keep something. Once a real
email is attached the row belongs to that email and the anon id no longer
resolves it.
