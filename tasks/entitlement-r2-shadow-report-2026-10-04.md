# R2: canonical entitlement resolver, SHADOW MODE (2026-10-04)

**Verdict: R2 SHADOW READY (code), NOT YET RUNNING LIVE.**

The resolver, policy table and shadow hooks are built and tested:
- Full suite: 9,578 passed, 0 failed.
- `tsc` clean. Gate audits clean.

The offline shadow run is complete over the whole entitled population, and its results are below.

Live shadow logging needs three switches, each one Eric's call:
1. Apply `20261004_entitlement_shadow_log.sql`.
2. Merge and deploy the branch.
3. Set `ENTITLEMENT_SHADOW=true`, then deploy again so the variable binds.

With the flag unset, the shipped code does nothing at runtime.

**No entitlement, pricing, billing, Stripe, customer record or enforcement change was made.** Every read in this report was read-only. **Stopped before R3.**

---

## 0. APPROVED 2026-10-04: rulings locked; membership source built

### Rulings locked into `policy.ts`

| # | Ruling | Encoded as |
|---|---|---|
| D1 | Legacy-only owners keep exactly today's behavior. **Frozen cohort, nothing enforced.** | Source `legacy_mindy_grandfather`. It grants every capability `verifyMIAccess` or an ungated route gives them today, and still denies chat / briefings / playbook (`resolveAccess` already denies those) and all Team capabilities. **Frozen at 78 accounts** (§5's 77 + 1 legacy-only account whose duplicate profile rows made it `unknown`). The private snapshot is `.claude/auth-r2/d1-cohort-frozen-2026-10-04.json`, sha256 `419064cc…94e9fa6`. A legacy key written later does **not** join |
| D2 / D3 | Existing Free drafts / pipeline rows stay readable and exportable | Grandfather note on `proposal.*` / `pipeline.manage`. This is a data-access rule for R5, not a grant |
| D6 | Membership = an **active** qualifying $99 subscription **now** | Source `membership`, fed by the Stripe reconciler (below). Never from the classification snapshot |
| D6 (unruled) | past_due · $799/yr annual · Ongoing Coaching · the $99 free-trial product | Observed as `membership_past_due` / `membership_unruled`; **grants nothing** until ruled |
| D7 | Staff = Team capabilities (verified identity), non-revenue | `staff` → TEAM_CAPS |
| D8 | Advocate = Pro (comp), non-revenue | `advocate` → PRO_CAPS |

### Membership reconciler (`src/lib/entitlements/membership-reconciler.ts`)

**How it reads Stripe:**
- **Read-only sweep** of every price of the watched products, matched by product id (not name). The account sells about 15 "PRO Member …" products; only two are the ruled plan:
  - `prod_TaiXlKb350EIQs` "Copy of PRO Member Group - Monthly"
  - `prod_TMUmxKTtooTx6C` "Pro Member Plan - Monthly"
- **Status mapping:** `active`/`trialing` → active; `past_due`/`unpaid` → past_due; anything else is not a member now.
- **When a membership ends,** its row is closed (`ended`) by the next complete sweep, and the source disappears.

**Safety:**
- A sweep that errors anywhere writes nothing.
- A row is ended only by a **complete** sweep.
- It writes **only** `entitlement_source_observations`: no KV, no profile, no email, no Stripe write.

**How it runs:**
- Daily via `/api/cron/reconcile-entitlement-sources` (dispatcher Bearer auth; `?dry=1` previews).
- By hand: `scripts/reconcile-entitlement-sources.ts` (dry run by default).

**Live Stripe dry run, 2026-10-04:**
- `membership:active` **21**, `membership:past_due` 1.
- `membership_unruled:active` 8, `membership_unruled:past_due` 1.
- 0 subscriptions missing an email.

### Offline preview with the locked rulings

Run with `--preview-observations`, against live Stripe and the frozen cohort:

| | |
|---|---|
| **D1 legacy disagreement** | **77 → 0** accounts (the grandfather keeps today) |
| **D6 members** | All **21** resolve to Pro. They show **D→A only where they lack Pro today**: 13 accounts (9 + 2 with credits only, plus the grandfathered ones on chat / briefings / playbook) |
| **Unchanged categories** | D2 (15 Free proposal builders), D3 (4 Free pipeline managers), D7 staff, D8 advocate, and the unused Team-only workspace invite |
| **New** | 9 unruled-membership accounts are A→D on the ungated proposal / pipeline / teaming / relationships routes. 0 of them use them |

