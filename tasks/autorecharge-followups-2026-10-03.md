# Auto-recharge follow-ups (recorded 2026-10-03, NOT fixed)

Found while building ChatGPT-attributed auto-recharge suppression
(branch `feat/autorecharge-chatgpt-attribution`, migration
`supabase/migrations/20261003_mcp_autorecharge_chatgpt_attribution.sql`, NOT applied).
Recorded only. Each needs an owner decision before any change.

## Rollout order (hard requirement)

1. Apply `20261003_mcp_autorecharge_chatgpt_attribution.sql` through the runner. NOTE: the
   2026-10-03 dry run also lists `20260924_saved_search_forecast_watermark.sql` as pending
   (unrelated, someone else's), so apply with
   `npm run migrate -- --go --only 20261003_mcp_autorecharge_chatgpt_attribution.sql`
   unless that one is meant to go too. Verify with `npm run db:check -- mcp_credit_balance chatgpt_spend_since_recharge`.
2. Deploy this code. Order matters for ONE path: `maybeAutoRecharge` / `listRechargeCandidates`
   now select `chatgpt_spend_since_recharge`; deployed before the column exists they fail
   CLOSED (no charge; the cron returns a 500) rather than charging blind. The Claude debit path
   sends the original 5 args, so it works on either side of the migration.
3. Only then may `/chatgpt/mcp` (#1776) reach prod. Its debits must carry `channel: 'chatgpt'`
   (`MeteredContext.channel`, same field name/type as #1776). Before this lands, ChatGPT spend
   is invisible to the gate and the hourly cron would charge a card for it.

## (a) A live row still points at the retired `plus` package

Read-only prod check, 2026-10-03: `mcp_autorecharge` has 2 rows; one customer row
(enabled, card on file, `last_recharge_at` NULL) still has `refill_package = 'plus'`. The
email is not recorded here because this repo is public; find it with
`SELECT user_email FROM mcp_autorecharge WHERE refill_package = 'plus'`.

`'plus'` is not in `CREDIT_PACKAGES` (`src/lib/mcp/packages.ts:42-49` holds only
`refill` = 1,000 cr / $119). The engine charges it through the silent fallback in
`packFor()` (`src/lib/mcp/autorecharge.ts:229-243`): `CREDIT_PACKAGES.find` misses, it logs
a warning, and returns `CREDIT_PACKAGES[0]`. The PaymentIntent metadata then says
`package: 'refill'` (`src/lib/mcp/autorecharge.ts:358`, the `paymentIntents.create`
call), so the webhook backstop (`src/app/api/stripe-webhook/route.ts:701`) grants
correctly. Net effect: the first time this account drops below 100 it is charged **$119 for
1,000 credits**, not whatever the "plus" pack was when they enabled it, and the
`/mcp/account` dropdown shows no matching option. (The
CLAUDE.md pricing history lists the retired Plus pack as 2,000 cr / $49.) Not imminent: that
account's personal balance on 2026-10-03 was well above its threshold of 100. Decision needed: migrate the row to
`refill` (and tell the customer the price) or disable it pending consent.

## (b) A pooled team member can still have their PERSONAL card auto-recharged

`runMeteredTool` only raises `needsRecharge` for a personal payer
(`src/lib/mcp/metered.ts:310`, `debit.payer === 'personal' && …`), so the
in-request path is correct. But the hourly cron is not payer-aware:
`listRechargeCandidates()` (`src/lib/mcp/autorecharge.ts:409`) selects every enabled/unpaused/carded row and compares only
`mcp_credit_balance` (personal) to the threshold, and `maybeAutoRecharge()` /
`mcp_autorecharge_claim` never consult `resolvePayer` (`src/lib/mcp/payer.ts`). A member who
drained their personal balance below threshold BEFORE joining a team (or an owner whose
personal balance is low while all their calls bill the pool) is charged on their personal
card by the next cron tick, for a balance their calls no longer draw on. (Personal
→ pool transfers via `mcp_transfer_personal_to_pool` lower the personal balance too, so the
one-time Team migration can itself push a member under their threshold.) Decision needed:
should active pool membership suppress personal auto-recharge (mirroring the in-request
rule), or is a personal card mandate independent of team membership?

## (c) Window reset classification: RESOLVED by owner decision, two reasons await classification

The owner decided on 2026-10-03 that the window resets on any **independent funding event**:
- successful auto-recharge
- customer-paid manual top-up
- subscription allowance / refill
- subscription renewal credit grant

Admin/debug grants, promo/signup credits, referrals, refunds/corrections, migrations, pool
transfers and comp resets do NOT reset it, and neither does any unknown reason. This is
implemented with one SQL allowlist, `mcp_grant_resets_chatgpt_window()`, mirrored in
`src/lib/mcp/grant-reasons.ts`. A source-scan guard in `grant-reasons.unit.test.ts` fails on
any unclassified reason.

Still **needs owner classification** (both treated as NO RESET until decided):
- `sponsor_monthly`: a sponsor-funded monthly top-up to a ceiling
  (`cron/grant-mcp-pro-credits` → `mcp_topup_to_ceiling`). The credits are paid for, but by a
  third party, not the customer.
- `pro_monthly_supplement`: 40 historical rows on 2026-09-08. No current code writes it.

**Ambiguity inside a RESET reason:** `pro_monthly` is written by the same cron to paying Pro
subscribers AND to the comp groups (internal team at 25,000/mo, and advocates), according to the
route header `src/app/api/cron/grant-mcp-pro-credits/route.ts:2-9`. So a comp account's monthly
allowance also resets the window. Making comp allowances NO RESET would mean the cron writes a
distinct reason for its `internal`/`advocate` groups (e.g. `comp_monthly`), classified NO RESET.
That is a one-line change in the cron plus one entry in `grant-reasons.ts`. Owner call.

## (d) Removed: claim-time snapshot

The earlier design snapshotted S at claim and forgave only that amount at grant. The owner's
reset semantics (S := 0 on a funding event) replace it, so the column was never created. ChatGPT
spend between claim and grant now belongs to the old window, as the owner specified, and the
"engine died mid-recharge" snapshot edge case no longer exists.

## Owner classification — 2026-10-03 (resolved)

- **Reset-list principle approved.** RESET = auto_recharge, stripe_topup, pro_monthly, app_tier_pro, app_tier_team, mcp_sub_monthly, mcp_sub_annual. Unknown reasons fail closed (NO RESET).
- **Comp allowances = NO RESET.** The grant cron now writes `comp_monthly` (not `pro_monthly`) for the internal team and advocates. `comp_monthly` keeps the paid standing comp accounts already had for the extraction guard and is shown as "Complimentary monthly credits" in billing history.
- **sponsor_monthly = NO RESET.** Traced: the only producer is the grant cron's sponsored top-up (`mcp_topup_to_ceiling`). The only entitlement is Encore Funding → one account, approved by Eric 2026-09-15. No Stripe customer exists for the sponsor contact or the beneficiary, so there is no recorded payment, and 0 `sponsor_monthly` ledger rows exist so far. Rule: reclassify to RESET only when a sponsorship carries a recorded payment.
- **pro_monthly_supplement = NO RESET.** Traced: a one-time script (`scripts/pro-supplement-2026-09.mts`, commit 18cb5a6f) run on 2026-09-08 for the 250 → 1,500 allowance transition. It wrote 40 rows of +1,250. Its audience was every September `pro_monthly` 250 recipient, which included 5 comp advocates. It is not a renewal and is never produced again.
