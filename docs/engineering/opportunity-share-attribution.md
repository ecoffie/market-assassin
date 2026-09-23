# Opportunity Share Attribution — the measurement contract

> ## ✓ FROZEN 2026-09-23 — POTETO — Opportunity Share Attribution
> **SHARE → CLICK → SESSION → SIGNUP → ACTIVATION → PAID**
> Product merge: PR #1652, head `83c2fdba`, merge `e8c88086`. Production verified serving `e8c88086`.
> Do not reopen for tidiness. Reopen only for a production defect in the chain below, a
> mis-attribution (traffic credited to a share that did not cause it), or a privacy/security issue.

## Production record (2026-09-23, getmindy.ai serving `e8c88086`)

Run: `npx tsx scripts/acceptance/share-attribution-prod-smoke.mts --go` — **23/23 checks passed**.
The run used a synthetic, clearly labelled sharer holding a real signed MI session. Its smoke rows were
deleted afterwards (70 deleted, 0 remaining), so the live report shows only real traffic.

| Stage | Production proof |
|---|---|
| **Share** | Authenticated share copied `https://getmindy.ai/opportunity-map?opp=1d0334b6ca824be59e69f4965cee4262&src=share&sh=5eed04e7-aa16-4940-9e13-d484601d3e7b`. The prod `listing_share` row (08:07:42Z) stores the same `share_id`, `notice_id`, `kind=opp`, `method=clipboard`, with the sharer's authenticated email. |
| **Anonymous arrival** | A fresh anonymous browser (`anon:60b8b42b-…`) opened the link. The drawer showed that opportunity: "Next Generation One-Person Life Raft Modernization". Prod `map_view` and `listing_open` store `entry=share`, the same `share_id`, the same notice and the anon id; `map_view.ft_at` = the stored first-touch time (08:07:49.239Z). The server-side validator resolves it to the share and the sharer. |
| **First touch** | The Map wrote `gca_attribution` (localStorage) and `gca_attr` (cookie) with `first_touch.share_id=S`. A second shared opportunity (`S2` on `164e0be6…`) in the same browser moved `last_touch` only; first touch and its timestamp stayed on S. |
| **Non-share traffic** | Direct → `direct`, plain listing link → `listing_link`, alert → `alert`, briefing → `pursuit_brief`, saved-search → `saved_search`: none carries a share id and none is attributed. A malformed `sh` is stored as `share_invalid` with no id. A fake well-formed `sh` and a real `sh` lifted onto another opportunity do not resolve as attributed traffic. |
| **Share Truth** | `<head>` is byte-identical with and without `src`/`sh` (crawler UA). Same title/OG/Twitter metadata, and `canonical`/`og:url` are the clean `?opp=` link. The 1200×630 card at `/opportunity-map/og/1d0334b6…` returned 200 `image/png`, 66,879 bytes, with the same sha256 with or without the params. |
| **Funnel (live, read-only)** | During the smoke, both smoke shares appeared (1 unique visitor each; the fake and lifted controls were excluded), and every attributable share was dated on or after deploy day. After cleanup the live report is back to 0: the 94 pre-deploy shares carry no `share_id`. |

**Signup → activation → paid** were proven in the pre-merge E2E (`share-attribution-e2e.mts`: local
production build + live DB, rolled-back activation/purchase). They were deliberately **not** manufactured
in production.