### Migration safety review (before any authorization)

`supabase/migrations/20261004_entitlement_shadow_log.sql` creates two **new** tables, and that is all it does:

| Check | Result |
|---|---|
| Changes to existing tables or data | **none.** No `ALTER` of an existing table, no `INSERT`/`UPDATE`/`DELETE` of existing data |
| Triggers / functions / views / foreign keys | **none** |
| Access | RLS on, no policies, so service role only. Nothing client-side can read or write |
| `entitlement_shadow_log` | Logging only, with no email (HMAC `subject_key`). **Retention: rows older than 30 days are deleted daily** by the reconciler cron. Indexes: `created_at` (retention) and a partial index on disagreements |
| `entitlement_source_observations` | Shadow-only **evidence**. No gate reads it; only the canonical resolver does, and only when `ENTITLEMENT_SHADOW=true`. Bounded at one row per (source, evidence_key): about 31 membership rows + 78 cohort rows. It is **not** purely a log, because it holds the membership and D1 evidence the resolver needs. It grants nothing; R3 decides whether a gate ever reads it |
| Reversibility | `DROP TABLE` on both returns the database to its prior state |

### Code-side guarantees

- The shadow hook runs only after the response is sent, is off unless `ENTITLEMENT_SHADOW=true`, never throws, and returns nothing.
- With the flag unset, the 31 hook sites do nothing. The new cron route only runs when its `cron_jobs` row exists, and that row is a separate authorization.

---

## 1. What R2 is

```
verified identity ──► resolveEntitlementSources()  ──► EntitlementSource[]   (read-only, src/lib/entitlements/sources.ts)
                  ──► capabilitiesFor(sources)      ──► Set<Capability>       (pure, src/lib/entitlements/policy.ts)
                  ──► canonicalDecision(cap, …)     ──► allow / deny + reason
shadowEntitlement({route, capability, currentAllow}) — after() the response; logs CURRENT vs CANONICAL
```

**Sources, not tiers.** A user holds any number of sources, and capabilities are their **union**. Removing one source never removes a capability that another source grants.

**Auth state is separate from entitlement state:**
- Auth: `LOGGED_OUT` / `LOGGED_IN`.
- Entitlement: `LOGGED_OUT` / `FREE` / `PRO` / `TEAM`, used as a report label only. Gates will ask for a capability, never a tier.

**No-behavior-change guarantees (each one tested):**
- **Off by default:** the hook does nothing unless `ENTITLEMENT_SHADOW` is exactly `true`.
- **No latency:** when on, it only schedules work with `after()`, which runs once the response has been sent.
- **Never throws:** it is safe outside a request scope, and the callback swallows resolver and DB failures.
- **No new outcomes:** it returns nothing and is called after the route's own decision. No new 402, unlock, Team change, legacy change or MCP charge.
- **No emails in the log:** `subject_key` is an HMAC (keyed with `ENTITLEMENT_SHADOW_SALT`, falling back to `CRON_SECRET`), truncated to 20 hex characters. That is enough to count distinct accounts and not enough to identify one.
- **Unknown, not guessed:** any failed read produces `canonical = unknown`, never a guessed allow or deny.

**Log row:** `route · capability · current_allow · canonical · agrees · source_categories · reason · subject_key`.

**Shadowed surfaces (31 hook sites).** Each one is placed right where the route already holds its decision.

| Gate today | Routes |
|---|---|
| `verifyMIAccess` 402 | target-list POST, auto-setup, target-events, target-enrichment, discover-events, target-outreach POST, pricing-intel, competitor-awards, market-narrative, market-report, bid-no-bid |
| `verifyMIAccess` preview-vs-full | market-dossier, target-market-research, market-overview, reports/generate-all |
| `hasProAccess` 403 | chat, chat-sessions, rag-doc, briefings/latest, briefings/verify |
| MCP tier gate | `get_winning_playbook` in `runMeteredTool`. Logging only: the charge path is untouched |
| Team | team/upgrade POST |
| **Ungated (leaks)** | pipeline POST/PATCH when the stage moves beyond `tracking`; proposal draft / draft-all / compliance / export; teaming POST; relationships POST; workspace invite POST |

