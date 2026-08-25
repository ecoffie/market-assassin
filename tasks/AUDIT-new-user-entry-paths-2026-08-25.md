# Audit — every new-account entry path (read-only)

**Run 2026-08-25. NOTHING WAS CHANGED.** Prerequisite to building `/welcome`.

Hard rule: **`/app` is discontinued and is NOT a valid destination, fallback, or onboarding
surface for any newly created account.** `/welcome` is an **intent router, not onboarding**.

## `/welcome` — CONFIRMED NOT BUILT

`src/app/welcome/` does not exist. The intent-router architecture was decided, never shipped.

## The audit table

| Entry source | intent captured | signup route | setup/password path | onboarding behavior | current final destination | `/app` violation | required Maps-native destination |
|---|---|---|---|---|---|---|---|
| **Generic / referral link** | **none** | `/signup` → alias of `/app/signup` | OAuth or email | forced into legacy profile builder | **`/app/onboarding`** | ⛔ **YES — the reported case** | `/welcome` |
| **OAuth (Google / Microsoft)** | only if `?next=` present | `/app/signup` → provider | provider callback | callback default | **`/app/onboarding`** | ⛔ **YES when `next` absent** | `next` if safe, else `/welcome` |
| **Email signup → setup-password** | preserved via `withNext` | `/setup-password` | `/app/setup-password` | `withNext('/app/onboarding?setup=success', next)` | `next` if present, else **`/app/onboarding`** | ⚠️ **PARTIAL** — correct when intent known, legacy when not | `next` if safe, else `/welcome` |
| **Maps action (Save/Players/Pursuit)** | **yes** — `next` threaded | modal `openSignInModal` | preserves `next` | returns to exact Map context | **the originating Map view** | ✅ none | already correct |
| **MCP** | **none** | `/mcp` → "Sign in to connect" → bare **`/app`** | — | — | **`/app`** | ⛔ **YES** | `/mcp/setup` |
| **Purchase / checkout** | order intent only | Stripe → webhook | — | not a routing contract | not established | — | continue purchase → Maps |
| **`/app` root visit** | n/a | — | — | `page.tsx:340` forces `/app/onboarding` | **`/app/onboarding`** | ⛔ **YES** | `/welcome` |
| **AlertsPanel setup CTA** | n/a | — | — | `mindySetupHref = '/app/onboarding'` | **`/app/onboarding`** | ⛔ **YES** | Maps-native company setup |

## Root cause of the reported referral case

`src/app/app/auth/callback/route.ts:9`

```ts
const requestedNext = requestUrl.searchParams.get('next') || '/app/onboarding';
```

**When no intent is supplied, the default IS the legacy surface.** A generic referral carries
no `next`, so it lands there every time. This is not a missed edge case — it is the
documented fallback, and it is the single line behind the user's report.

The same shape appears in three more places (`app/page.tsx:340`, `AlertsPanel.tsx:206`,
`setup-password` base URL). **Five sites, one pattern: the fallback when intent is unknown
is `/app/onboarding`.**

## What is ALREADY correct — do not rebuild

* **Maps-action signup** threads `next` through signup → setup-password → onboarding and
  returns to the exact Map context. This is the model the other paths should follow.
* **`safeNext()` / `withNext()`** already exist and already reject `/app`-re-entering values.
  The routing contract has a working validator; what it lacks is a non-legacy DEFAULT.
* **Map sign-in is modal/native**, not a bounce to `/app`.

## The one-line shape of the fix (not applied)

Every violation is the same: `?? '/app/onboarding'`. The contract needs one shared
resolver — known intent wins, otherwise `/welcome` — rather than five independent defaults.
Fixing them separately is how they drifted apart in the first place.

## Company onboarding — field mapping (for the Maps-native replacement)

`/app/onboarding` is **1,793 lines**. Before rebuilding, the required-vs-optional split has
to come from the data model, not from the legacy form's layout:

* tables/APIs to reuse: `user_business_profiles`, `user_notification_settings`,
  `/api/app/profile`, `/api/suggest-codes`
* ⚠️ **do not create another profile system** — DEFECT-8 already showed one column carrying
  two meanings across two writers. A third writer would compound it.
* **NOT YET MEASURED:** which fields are genuinely required vs optional enrichment. That
  needs a row-level look at what is actually populated, and is the remaining gap before
  progressive setup can be specced.

## Recommended order (unchanged from the decided architecture)

1. one shared post-auth destination resolver (kills all five legacy defaults at once)
2. `/welcome` intent router — three choices only
3. MCP-origin routing → `/mcp/setup`
4. Maps-native progressive company setup
5. purchase-origin contract

**Do not build `/welcome` before step 1.** A router with five callers still defaulting to
`/app/onboarding` changes nothing for the referral user who reported this.
