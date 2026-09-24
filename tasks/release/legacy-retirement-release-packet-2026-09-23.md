# Legacy retirement — release preparation packet — 2026-09-23

**Status: PREPARED, NOT EXECUTED.** No merge, deploy, billing change, access grant or customer
message has been made. Every production command below is dry-run by default and needs `--go`.
No command in this packet contains a secret — the scripts read `.env.local`.

---

## 0. Frozen heads

| PR | Branch | Frozen head | Role |
|---|---|---|---|
| **#1671** | `fix/retire-legacy-ma-interfaces` | **`57b74a38`** | Retire legacy entry points into `/app` (partial migration) |
| **#1675** | `fix/cancellation-entitlement-attribution` | **`f37b7ab6`** | Cancellation revokes only attributable access |
| **#1676** | `test/1675-webhook-proofs` → base #1675 | **`3814bf87`** | Route-level proofs for #1675 **+ 3 defect fixes** |
| **#1679** | `security/remove-shared-password-routes` → base #1671 | **`7fbfc0fe`** | Remove both shared-password routes and the grace window. Production-build acceptance 131/131 on `ef12f32f` |
| this PR | `release-prep/legacy-retirement-2026-09-23` | see PR | Packet, manifest, dry-run scripts. Docs + scripts only. |

⚠️ **#1675 at `f37b7ab6` is not releasable alone.** The proofs in #1676 run against it and 3 of 19 fail —
three real defects (§2). Release #1675 **together with** #1676, or re-freeze #1675 at #1676's head.
#1671 is NOT expanded to build the three remaining tools; those are the next batch (§6).

---

## 1. #1671 — focused final review (head `57b74a38`)

**What it does.** Every legacy entry point for Market Assassin, Alert Pro, Opportunity Hunter,
Recompete, the bundles and the pre-`/app` dashboard lands in the current `/app`. The redirects are
307s, preserve the view, and carry only an allowlisted set of parameters. Paid CTAs go to
sign-in, not pricing. Emails, the activation page and the purchase-success pages link to `/app`.
Single-use report codes redeem inside Mindy as a report credit. Magic-link sign-in returns to the
intended view. The shared alert-preferences page is Mindy-branded.

**What it deliberately does not do.**
- Content Reaper, the Contractor Database and the Action Planner stay reachable. Their migration is the next batch (§6).
- No billing, grant or preference change.
- The shared-password routes still exist at this head. Their removal is #1679.

**Evidence tied to heads** (all local; a fake identity provider = integration evidence, not production authentication proof):

| Head | Evidence |
|---|---|
| `99c61662` | Production-build acceptance **129/129**, 0 writes forwarded; full unit suite 7,602 passed; gate passed |
| `63bbe7a8` | Focused production-build acceptance **74/74**, with the magic link opened in a new tab; mutation proof red→green |
| `57b74a38` | Docs + evidence JSON only over `63bbe7a8`; typecheck clean; pre-push gate passed (full unit suite) |

**Review focus.**
- `src/lib/mindy/legacy-routes.ts` + `src/proxy.ts`: routing contract.
- `src/app/access/[code]/page.tsx` + `api/reports/generate-all`: code redemption. Email must match, the session is required, and the code is marked used after the report succeeds.
- `src/lib/mindy/post-login-intent.ts`: sanitized, single-use, 1-hour TTL.
- `src/lib/email/legacy-destination-guard.ts`: every rendered paid email is tested through the tracking wrapper.

---

## 2. #1675 + #1676 — focused final review

**Rule.** A cancellation removes only the grants whose only source is the cancelled subscription.
Other purchases, comps and live subscriptions keep theirs. Paid-through access expires at period
end. Retries (`past_due`/`unpaid`) revoke nothing. Uncertain attribution keeps access.

**Route-level proofs** (`tests/unit/cancellation-webhook-proofs.test.ts`): the real `POST`, in-memory KV with TTL, Supabase and Stripe fakes, synthetic identities.