**Claim coverage:** `mi-session` (Google, Microsoft, magic link), `mindy-complete-signup` (email),
`mi-login` (password). **Activation:** save, watch/alert or pursuit within 7 days of signup, read
from existing rows. **Known limits:** pre-deploy shares are unattributable; revenue is first purchase
only (renewals aren't in `purchases`); GA4 on the Map is deferred.

---

**Contract (2026-09-23, POTETO).** Mindy's first-party events are the source of truth for the share
growth loop. GA4 is supplemental and is **not** on `/opportunity-map` (see "GA4" below).

```
OPPORTUNITY → SHARE → CLICK → SIGNUP → ACTIVATION (7d) → PAID
```

## What existed before (audit, 2026-09-23)

| Stage | Before |
|---|---|
| Share | `listing_share` with `notice_id` + `kind` — **no share id**, so an arrival could never name a share |
| Link | `/opportunity-map?opp=<id>` — identical to alert, briefing and `/today` links (all `entry=listing_link`) |
| Click | `map_view` carried `referrer` + `utm_source` only (no `entry`); referrer is empty from chat apps/email |
| First touch | none on the Map — it is a **route handler**, so the root layout's `AttributionTracker`, `RefCapture` and GA4 never run there |
| Signup | `signup_attribution` (hand-created, no migration) written only by the email form; Google/Microsoft wrote nothing (**574 of 1,327** accounts since 2026-07-06 had a row) |
| Anonymous → account | shortlist/watch rows claimed at sign-in; engagement history never linked |
| Activation | undefined |
| Paid | `gca_attr → /checkout → KV → Stripe webhook` existed, but the Map never wrote `gca_attr` |

Answerable before: **shares only** (94 events / 31 sharers / 60 notices since 2026-08-04). Nothing downstream.

## The contract

**Share.** The copied link is `?<kind>=<id>&src=share&sh=<share_id>`. `share_id` is a fresh UUID
per click (one share EVENT, not the opportunity). `listing_share` persists `share_id`, `notice_id`,
`kind`, `method` (`clipboard`/`native`/`prompt`); `user_email` is the sharer (verified email, else
their `anon:<uuid>`); `created_at` is the timestamp. No platform UTMs — Copy does not know where
the link will be pasted.

**Frozen Share Truth is untouched.** `src`/`sh` are not read by the server: the served page is
byte-identical with and without them (crawler and browser UA), the same single opportunity row is
read, canonical/`og:url` stay the clean `?opp=` link, `og:image` and the 1200×630 card route key
only on the path id, and the `?opp=` drawer boot reads only `opp`. Guarded in
`src/app/opportunity-map/share-attribution.unit.test.ts`.

**Click.** The Map's boot classifier reads `src` first (it always did). `entry='share'` only when
`sh` is a well-formed UUID **and** the link names a record; anything else claiming `src=share` is
`share_invalid`. `map_view` and `listing_open` carry `entry`, `share_id`, `share_kind`, the shared
record (`notice_id` on `map_view`) and `ft_at` (first-touch time). All in `user_engagement` — no
new event store.

**First touch.** The Map writes `localStorage.gca_attribution` + the `gca_attr` cookie in exactly
the shape `AttributionTracker` writes. `first_touch` is written **once and never overwritten** (a
second shared link moves `last_touch` only); existing keys (e.g. `partner_code`) are preserved. A
share touch carries `share_id`, `notice_id`, `entry`, and `utm_source/medium=share` when no real
UTM is present.

**Anonymous → account.** The Map mirrors the anon id to a first-party `mindy_anon` cookie
(`AttributionTracker` mirrors an existing one on Next pages). At VERIFIED authentication the same
routes that credit `mindy_ref` (`qualifyReferralFromRequest`) call
`scheduleAttributionClaim` → `claimAnonAttribution`:

| Route | Auth class |
|---|---|
| `mi-session` | Google, Microsoft, magic link, `/app` bootstrap |
| `mindy-complete-signup` | email setup-password (mints no token) |
| `mi-login` | password |

Semantics — **joined, never rewritten**: anonymous `user_engagement` rows keep their anon id;
`signup_attribution.anon_id` is the link, so a browser that never signs up stays anonymous.
**Acquisition only**: applies when the account (`auth.users.created_at`) was created after the
browser's first recorded visit — an existing user signing in on a share-visited browser is not a
share signup. **First claim wins**: a row that already has `anon_id` is never re-attributed.
The email form's existing row is **enriched**, never duplicated; OAuth gets a row it never had.
`paid-MFA two-factor/verify` is not wired: it only serves existing paid accounts.

**Share validation** (claim and query use the same rules). A share id attributes an arrival only
when the **earliest** `listing_share` carrying it exists, names the **same record**, **precedes**
the arrival, and was **not** made by the arriving identity. Earliest-wins means a forged later
`listing_share` reusing a real id cannot take it over; a random/malformed id never resolves.

**Activation.** `activated_within_7d` = within `[signup, signup + 7d)` the account created ≥1:
opportunity save (`user_saved_opportunities`, or an `anonymous_shortlist` save it claimed),
watch/alert (`saved_searches`), or pursuit (`user_pipeline`, `COALESCE(owner_email, user_email)`).
Existing rows only — no synthetic activation events. Views, opens, searches, logins, email opens do
not count. Anonymous saves made before signup fall outside the window by construction.

**Paid.** Unchanged path: the Map-written `gca_attr` reaches `/checkout` → `CheckoutStart.attribution`
(KV) → `client_reference_id` → webhook `savePurchase({ attribution })`. The report joins
`purchases_canonical` (the de-duplicated revenue surface) by account email, on or after signup.

## The query

`src/lib/attribution/share-funnel.sql` — one row per share event:
`share_id, notice_id, kind, sharer, method, shared_on, share_visitors, signups, activated_7d,
paid_customers, revenue_cents`. Segment by grouping on opportunity / sharer / method / date.

```bash
npx tsx scripts/report-share-funnel.mts                      # totals (READ ONLY transaction)
npx tsx scripts/report-share-funnel.mts --by notice_id
npx tsx scripts/report-share-funnel.mts --by sharer,method --since 2026-10-01 --json
```

Indexed end to end (`idx_user_engagement_share_id`, `idx_signup_attr_share_id`); 89 ms on prod.

## Acceptance

`scripts/acceptance/share-attribution-e2e.mts --go` against a local production build + the real
DB: real browser shares X, four anonymous browsers arrive, each becomes an account through a
different auth route, one activates and pays inside a ROLLED-BACK transaction, the report
attributes it to S / X / User A. Controls: direct, plain listing, alert, briefing, saved-search,
malformed sh, fake sh, real sh lifted onto another opportunity, second share vs first touch,
never-signed-up visitors. Every synthetic row is deleted and the zero is re-counted. Only the
Google/Microsoft **consent screens** are not driven (headless OAuth); those accounts obtain a real
Supabase session and go through the same `mi-session` route an OAuth return uses.

## Known limits

- **Renewals are not in `purchases`** (the `invoice.paid` handler grants credits/commission only),
  so `revenue_cents` is first-purchase revenue. Lifetime revenue needs Stripe.
- **Pre-contract shares (94) carry no `share_id`** and cannot be attributed retroactively.
- **Email link scanners.** The 203 `entry=fbife_ffbedu_byfeg` events (2026-08-25 → 09-22) are
  `src=saved_search_alert` with letters substituted and word lengths preserved (5_6_5), fetched by
  anonymous desktop Chrome from a small pool of IPs at 11:01–11:05 UTC — the saved-search alert send time. That
  is a security scanner detonating email links, not a Mindy encoder bug. For this contract: a
  scanner that mangles `src`/`sh` fails closed (`share_invalid`, or an id that never resolves); one
  that fetches an unmangled shared link would count as a share VISITOR (never a signup). Treat
  `share_visitors` as an upper bound where shares are pasted into corporate email.
- **GA4** is not installed on `/opportunity-map` (a route handler). Not added here: first-party
  events answer every question in the contract, the Map also serves `?embed=` inside partner
  iframes (a GA tag there is a consent/privacy decision), and adding a property-wide page stream
  mid-quarter would create a discontinuity in existing GA reports. Revisit as its own change with
  `embed` excluded.