## 2. Rulings preserved (not re-litigated)

**Legacy products:**
- Market Assassin (standard/premium), Contractor Database, Recompete Tracker, Opportunity Hunter Pro and Content Reaper map to **no Mindy capability**. Legacy access stays in the legacy systems.
- The old "legacy nondelivery" findings stay **retracted**.

**Other rulings:**
- **The $6,000 Team org:** access is delivered. Its Annual→Lifetime record correction is separate, and nothing here touches it.
- **Pursuit Briefs:** retired. No `pursuit_brief.*` capability exists, and a test asserts that.
- **The product line:** Free = discover; Paid = execute (organize · execute · produce · automate). Team ⊇ Pro.
- **MCP credits are a meter**, never an entitlement. The `mcp_credit_balance` source grants nothing.
- **$99 membership** = app Pro only, ending when the membership ends, with no monthly MCP credits (ruling 2026-10-03).
- **Staff** counts only from a verified identity (R1).
- **No new gates.** The policy table encodes only §15–16 of the entitlement audit, minus retractions and the retired feature.

## 3. Canonical capability matrix

**How to read the "Disagreement" column:**
- **A→D** = allowed today, denied by canonical policy.
- **D→A** = denied today, allowed by canonical policy.

Counts are distinct accounts from the offline run (§5); "using" = has data in that surface.

**Who holds the Pro / Team capabilities:**
- **Pro sources:** `stripe_pro`, `lifetime_mindy`, `founder`, `membership`, `manual_grant`, `pro_unattributed`, `trial`, `advocate`, plus the Team sources.
- **Team sources:** `stripe_team`, `staff`.
- **Grants nothing:** `legacy:*`, `mcp_credit_balance`.

### Discover (Free)

Holders: Logged-out = ✓ for the public rows, SI (sign-in required) for the rest. Free, Pro and Team = ✓.

| Capability | Production today | Disagreement |
|---|---|---|
| `map.browse` `horizons.view` `listing.detail` `incumbent.identity` `forecast.browse` `learn.discover` | public | none |
| `players.view` `contacts.listing` `win_probability.view` `market_research.standard` | auth only | none |

### Remember (Free, sign-in)

| Capability | Logged out | Free | Pro | Team | Production today | Disagreement |
|---|---|---|---|---|---|---|
| `save.bookmark` `save.track` `watch.create` `alerts.daily` `learn.track` | SI | ✓ | ✓ | ✓ | auth, no tier | none |

### Organize (Paid)

Holders for every row: Pro ✓, Team ✓; Logged out and Free —.

| Capability | Production today | Disagreement |
|---|---|---|
| `target_list.manage` | **402 via `verifyMIAccess`** (POST, auto-setup, events, enrichment) | **A→D 77 legacy-only** (6 using) · D→A 14 staff, 1 advocate |
| `outreach.log` | 402 via `verifyMIAccess` | A→D 77 legacy-only (0 using) · D→A 14 staff, 1 advocate |
| `pipeline.manage` (stage beyond `tracking`) | **ungated** | A→D: every Free account. **Using: 4 Free + 4 legacy-only** |
| `teaming.manage` | ungated | A→D every Free account · **0 using anywhere** |
| `relationships.manage` | ungated | A→D every Free account · using: 2 legacy-only, 0 Free |
| `contacts.roster` | ungated (`federal-contacts`, auth only) | Not shadowed: no write action to hook. E6 says instrument usage before gating |

### Execute (Paid)

Holders for every row: Pro ✓, Team ✓; Logged out and Free —.

| Capability | Production today | Disagreement |
|---|---|---|
| `bid_decision.ai` | 402 via `verifyMIAccess` (`hasPaidProductTier`). **The Team 402 bug is already fixed on main** | A→D 77 legacy-only · D→A 14 staff, 1 advocate |
| `pricing_intel.view` | 402 via `verifyMIAccess` (verified identity since R1) | same 77 / 14 / 1 |
| `competitor.analyze` | 402 via `verifyMIAccess` | same 77 / 14 / 1 |
| `market_report.generate` | 402 via `verifyMIAccess` | same 77 / 14 / 1 (1 legacy-only and 1 staff using) |
| `market_research.full` + `market_narrative.generate` | preview vs full, or 402 via `verifyMIAccess` | same 77 / 14 / 1 |
| `incumbent.depth` `forecast.export` | ungated / CSS blur | Not shadowed: no discrete action to hook (R4/R5) |