| Scenario | #1675 `f37b7ab6` | #1676 `3814bf87` |
|---|---|---|
| Duplicate event — warm instance; redelivered to a cold instance | ✓ ✓ | ✓ ✓ |
| Out-of-order: `past_due` after deletion; stale deletion after re-subscribing (same customer) | ✓ ✓ | ✓ ✓ |
| **Out-of-order: stale deletion after re-subscribing on a *different* Stripe customer, same email** | **✗ revoked the new sub's access** | ✓ |
| **Out-of-order: checkout grant replayed after the subscription was cancelled** | **✗ re-granted** | ✓ |
| Overlapping: FHC + MA purchase; Alert Pro while FHC live; comp account | ✓ ✓ ✓ | ✓ ✓ ✓ |
| Paid-through: expires at period end, flags kept; re-subscribing clears the expiry | ✓ ✓ | ✓ ✓ |
| Payment retries: `past_due` / `unpaid` revoke nothing, the later deletion does | ✓ ✓ | ✓ ✓ |
| Unknown provenance: object-valued grant kept; KV / list / purchases read failure → kept | ✓ ✓✓✓ | ✓ ✓✓✓ |
| **KV write failure during revocation** | **✗ 200 → Stripe never retries** | ✓ 500 + dedup released |
| **Total** | **16/19** | **19/19** |

Evidence: `tasks/evidence/1675/` on #1676 (same test file for both runs).

**Residual, stated.**
- The fake KV assumes `SET` clears a pending expiry. That is Redis semantics, not measured against Upstash.
- The shop and govcongiants.com endpoints also receive `checkout.session.completed`. A replay there is outside this repo.
- Only the getmindy.ai endpoint receives subscription events (Stripe endpoint list, read-only).

**Historical restoration — a separate audit, not in #1675/#1676.** Scope: every FHC / Alert Pro
`customer.subscription.deleted` or `updated→canceled/past_due/unpaid` event before the fix. For
each, recompute the plan with today's rules against Stripe + `purchases`. Flag only customers whose
`ma:` / `ospro:` / `alertpro:` was removed while another source existed. Output is a table for
decision; no automatic re-grant.

---

## 3. #1671 production acceptance (after merge + READY)

**Test account: `eric@govcongiants.com`.**
- Staff, therefore Pro; `hasProAccess` passes, so password login exercises the real paid-2FA path.
- Password set; identities `email` + `azure`.
- Recorded as the intentionally blank test account.
- Staff is excluded from campaigns and never counts as paid.

**Google return needs a decision.** No internal account has a Google identity; `@govcongiants.com`
is Microsoft 365. Options:
- (a) Eric signs in with a Google account he owns. This links or creates an auth identity, which is a test write.
- (b) Skip, and record Google as covered only by local integration.

| # | Check | How | Pass |
|---|---|---|---|
| P0 | Deploy | Merge → production deploy READY for the merge SHA | `prod-smoke-1671.mts --expect-sha <merge-sha>` reports the serving build |
| P1 | Smoke | `npx tsx scripts/release/legacy-retirement/prod-smoke-1671.mts --expect-sha <merge-sha>` | 10/10 (**today, before release: 2/9** — baseline recorded) |
| P2 | Password + 2FA | Signed-out browser → `getmindy.ai/app?panel=research` → password → code from the eric@ inbox | Lands on `/app?panel=research`, Pro |
| P3 | Magic-link destination | Signed-out → `getmindy.ai/app?panel=research&redeem=<CODE from P5>` → "email me a link" → open the link **in a new tab** | Lands on `/app?panel=research`; the report-credit banner is shown |
| P4 | Google return | Only if (a) is approved: "Continue with Google" from `/app?panel=pipeline` | Returns to `/app?panel=pipeline`, not onboarding |
| P5 | One-use report redemption | `test-report-code.mts --issue --email eric@govcongiants.com --go` → open `/access/<CODE>` signed in → generate one report → `--status <CODE>` → open the link again | `used=true` after the first report; the second visit shows "already used" |
| P6 | Branding | Open `/alerts/preferences` | Mindy logo, no "GovCon Giants" header |
| P7 | Cleanup | `test-report-code.mts --revoke <CODE> --go` | `access:<CODE>` absent |

