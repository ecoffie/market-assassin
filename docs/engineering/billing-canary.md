# Mindy Billing Acceptance — permanent production canary (INTERNAL)

**Not a customer. Do not cancel, bill, contact, migrate or count it.** It exists so pooled-credit
billing can be proven on production without touching a customer's credits (Eric, 2026-09-30).

| Object | Id |
|---|---|
| Stripe customer | `cus_VM1O6uG9wGFluM` — "Mindy Billing Acceptance (INTERNAL CANARY)", metadata `internal_canary=true` |
| Stripe coupon | `ObpNloTG` — 100% off, forever, max 1 redemption, internal |
| Stripe subscription | `sub_1ULJM4K5zyiZ50PBRFojExdX` — real Growth monthly price `price_1UG0qlK5zyiZ50PBQLTBrEAV`, $0 after discount |
| Organization | `ef1a1e1b-8763-4c16-a785-cf8ee0a41548` — type team, `seat_limit` 2, `pool_plan_key` growth |
| Pool | `3272a81f-e303-44aa-9e9b-8e4c2dcff9f9` — `pool_monthly_credits` 20, refilled by the monthly grant run |
| Owner | `billing-canary-owner@getmindy.ai` (team_owner) |
| Member | `billing-canary-member@getmindy.ai` (team_member) |
| Non-member control | `billing-canary-outsider@getmindy.ai` (personal only) |

All three addresses are in `INTERNAL_CANARY_EMAILS` (`src/lib/mindy/campaign-exclusions.ts`), so
they are excluded from MRR, purchaser, activity and campaign metrics. The Stripe mirror row
carries the $399 list price (the mirror has no discount column); without that registration the
MRR goal chart would count $399 that does not exist.

## Acceptance run (first: 2026-09-30, all passed)

Cheapest legitimate metered operation: `search_sam_opportunities` (5 credits, reads our own
cache). Calls go through the hosted transport `https://mcp.getmindy.ai/mcp` with a temporary
API key per account; **revoke the keys after every run**.

| Step | Expected | 2026-09-30 |
|---|---|---|
| Owner call | pool −5, owner personal unchanged | pool 20→15 ✅ |
| Member call | same pool −5, member personal unchanged | 15→10 ✅ |
| Non-member call | personal −5, pool unchanged | outsider 100→95, pool 10 ✅ |
| Member, owner calls | pool drains to 0 | 10→5→0 ✅ |
| Owner / member call on an empty pool | refused `team_pool_insufficient_credits`, nothing charged, no personal fallback | ✅ both |
| Owner removes member, member calls | billed to member's personal, pool untouched | member 100→95, pool 0 ✅ |

Ledger proof: every pooled debit carries `charged_pool_id` = the canary pool and
`actor_email` = the caller; personal debits carry `charged_pool_id` NULL. The migrated
customer's pool stayed at 2,000 throughout. After the run the member was re-invited and
re-accepted (2 of 2 seats) so the next run starts from the standing state.

The exhaustion step drains the pool, so a full run fits **once per monthly refill** (20 credits
= 4 calls). Each account also holds its one-time 100-credit `signup_grant`; those personal
balances are what make a wrong personal fallback visible.

## Gotchas this canary already caught

- **Invites were broken in production** (#1763): `seatUsage` counted on the read replica, which
  rejects every HEAD with an empty 400.
- **The Stripe subscription mirror refreshes once a day** (`sync-stripe-cache`, 05:00 UTC). The
  real-time mirror webhook (`tools.govcongiants.org/api/webhooks/stripe`) is DISABLED in Stripe,
  so a newly bought multi-seat subscription has no mirror row, and `resolvePayer` charges
  nothing (`subscription_state_unknown`) until the next sync. The canary's row was written by
  hand. This must be solved before a customer self-serves a pooled plan.
- Creating the subscription with **no customer email** kept the first $0 invoice from granting
  3,500 personal credits before the pool existed; the email was added after provisioning.
- **Open:** the in-chat credit footer on a POOLED call still says "Top up → getmindy.ai/mcp"
  when the pool runs low. A personal top-up cannot fund the pool, so for a member that nudge
  sells credits their pooled calls can never use (the same defect class as the empty-pool
  paywall fixed in #1761). The empty-pool refusal itself is correct.
