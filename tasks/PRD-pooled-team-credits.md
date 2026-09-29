# PRD: Pooled Team Credits

**Status:** PRD only (see end of doc)
**Owner:** Eric / Engineering
**Date:** September 29, 2026
**Trigger:** The first multi-user subscription deal (a two-user client, proposal sent Sep 29, 2026) could not be sold as "one plan, shared credits," because credits only live on individual accounts. It is being delivered with a workaround (paid plan on one account plus a sponsored entitlement for the second user). Client details live in the private `ecoffie/govcon-proposals` repo, never here: this repo is public.
**Prior work this completes:** the "Teams shared-MCP" sequence, PRs 2 through 4A (migrations `20260908_mcp_credit_pool.sql`, `20260909_mcp_pool_debit.sql`, resolver `src/lib/mcp/payer.ts`). PR 4B (fund the pools) was never built.

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

---

**Status:** ☑ PRD only: do NOT execute yet · ☐ Approved to build