**Writes these checks cause, separated.**

| Class | What | Where |
|---|---|---|
| **Normal test writes** | Session tokens; one `two_factor_codes` row; magic-link auth event; `user_engagement` events; `mindy_post_login_intent` / report-credit localStorage (browser) | Supabase / browser |
| **Normal test writes** | `access:<CODE>` + one `access:all` entry (removed in P7); `rl:report:eric@…` counter | KV |
| **Credits / cost** | One Market Research report generation (LLM spend counted against eric@'s per-user budget); no MCP credits | LLM providers |
| **Google (only if P4-a)** | A Google identity linked to Eric's account | Supabase auth |
| **Customer changes** | **None.** No customer account is read, signed into or modified | — |

---

## 4. Production action manifest (each item needs explicit approval)

Record files hold before-state and, for A1, an email. Write them **outside the repo**, e.g.
`~/release-records/2026-09-23/`.

### S1–S7 — Stripe payment links (`scripts/release/legacy-retirement/stripe-links.mts`)

Verified read-only on 2026-09-23. The script re-verifies at apply time and refuses any mismatch.

| # | Link | Sells (only) | Active | After completion | Action |
|---|---|---|---|---|---|
| S1 | `plink_1TBXg2K5zyiZ50PBp5xvOJP2` | Alert Pro `prod_U9rOClXY6MFcRu` $19/mo | true | `/alerts/preferences?upgraded=true` | **deactivate** |
| S2 | `plink_1SlcMfK5zyiZ50PBVn60ByyO` | Federal Contractor Database `prod_Tj4VbFiOz1VzyL` $497 | true | hosted | **deactivate** |
| S3 | `plink_1SxuVtK5zyiZ50PBmxd7LM9F` | Ultimate Giant Bundle `prod_TrU0CviMWdDTnj` $1,497 | true | hosted | **deactivate** |
| S4 | `plink_1TND04K5zyiZ50PBQ1WruM46` | Ultimate Giant Bundle `prod_TrU0CviMWdDTnj` $500 | true | hosted | **deactivate** |
| S5 | `plink_1SzGrLK5zyiZ50PBS9w6qvI7` | Upgrade to Tool Bundle `prod_TxBDjSHrFeL0sE` $500 | true | hosted | **deactivate** |
| S6 | `plink_1TTYfRK5zyiZ50PBkZ4mukPq` | Mindy Pro `prod_UI5RXVGKsdywuf` $149/mo | true | `getmindy.ai/briefings?welcome=true` | **redirect → `https://getmindy.ai/app`** |
| S7 | `plink_1TTYhlK5zyiZ50PBGhvWwBLq` | Mindy Pro `prod_UI5RXVGKsdywuf` $1,490/yr | true | same | **redirect → `https://getmindy.ai/app`** |

- **Before:** `npx tsx scripts/release/legacy-retirement/stripe-links.mts` (read-only; 7/7 ✓ today).
- **Plan:** `… --apply`.
- **Apply:** `… --apply --go --record ~/release-records/2026-09-23/stripe-links.json`. After applying, the script re-reads every link and asserts it.
- **Rollback:** `… --rollback ~/release-records/2026-09-23/stripe-links.json --go`. This restores `active` + `after_completion` exactly.
- **Effect on existing customers:** none. Deactivating a link stops new checkouts; it does not touch the one live Alert Pro subscription (grandfathered, §5) or any past buyer.
- **Surfaces that will show Stripe's "deactivated" page afterwards** (follow-ups, not blockers):
  - `/database-locked` (still served) and `src/lib/products.ts` `CONTRACTOR_DATABASE` / `ULTIMATE_GOVCON_BUNDLE`;
  - `src/app/store/page.tsx` (currently 308-redirected);
  - in **govcon-shop**, `next.config.ts` redirects to S2 and S3, and `public/resources/tribal-contractor-list.html` links S2.
- **Ordering with the merge:** S6/S7 can go before or after #1671. `/briefings?welcome=true` works either way once #1671 is live, and the new redirect works on today's production.

### A1 — Contractor Database buyer #5 (`scripts/release/legacy-retirement/repair-db-buyer.mts`)

| Field | Value (read-only, 2026-09-23) |
|---|---|
| Session | `cs_live_a1rV8O2mbhjPuszDfsKS4YvrXWTDcdiPmkEyowlKqDBVgqThfzrywoNfHQ` · 2026-07-21 · complete / paid |
| Payment | `pi_3Tvdi3K5zyiZ50PB19IFNenl` succeeded, $894 received, **no refunds** |
| Line items | Federal Contractor Database `prod_Tj4VbFiOz1VzyL` $497 + Recompete Contracts Tracker `prod_TmMbpcfofGpDZd` $397 |
| Link | `plink_1SlcMfK5zyiZ50PBVn60ByyO` (metadata `tier: contractor_db`) |
| Buyer | w***e@gmail.com (taken from the session, never typed) |
| Current access | `dbaccess:` **ABSENT**, not in `db:all`; `recompete:` absent; `briefings:` present (Mindy Pro, separate $149, 2026-07-11) |

- **Before / verify:** `npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --session cs_live_a1rV8O2m…` → all 6 evidence checks ✓, `dbaccess: ABSENT`.
- **Apply (no email):** `… --session cs_live_a1rV8O2m… --go --record ~/release-records/2026-09-23/db-buyer-5.json`. This calls the real `createDatabaseToken()` and reads back.
- **Idempotent:** a re-run finds `dbaccess:` present and does nothing (proven today against buyers #1–#3).
- **After:** a re-run prints `already has Contractor Database access — no-op`.
- **Rollback:** `… --rollback ~/release-records/2026-09-23/db-buyer-5.json --go`. It removes only the grant this record created, and refuses if the token differs.
- **Not granted:** `recompete:` — the tracker is discontinued, and Recompetes is in their Mindy Pro. Refunding the $397 line is a separate decision.

### A2 — Finding, correction to the earlier incident doc: buyer #4 was refunded

Session `cs_live_a1FG2WU0…` (2026-05-02, c***g@familylifeenhancement.com): **$497 fully refunded**, yet
`dbaccess:` is present. The same account also holds OH Pro, Recompete and Mindy Pro grants. The
#1671 incident doc said "4 have access"; that is true, but one of the four is no longer paid.
**No action proposed without a decision.** Leave it (goodwill), or revoke `dbaccess:` only.
The repair script refuses this session by design.

### Order

1. S2 (stop DB sales).
2. A1.
3. S1, S3–S5.
4. S6, S7.
5. Merge #1675+#1676 (independent of #1671).
6. Merge #1671 → P0–P7.
7. Merge #1679 → re-run the P1 smoke plus a 404 check on both password routes.

---

## 5. Alert Pro (no action)

One subscriber (`sub_1TvookK5zyiZ50PBWnM2pa8R`, renews 2026-10-22), grandfathered at $19 with
unchanged access. S1 stops new sales only.

## 6. Shared passwords

- **Grace window: OFF.** `LEGACY_SHARED_PASSWORD_ACCESS`, `MA_ACCESS_PASSWORD` and `RECOMPETE_*` are all absent from production (variable names checked read-only). The code default is off.
- **Removal is prepared in #1679** (stacked on #1671):
  - Both routes are deleted.
  - The grace/`keepFor` code is removed, so the legacy resolver ignores cookies.
  - `getEmailFromRequest` accepts only email-shaped values, so `authorized-user` is no longer an identity.
  - The acceptance harness asserts both routes 404.
- **Out of scope, noted:** `getEmailFromRequest` still trusts an unverified `userEmail` in request bodies for some routes. That broader weak-identity pattern needs its own PR.

## 7. Next contained batch

See `tasks/release/next-batch-content-db-planner-2026-09-23.md`.