### Produce (Paid)

Holders for every row: Pro ✓, Team ✓; Logged out and Free —.

| Capability | Production today | Disagreement |
|---|---|---|
| `proposal.build` | **ungated** | A→D every Free account. **Using: 15 Free + 4 legacy-only** (grandfather: existing drafts stay readable and exportable) |
| `proposal.compliance` `proposal.export` | ungated | A→D every Free account (no per-user usage log) |

### Automate (Paid)

| Capability | Logged out | Free | Pro | Team | Production today | Disagreement |
|---|---|---|---|---|---|---|
| `briefings.ai` (`briefings.weekly`, `alerts.recompete` = cron audiences) | — | — | ✓ | ✓ | 403 via `hasProAccess` | D→A 17 staff, 1 advocate |

### AI

| Capability | Logged out | Free | Pro | Team | Production today | Disagreement |
|---|---|---|---|---|---|---|
| `chat.ask` | — | — | ✓ | ✓ | 403 via `hasProAccess` | D→A 17 staff, 1 advocate. **Legacy-only: agree (both deny)** |
| `mcp.tools` | — | ✓ (credits) | ✓ | ✓ | credit-metered | none |
| `mcp.playbook` | — | — | ✓ | ✓ | `isProForMcp` → `resolveAccess` | D→A 17 staff, 1 advocate |

### Team

Holders for every row: Team ✓ only.

| Capability | Production today | Disagreement |
|---|---|---|
| `workspace.share` | **Two surfaces disagree with each other.** `team/upgrade` POST requires Team. **`workspace` invite POST is ungated: any signed-in owner can invite 5 seats** | Invite route: A→D for every non-Team account (112 paid Pro, 77 legacy, 4 advocates, all Free). **0 non-Team accounts have ever invited.** `team/upgrade`: D→A 22 staff |
| `seats.manage` `coach.clients` | `resolveCoachAccess` / seat cap | Not shadowed in R2 |

## 4. Source matrix (population of 2026-10-04)

| Source | Grants | Accounts | Counts as revenue? |
|---|---|---|---|
| `stripe_team` | Team ⊇ Pro | 9 | yes |
| `stripe_pro` (live grant + classification `subscription`/`1_year`) | Pro | 66 | yes |
| `lifetime_mindy` (live grant + classification `lifetime`) | Pro | 9 | yes |
| `founder` | Pro | 0 attributed (no classification product names Founders) | yes |
| `membership` ($99, `stripe_member` reconciler grant) | Pro (app only) | **0: feed not built** (see D6) | yes |
| `manual_grant` (`mi_admin_grants`) | Pro | 2 | per grant |
| `pro_unattributed` (KV `briefings:` = bare `true`, no record of why) | Pro | **54** | unknown |
| `trial` | Pro until expiry | 1 (internal) | no |
| `staff` (verified identity) | Team | 24 | no |
| `advocate` | Pro | 5 | no |
| `legacy:*` | **nothing in Mindy** | 77 legacy-only; MA-standard 50 · OH Pro 48 · CDB 43 · Content 43 · Recompete 41 · MA-premium 26 (overlapping) | n/a |
| `mcp_credit_balance` | **nothing** (meter) | 134 | n/a |

**Canonical states:**
- 342 accounts hold any source or use an ungated paid surface: TEAM 31 · PRO 118 · FREE 193.
- Free users with no source and no usage aren't enumerated. For them, current and canonical agree on every gated surface by construction.

## 5. Disagreement report — every category where switching would change behavior

### Paying customers who would LOSE something

**D1. Legacy-only owners (77 accounts): REQUIRES GRANDFATHERING / A RULING BEFORE R3.**

