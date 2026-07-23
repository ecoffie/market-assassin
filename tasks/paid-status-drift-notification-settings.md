# Task: reconcile `paid_status` drift in `user_notification_settings` (~37 users)

**Filed:** 2026-07-23 (discovered while fixing eruffin@jps-online.com's stranded Pro entitlement).
**Severity:** metrics/reporting accuracy — **NOT an access outage**. Do not treat as urgent-P0.

## The problem
`user_notification_settings.paid_status` and `.stripe_customer_id` are **not reliably
maintained**. They drift from the real entitlement state (`user_profiles.access_briefings`
+ Vercel KV `briefings:{email}` — the actual Pro access gate). Measured live 2026-07-23:

| Metric | Count |
|---|---|
| Pro-entitled (`user_profiles.access_briefings=true`) | 56 |
| `user_notification_settings.paid_status=true` | 50 |
| **Entitled but `paid_status=false`** (the eruffin@ mismatch) | **37** |
| `paid_status=true` but `stripe_customer_id IS NULL` | 49 |

So `stripe_customer_id` is essentially **never populated** (49/50 null), and ~37 genuinely
Pro users read as unpaid in this table.

## Why access is NOT affected
`hasProAccess` reads `user_profiles.access_briefings` + KV, NOT `paid_status`. Those looked
correct for eruffin@ (access_briefings was already true). See memory
[[pro_population_is_a_union]]: "MI Pro" is computed as a UNION (purchases ∪ access_* ∪
paid-classifications ∪ access_team), deliberately NOT off a single `paid_status` flag — which
is exactly why this drift hasn't broken anyone's access. **The systems that matter already
ignore `paid_status`.**

## What IS affected
Anything that reads `user_notification_settings.paid_status`/`stripe_customer_id` directly —
MRR/paid-user counts, "who's paid" segmentation, churn/rescue queues, campaign exclusions
keyed on paid_status. These undercount paid users by ~37 and have ~no Stripe linkage.

## Root cause (to confirm before backfilling)
The Stripe webhook (`src/app/api/stripe-webhook/route.ts`) writes `user_profiles` + KV + the
`purchases` table on `checkout.session.completed`, but either does NOT update
`user_notification_settings.paid_status`/`stripe_customer_id`, or does so on a path that many
of these 37 never hit (e.g. subs created off-link, via the members grant tool, or under a
different flow). **Fix the upstream writer first** so new drift stops; a one-time backfill
only cleans the existing set.

## Proposed fix (two parts — BOTH need explicit approval; writes across many rows, rule #11)
1. **Stop the bleed (code):** make the Stripe webhook (and `applyMemberGrant`) also upsert
   `paid_status=true` + `stripe_customer_id` onto the user's `user_notification_settings` row
   whenever it grants Pro. Verify with a fresh test purchase.
2. **Backfill the 37 (one-time):** for each user with `access_briefings=true` AND
   `paid_status=false`, resolve their Stripe customer id (by email) and set
   `paid_status=true` + `stripe_customer_id`. Local `tsx` runner, dry-run first, show the
   full 37-row list + a sample before the real run (rule #11). Idempotent.

## Reference: the one already fixed
eruffin@jps-online.com — fixed 2026-07-23 via `applyMemberGrant(tier=pro)` (KV+profile+audit)
+ a direct `user_notification_settings` update (paid_status→true,
stripe_customer_id→cus_Ur6S4QuENEsQDQ). Verified 1 row. That's the template for the backfill.

See memory [[resend_webhook_dead_domain_deliverability_blind]] (same investigation surfaced this).
