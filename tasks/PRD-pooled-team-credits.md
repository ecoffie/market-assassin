# PRD: Pooled Team Credits

**Status:** Approved to build (2026-09-29), with the decisions below. Stop before any production migration or public pricing change.
**Owner:** Eric / Engineering
**Date:** September 29, 2026
**Trigger:** The first multi-user subscription deal (a two-user client, proposal sent Sep 29, 2026) could not be sold as "one plan, shared credits," because credits only live on individual accounts. It is being delivered with a workaround (paid plan on one account plus a sponsored entitlement for the second user). Client details live in the private `ecoffie/govcon-proposals` repo, never here: this repo is public.
**Prior work this completes:** the "Teams shared-MCP" sequence, PRs 2 through 4A (migrations `20260908_mcp_credit_pool.sql`, `20260909_mcp_pool_debit.sql`, resolver `src/lib/mcp/payer.ts`). PR 4B (fund the pools) was never built.

---

## 0. Decisions (Eric, 2026-09-29) — these override anything below

1. **Pools belong to any multi-seat subscription, not Team only.** A pool is an organization/subscription capability for **any plan configured with more than one seat**. Seat count is a property of the organization's subscription (`organizations.seat_limit`), defaulted from the plan and overridable for a negotiated deal (e.g. a 2-seat Growth subscription).
2. **Explicit membership only.** Billing membership comes from `org_members` rows created by an owner invite that the invitee accepts by proving the address. Never email-domain grouping.
3. **Current Team economics are not the target.** 1,000 credits / 5 seats is NOT preserved as target pricing. Architecture proceeds with credits and seats read from configuration; a Team / Growth / Agency seat-and-credit **pricing proposal** comes back to Eric before any public pricing change.
4. **Annual pooled subscriptions replenish monthly**, even when billed annually (unlike personal annual plans, which grant 12x up front).
5. **Migration of the existing Team subscriber:** move only their **remaining Team-entitlement credits** into the new pool, through an **idempotent, audited** migration. Unrelated personal or purchased credits stay personal.
6. **Stop gates:** build through the PRD phases, then stop for approval before (a) running any migration or data move against production and (b) changing public pricing.

---

## 1. Problem statement

**Who has it:** any company that buys Mindy for more than one person: Team subscribers today, and enterprise buyers (like the two-user deal above) who want one invoice and one credit allowance for their whole BD team.

**The pain:**
- A company pays once but can only give credits to **one** account. Every other teammate is on their own balance.
- The Team plan ($499/mo, 5 users) grants its 1,000 monthly credits to the **buyer's personal balance** (`grant-mcp-pro-credits` cron, `team-sub` group). The other four seats get nothing from it.
- Sales can't truthfully write "credits shared across your team" in a proposal. That line was in the first draft of the Sep 29 proposal and had to be removed.

**How it's solved today:** by hand. Paid plan on one account, plus a sponsored entitlement (`sponsor_entitlements`) for each extra user. This **adds** credits instead of splitting one allowance, costs us margin, and needs manual setup per deal.

**Evidence it's real (measured 2026-09-29, production):**

| Measure | Value |
|---|---|
| Active Team subscriptions (`stripe_subscriptions`, $499/mo or $4,990/yr) | 1 |
| Users with `access_team = true` | 9 |
| `mcp_credit_pool` rows | **0** |
| `organizations` rows | 2, both coach-mode orgs, **neither linked to a Stripe subscription** |
| `org_members` rows | 2 |
| Active sponsored entitlements (the manual workaround) | 1 |

Because no organization is linked to a Team subscription, `resolvePayer()` returns `personal` for every caller. Pooled billing is wired but can never trigger.

---

## 2. Solution

**One sentence:** a company buys one subscription, invites its named users, and every member's Mindy usage draws from one shared, company-owned credit pool, with the admin able to see who spent what.

**Where it lives:** MCP billing (`src/lib/mcp/`), the Stripe webhook, the monthly grant cron, and the `/mcp/account` console (plus Team settings in `/app`).