| | |
|---|---|
| **Current** | `verifyMIAccess` counts any legacy KV key as "pro". They therefore pass every 402 gate: target list, outreach, pricing intel, competitor, narrative, market report, bid/no-bid, full market research. They already get 403 on chat, briefings and the playbook (`resolveAccess`) |
| **Canonical** | Legacy confers no Mindy capability (Correction 1), so DENY on those 8 capabilities |
| **Using today** | Target list 6 accounts · market report 1 · pipeline (managed) 4 · proposals 4 · relationships 2 |
| **Transition** | Correction 3g already rules this an **over-grant pending D3, with no downgrade now**. Flipping R3 as-is would remove access these 77 have had, and 13+ of them actively use it. The 8 $99 members with legacy keys (App. H) are inside this 77, and the `membership` source (D6) would keep their Pro. Eric's options: (a) grandfather the 77 with a named, auditable `legacy_mindy_grandfather` source (keeps today's behavior and makes the over-grant explicit and countable); (b) grandfather only the 13 who actually use a paid surface; (c) downgrade with notice. **Recommendation: (a) for R3, revisit later.** It is the only option that changes nothing for a paying customer, and it is consistent with D3 |

**D1b. Pro subscribers on the workspace-invite route.** Canonical is Team-only, and 112 Pro, 4 advocate and 77 legacy accounts can invite today. **0 have ever done so**, so nobody loses anything in practice.

### Free users currently receiving a Paid execution capability

| # | Capability | Free accounts actually using it | Grandfather required |
|---|---|---|---|
| D2 | `proposal.build` (draft / draft-all) | **15** (14 with no source, 1 with only MCP credits) | **Yes (E7):** existing drafts stay readable and exportable; new builds gated |
| D3 | `pipeline.manage` (stage beyond tracking) | **4** | **Yes (E3):** tracking stays Free; rows already in `pursuing` keep read/access; destroy nothing |
| D4 | `proposal.compliance`, `proposal.export` | not measurable (no per-user log). The live shadow will measure it | Export of existing drafts stays available (E7) |
| D5 | `teaming.manage`, `relationships.manage`, workspace invite | **0** Free accounts | No (E8: zero users) |

*Every* other Free account is "A→D" on these ungated surfaces in principle, but has never used them.

### Denied today, allowed canonically (unlocks — no one loses)

**D6. $99 members (21 proven per App. H, 2026-09-27).** Ruling: an active membership = Pro.

| | |
|---|---|
| **Today** | 13 have nothing. 8 pass the 402 gates via legacy keys but are denied chat / briefings / playbook |
| **Canonical** | ALLOW once the source is fed |
| **R2 caveat** | The runtime resolver **cannot see membership yet.** `customer_classifications` can't establish it: it's a May snapshot, and `products_purchased` is usually empty. The source is wired to `mi_admin_grants.grant_source='stripe_member'`, which only the planned reconciler writes. So the live shadow will **not** surface these 21 until that reconciler exists, and this number comes from Stripe (App. H), not from the shadow |
| **Required before enforcing** | Revoke-on-end, per the 10-03 ruling |

**D7. Staff without a customer entitlement.**

| | |
|---|---|
| **Accounts** | 14 on the `verifyMIAccess` gates · 17 on `resolveAccess` gates · 22 on `team/upgrade` |
| **Today** | DENY. The staff bypass has been dead since R1 (no caller passes `identityVerified`) |
| **Canonical** | ALLOW (staff = all capabilities, verified identity only) |
| **Transition** | None; it is a gain. Staff must stay excluded from paid metrics and campaigns. **Ruling to confirm:** does staff get Team capabilities (as modeled) or Pro only? |

**D8. Advocate with no live grant (1).**
- **Today:** DENY everywhere.
- **Canonical:** ALLOW (the comp-Pro registry).
- **Transition:** none.
- The other 4 advocates already hold a grant.

### Agreement worth stating

- **Team (9) agrees on every gate**, because the Team 402 bug is already fixed by `hasPaidProductTier`. The only difference is the ungated invite route, which Team is allowed on both ways.
- **Pro subscribers (`stripe_pro`, `lifetime_mindy`, `manual_grant`, `pro_unattributed`) agree on every gate**, except the ungated workspace invite (D1b).
- **Trials:** 1 active, internal. The audit's "trial users get 402 on `verifyMIAccess` gates" class affects **0 customers** today.

### Record mismatches surfaced (no behavior change, no action taken)

