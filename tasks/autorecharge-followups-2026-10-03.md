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
`package: 'refill'` (`src/lib/mcp/autorecharge.ts:356`, the `paymentIntents.create`
call), so the webhook backstop (`src/app/api/stripe-webhook/route.ts:701`) grants
correctly. Net effect: the first time this account drops below 100 it is charged **$119 for
1,000 credits**, not whatever the "plus" pack was when they enabled it, and the
`/mcp/account` dropdown shows no matching option. (The
CLAUDE.md pricing history lists the retired Plus pack as 2,000 cr / $49.) Not imminent: that
account's personal balance on 2026-10-03 was well above its threshold of 100. Decision needed: migrate the row to
`refill` (and tell the customer the price) or disable it pending consent.

## (b) A pooled team member can still have their PERSONAL card auto-recharged

`runMeteredTool` only raises `needsRecharge` for a personal payer
(`src/lib/mcp/metered.ts:302`, `debit.payer === 'personal' && …`), so the
in-request path is correct. But the hourly cron is not payer-aware:
`listRechargeCandidates()` (`src/lib/mcp/autorecharge.ts:407`) selects every enabled/unpaused/carded row and compares only
`mcp_credit_balance` (personal) to the threshold, and `maybeAutoRecharge()` /
`mcp_autorecharge_claim` never consult `resolvePayer` (`src/lib/mcp/payer.ts`). A member who
drained their personal balance below threshold BEFORE joining a team (or an owner whose
personal balance is low while all their calls bill the pool) is charged on their personal
card by the next cron tick, for a balance their calls no longer draw on. (Personal
→ pool transfers via `mcp_transfer_personal_to_pool` lower the personal balance too, so the
one-time Team migration can itself push a member under their threshold.) Decision needed:
should active pool membership suppress personal auto-recharge (mirroring the in-request
rule), or is a personal card mandate independent of team membership?

## (c) OPEN QUESTION — should paid manual top-ups / subscription credits close the attribution window?

The approved rule only resets S on an applied `auto_recharge` grant. Consequence, proven by
the test `OPEN QUESTION — literal rule > indefinite suppression…` in
`src/lib/mcp/autorecharge-chatgpt-attribution.pglite.unit.test.ts`: balance 1,000, T = 50;
ChatGPT spends 100 (S = 100); Claude drains to 0 → `balance + S = 100 >= 50` →
`chatgpt_caused`. Each month the user buys a manual top-up and Claude spends it back to 0:
S stays 100, so the account is suppressed **indefinitely**, though they have since paid by
hand and every recent debit was Claude's.

The fix, if wanted, is a one-line change: add the reason(s) to
`v_resets_window BOOLEAN := p_reason IN ('auto_recharge')` in `mcp_apply_credit`. Any reason
added there forgives ALL of S (only `auto_recharge` forgives just its claim snapshot).
Candidates: `stripe_topup` (paid manual top-up), the subscription grant reasons written by
`stripe-subscription.ts` / `app-tier-subscription.ts`, `pro_monthly`.

## (d) Minor, pre-existing: snapshot attribution when the engine dies mid-recharge

The claim snapshot lives on the settings row, not on the PaymentIntent. If the engine charges
successfully but dies before `applyCreditOnce`, the balance stays low; after the 90s debounce a
second claim may charge again (a pre-existing double-charge window this PR does not change) and
overwrite the snapshot, so the delayed webhook grant for the FIRST PaymentIntent subtracts the
second claim's S. It can only forgive ChatGPT spend that existed at a real claim decision, never
more than S (floored at 0). Fully precise attribution would carry the snapshot in PaymentIntent
metadata and pass it to the grant, which changes `mcp_apply_credit`'s signature.