**User flow:**
1. Buyer purchases a Team-eligible subscription.
2. The system creates the company's organization, makes the buyer its owner, and creates an empty credit pool.
3. The monthly grant funds the **pool** (not the buyer's personal balance).
4. The owner invites named users by email; each invitee proves the address and joins.
5. When any member runs a paid tool, `runMeteredTool` resolves the payer to the pool and debits it atomically.
6. The owner sees pool balance, members, and usage per member (by `actor_email`) in the account console.

---

## 3. What ALREADY exists (don't rebuild)

| Piece | Where | State |
|---|---|---|
| Pool table + ledger provenance (`actor_email`, `charged_pool_id`) | `supabase/migrations/20260908_mcp_credit_pool.sql` | Live, empty |
| Atomic pool debit, no fallback to personal | `mcp_debit_pool` in `20260909_mcp_pool_debit.sql` | Live, called |
| Pool funding RPC | `mcp_grant_pool` in the same migration | Live, **"no caller yet"** |
| Payer resolver (personal / pool / selection_required / unavailable) | `src/lib/mcp/payer.ts` | Wired into `metered.ts` (PR 4A) |
| Billing invariant: membership only from explicit `org_members`, never email domain; no cross-payer fallback; multi-org never picks first row | `payer.ts` header | Decided, keep |
| Purchased vs allowance accounting (spend allowance first) | `20260915_credit_pools_purchased.sql` | Live on personal balances |
| Monthly grant loop, Team price detection (`TEAM_AMOUNTS`), idempotency keys via `applyCreditOnce` | `src/app/api/cron/grant-mcp-pro-credits/route.ts`, `src/lib/mcp/credits.ts` | Live, grants Team credits **personally** |
| Team checkout branch + `provisionTeamWorkspace` | `src/app/api/stripe-webhook/route.ts` (~line 474), `src/lib/app/workspace.ts` | Live, creates the **app** workspace only |
| Org + membership tables | `organizations`, `org_members` (used by coach mode, `src/lib/mindy/coach-access.ts`) | Live |
| Email-ownership proof (OTP) | `src/lib/mindy/linked-emails.ts` pipeline (`two_factor_codes`) | Live, reusable for invites |
| Usage charts by tool/day | `src/app/mcp/usage-charts.tsx`, `GET /api/mcp/account` | Live, personal only |
| Sponsored entitlements (the current workaround) | `sponsor_entitlements`, `sponsor_active_entitlements` | Live, 1 active |

⚠️ **Do not reuse the app workspace for billing.** `mi_beta_team_members` groups users by email domain (616 distinct team workspaces measured). `payer.ts` explicitly forbids domain-derived membership for billing (`proton.me` has 5 unrelated members). Pools must key off explicit `organizations` / `org_members` rows.

---

## 4. What's net-new

**Backend**
1. **Provision on purchase.** In the Team branch of the Stripe webhook: create (idempotently) an `organizations` row with `stripe_subscription_id` set, an owner `org_members` row, and an `mcp_credit_pool` row. Also expose it as a self-heal/admin path for existing subscribers.
2. **Fund the pool monthly.** In `grant-mcp-pro-credits`, route Team-eligible subscriptions to `mcp_grant_pool` instead of the personal grant, with a `(org, month)` idempotency key. Annual Team terms: decide monthly vs up-front (open question 3).
3. **Membership API.** Invite, accept (OTP-proven), remove, list. Enforce the seat cap (Team = 5 users per `packages.ts`). Owner/admin role checks.
4. **Selection handling.** `payer.ts` already refuses 2+ eligible orgs; surface its message cleanly in the MCP error and app UI. (Picking an org stays out of scope.)

**UI**
5. `/mcp/account`: a Team section showing pool balance, members, and usage per member (group `mcp_credit_ledger` by `actor_email` where `charged_pool_id` = the pool).
6. `/app` Team settings: invite and remove members.

**Migration / data**
7. Backfill for the 1 existing active Team subscriber: create org + pool, move this month's Team allowance from the personal balance into the pool (only the unspent allowance portion, not purchased credits).
8. Convert the manual two-user deal from "plan + sponsored entitlement" to a pool once eligible SKUs are decided (open question 1).

**Copy**
9. After launch only: update `/pricing` and the proposal framework to say credits are shared across the team.

---

## 5. Scope

**In scope (MVP)**
- [ ] Provision org + owner + pool on Team purchase (idempotent), plus a self-heal path
- [ ] Monthly pool funding with `(org, month)` idempotency
- [ ] Invite / accept / remove / list members, seat cap enforced
- [ ] Member MCP calls debit the pool (already wired once a pool exists)
- [ ] Per-member usage in `/mcp/account`
- [ ] Backfill the existing Team subscriber
- [ ] Pre-push gate / unit tests for the new grant and membership paths

**Out of scope (defer)**
- Choosing between multiple orgs (keep `selection_required` refusal)
- `actor_user_id` (blocked: MCP only knows emails today, per the 20260908 migration)
- Per-member spending caps inside a pool
- Changing Team price or allowance (separate pricing decision, see open question 2)
- Pooled purchased top-ups / auto-recharge into a pool (phase 2)

**Dependencies:** Stripe Team price IDs (existing), migrations run through the runner (`npm run migrate`), no new env vars expected.

**Scale / cost:** pools add one row per org and one debit per call (same cost as personal). The per-user $15/mo LLM cap still applies per actor.

---

## 6. Acceptance criteria

1. **Provisioning:** a test Team checkout creates exactly one org (linked subscription), one owner membership, one pool. Replaying the webhook creates nothing new.
2. **Funding:** the monthly grant funds the pool once per month; a second run in the same month grants 0; the buyer's personal balance receives no Team grant.
3. **Pooled debit:** a member's paid tool call debits the pool, writes a ledger row with `actor_email` = member and `charged_pool_id` = pool, and leaves the member's personal balance unchanged.
4. **Concurrency:** 50 parallel member calls against a pool with credits for 20 succeed exactly 20 times; the balance never goes below 0.
5. **No fallback:** an empty pool rejects the call with a clear message; it never charges the member personally, and a member's empty personal balance never draws from the pool.
6. **Cancellation:** after the Team subscription is cancelled, the next member call resolves to `personal` (payer re-reads the subscription on each call).
7. **Non-members:** a user who shares the buyer's email domain but has no `org_members` row is billed personally.
8. **Seat cap:** the 6th invite on a 5-seat Team is refused.
9. **Admin view:** per-member usage in `/mcp/account` equals a direct ledger query grouped by `actor_email` for that pool.
10. **Verified live:** `npm run db -- mcp_credit_pool --count` > 0 after backfill, and one real pooled call recorded on prod.

---

## 7. Estimated effort

| Phase | Work | Size |
|---|---|---|
| 1 | Provisioning on purchase + self-heal + backfill of the existing subscriber | 1 to 2 days |
| 2 | Monthly pool funding in the grant cron (idempotent) | 1 day |
| 3 | Membership API (invite/accept/remove/list, OTP, seat cap) | 2 to 3 days |
| 4 | Account console Team section + app Team settings | 2 days |
| 5 | Tests, acceptance run on prod, pricing/proposal copy update | 1 day |

---

## 8. Risks + open questions (need Eric's decision)

1. **Which SKUs get a pool?** `payer.ts` only treats Team prices ($499/mo, $4,990/yr) as pool-eligible. The two-user deal is on **Growth** ($399/mo, 3,500 credits). Options: (a) pools for Team only; (b) add a "seats" attribute so Growth/Agency can be sold multi-user; (c) a new "Growth Team" SKU. *Recommendation: (b), the Salesforce/Microsoft model: capacity is sold per plan and seats are an attribute of the subscription, not a separate product.*
2. **Team allowance is small.** Team = 1,000 credits/mo for 5 users (200 per user), while Growth alone = 3,500. A multi-user buyer is worse off on Team than on Growth. Pricing decision, separate from this build.
3. **Annual Team credits:** grant monthly or all up front (Growth annual grants 12x up front)?
4. **Existing buyer's personal Team credits:** move the unspent allowance into the pool at backfill (recommended), or leave it personal and start pooling next month?
5. **Invite proof:** reuse the linked-emails OTP flow (recommended) or accept any invited address on first sign-in?
6. **Risk: charging the wrong payer.** Mitigated by the existing invariants (explicit membership only, no fallback, multi-org refusal) and acceptance criteria 5 to 7.
7. **Risk: coach-mode orgs.** The 2 existing orgs are coach orgs without subscriptions; they must stay `personal`. Covered by criterion 7 (no subscription link, no pool).

---

## 9. Decision log

- **2026-09-08** Pool table and ledger actor/payer columns added before any pooled spending, so every pooled row is attributable (PR 2).
- **2026-09-08** Pool debit mirrors the personal debit (not a generalized function); no fallback in either direction (PR 3, #1430; migration file dated 20260909).
- **2026-09-08** Payer resolver wired into `runMeteredTool`; behaviour-neutral while 0 pools exist (PR 4A, #1431).
- **2026-09-15** Purchased vs allowance accounting; allowance spends first.
- **2026-09-29** First multi-user deal delivered as plan + sponsored entitlement because pools are unfunded; sales copy must not say "shared across your team" until this ships. This PRD opened.
- **2026-09-29** Billing membership must come from explicit `org_members`, never the domain-derived app workspace (616 workspaces measured).
- **2026-09-29** Approved to build (Eric): pools for any multi-seat plan; explicit membership; monthly replenishment for annual pooled plans; audited migration of only the remaining Team-entitlement credits; pricing proposal before any public price change; stop before production migration.

---

**Status:** ☐ PRD only · ☑ Approved to build (2026-09-29) — stop before production migration or public pricing change

---

## 10. Build status (2026-09-29) — built, NOT deployed, migration NOT applied

| Phase | Delivered | Where |
|---|---|---|
| 1. Provision on purchase | Org + `team_owner` + pool, idempotent on the subscription; checkout AND first invoice both provision (whichever arrives first); admin endpoint for negotiated multi-seat deals on any plan | `src/lib/mcp/team-pools.ts` `provisionPooledOrg`, `api/stripe-webhook`, `lib/mcp/app-tier-subscription.ts`, `api/admin/team-pools` |
| 2. Monthly pool funding | `mcp_replenish_pool` (top-up to allowance, (month, ceiling) claim, never stacked, never refilled by spending, annual replenishes monthly); cron routes pooled subscriptions to their pool and never also grants the buyer personally; MCP-plan invoices fund the pool instead of the personal (12x annual) grant | migration `20260929_pooled_team_credits.sql`, `api/cron/grant-mcp-pro-credits`, `lib/mcp/stripe-subscription.ts` |
| 3. Membership | Owner invites by email (single-use hashed token, 7-day expiry, seat cap counts active + pending), accept only when the signed-in address equals the invited one, remove/revoke; distinct `team_owner`/`team_member` roles so coach-mode lookups are untouched | `team-pools.ts`, `api/mcp/team`, `lib/mcp/team-invite-email.ts` |
| 4. Console | `/mcp/account` → Team: shared balance, allowance, seats, per-member 30-day usage (owner), invites, accept-from-link | `app/mcp/account/team-section.tsx` |
| 5. Migration | Audited, idempotent personal → pool transfer (allowance only; purchased credits refused by the SQL); FIFO ledger replay decides the Team-entitlement amount; dry-run default | `mcp_transfer_personal_to_pool`, `scripts/migrate-team-credits-to-pool.ts`, `lib/mcp/team-pool-migration.ts` |

**Defects fixed on the way** (repair ledger, 2026-09-29): an empty pool showed the personal paywall; a low pool would have fired the member's personal auto-recharge; uncharged pooled calls reported the personal balance; pooled members read as free-tier to the extraction guard.

**Proof:** `tsc` clean; full unit suite 746 files / 8,759 tests green; new tests: payer (12), team-pools pure (15), PGlite SQL over the real migration chain (12), pooled metering (4), pooled invoices (3); an injected regression was confirmed red.

**Dry runs (read-only, production):**
- `npm run migrate -- --only 20260929_pooled_team_credits.sql` → exactly 1 pending file; the unrelated pending `20260924_saved_search_forecast_watermark.sql` stays untouched.
- `scripts/migrate-team-credits-to-pool.ts` → 1 active Team subscriber; ledger replay: 2 Team grants (Aug 3 `app_tier_team` +1,000; Sep 1 `pro_monthly` +1,000, which was the Team allowance because Pro was 250 then), 0 spent, 0 purchased, no replay mismatch → **would move 2,000** and mark September's 1,000 as already paid. The subscriber ALSO holds an active Pro subscription, so the script refuses by default; `--email <x> --allow-pro-overlap` proceeds after human verification (recorded in the audit row).

**Pricing:** the Team / Growth / Agency seat-and-credit proposal is in the PRIVATE repo `ecoffie/govcon-proposals` at `mindy-pricing/seat-credit-pricing-proposal-2026-09-29.md` (kept out of this public repo). No public pricing, copy or `POOLED_PLAN_DEFAULTS` change until Eric approves it.

## 11. Rollout runbook — each step needs Eric's approval

1. **Merge + deploy the code.** Safe before the migration: with no `seat_limit` column, every path runs in the legacy mode (no team roles exist, so the payer resolves personal; the cron and invoice paths detect the missing schema and keep today's personal grants; provisioning is non-fatal).
2. **Apply the migration:** `npm run migrate -- --go --only 20260929_pooled_team_credits.sql`, then verify with `npm run db:check -- organizations seat_limit` and `npm run db:check -- mcp_pool_grants idempotency_key`.
3. **Migrate the existing Team subscriber** (same day, before their next renewal on the 3rd): dry run, then `npx tsx scripts/migrate-team-credits-to-pool.ts --email <subscriber> --allow-pro-overlap --go`. Verify: personal balance 0, pool 2,000, two ledger rows (`pool_migration_out` / `pool_migration_in`), one `mcp_pool_grants` audit row plus the September claim.
4. **Configure negotiated deals** (e.g. STOI Growth, 2 seats) with `POST /api/admin/team-pools` (`dryRun` first).
5. **Live acceptance** (criteria 1 to 10 above) on production with a test org, then invite a real member.
6. **Pricing:** decide the proposal; only then change `POOLED_PLAN_DEFAULTS` and public copy.

**Known follow-ups (not in this PR):** the subscriber pays for BOTH Pro ($149) and Team ($499), and Team already includes Pro features, so this is worth a support check; `/mcp/account` Billing still labels the refill pack "500 credits ($119)" while `packages.ts` grants 1,000 (a customer-visible number, left for its own change); Stripe per-seat quantity billing (self-serve "add a seat") is unbuilt.