| Class | Count | Effect |
|---|---|---|
| Duplicate `user_profiles` rows for one email | **3** | `maybeSingle()` errors, so today's helpers **silently drop** the profile-side grant (`access_briefings` / `access_team`). The canonical resolver reports `unknown` instead of guessing. All 3 currently pass on KV or legacy keys |
| `customer_classifications` says paid, but no live grant exists | **62** | Classification is a 2026-05 snapshot (members, coaching, churned). It's used only to *attribute* live grants, never to create one |
| Live Pro grant with no recorded origin (`pro_unattributed`) | **54** | KV `briefings:` holds a bare `true`. The grant is honored, but its source should be attributed (Stripe / comp / bundle) before any source-specific policy |

## 6. Transition table for R3 (decisions needed; nothing is executed)

| # | Category | Accounts | Change if R3 flips as-is | Required first |
|---|---|---|---|---|
| D1 | Legacy-only (via `verifyMIAccess`) | 77 (13+ using) | **Lose** 8 paid capabilities | **Eric's ruling:** grandfather source (rec.) / usage-based / notice |
| D1b | Pro on workspace invite | 112+ (0 using) | Lose an unused ability | none (E8) |
| D2 | Free proposal builders | 15 | New builds gated | Grandfather read/export (E7) |
| D3 | Free managed pipeline | 4 | Can't advance stages | Grandfather existing rows (E3) |
| D6 | $99 members | 21 | Gain Pro | `stripe_member` reconciler + revoke-on-end |
| D7 | Staff | 14–22 | Gain all | Confirm staff = Team vs Pro |
| D8 | Advocate without a grant | 1 | Gain Pro | none |
| — | Duplicate profile rows | 3 | Unknown → must not fail closed | Dedupe the rows before enforcement |

## 7. How to turn live shadow on (each step is Eric's go)

*(Superseded ordering: see §9.)*

1. `npm run migrate` → `npm run migrate -- --go` (creates `entitlement_shadow_log`).
   - Verify through PostgREST: `npm run db -- entitlement_shadow_log --count` returns 0, not an error.
2. Merge the PR and wait for READY. With the flag unset, production behavior is identical.
3. Set the flag with `printf 'true' | vercel env add ENTITLEMENT_SHADOW production`, then make an empty commit and deploy.
4. After about 7 days, read the disagreements:
   ```sql
   select capability, current_allow, canonical, source_categories, count(*), count(distinct subject_key)
   from entitlement_shadow_log
   where agrees is not true
   group by 1, 2, 3, 4
   order by 5 desc;
   ```
   Expect D1/D2/D3/D7/D8 and nothing else; anything outside them is a finding. D6 will be absent until the reconciler exists.

**Re-run the offline report at any time:**
```
npx tsx scripts/entitlement-shadow-report.ts --private .claude/auth-r2
```
It is read-only. The `--private` detail contains emails and must stay untracked.

## 8. Not in R2 (deliberately)

- `GET /api/me/capabilities` and the CI gate against scattered tier checks: those are R3/R4.
- Any enforcement, any new 402, any Team / legacy / MCP-charging change.
- The `stripe_member` reconciler: prepared in `commercial-actions-packet-2026-10-03.md` §3, not built.
- Shadowing `contacts.roster`, `incumbent.depth`, `forecast.export`, `seats.manage`, `coach.clients`: none has a discrete server action to hook today.

## 9. Authorized rollout order (approved 2026-10-04)

1. Merge on exact-head green CI and deploy with `ENTITLEMENT_SHADOW` **unset**.
2. **Prove parity:** the shadowed routes return the same status and body shape as before. A probe matrix (Free / Pro / Team / logged-out) runs against prod before and after.
3. Apply the migration, then verify both tables through PostgREST.
4. Seed: `seed-legacy-grandfather-cohort.ts <frozen snapshot> --go` (78) and `reconcile-entitlement-sources.ts --go` (31).
5. Register the `cron_jobs` row `reconcile-entitlement-sources` (daily).
6. Set `ENTITLEMENT_SHADOW=true` in Production and redeploy.
7. Collect until every gated capability has real calls (or a stated reason it doesn't).
8. Report `capability | current | canonical | source | affected calls/accounts`.

**No R3 until Eric reviews that report.**
