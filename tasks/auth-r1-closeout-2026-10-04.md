# R1 identity hardening — closeout (2026-10-04)

**Status: PRODUCTION PROVEN / CLOSED.**

R1 had one goal. Mindy identifies a caller only from verified authentication: a Mindy session, a Supabase session, a signed email-action link, or (for the briefing automation API only) a scoped connection key. An email address in a request is never proof of who is asking. At most it is a claim that must match the verified identity.

## 1. R0 observation — completed

- **Window:** R0 (#1722) measured how every identity check was satisfied in production for seven days, 2026-09-27 → 2026-10-04T04:07Z.
- **Finding:** legacy authentication was still in use by a small number of paying `/briefings` readers. No other customer surface depended on it.
- **Decision:** migrate those readers first, then remove legacy identity.

## 2. Customer migration came first

Legacy `/briefings` readers were moved to a verified session **before** anything was removed (#1801, production-proven 2026-10-03):

- A remembered or typed address now only pre-fills a one-time secure sign-in link sent to that mailbox.
- Consuming the link establishes a verified session for that account.
- After #1801: zero successful legacy-authenticated briefing reads.

No entitlement, price or briefing capability changed for those customers.

## 3. What shipped

| PR | Merge | Change |
|---|---|---|
| **#1811** | `9e2e5b27` | Removed the legacy weak identity methods from the shared identity check, for every route. One canonical verified-identity helper in `src/lib/api-auth.ts` (`getVerifiedIdentity` / `verifyClaimedIdentity` / `identityFailureResponse`). Credential issuance, OAuth consent and the account endpoint use it directly. |
| **#1813** | `88b6124e` | The Lindy / automation data routes serve only the verified caller's own data. New scoped **`briefings:read`** connection keys (shown once, revocable) let automations read the owner's own briefings and nothing else; MCP keys are refused there. The Lindy setup page uses an authenticated "Create connection key" flow instead of email-based polling. |
| **#1816** | `cb0ef1ac` | The remaining Mindy Pro gates read entitlement only for the verified caller. Unauthenticated callers get 401, or the Free view on public surfaces. Their in-app clients send the session. |

## 4. Production acceptance

Each PR was verified the same way:

1. CI (`verify`) green on the exact PR head.
2. Merged pinned to that head.
3. Normal production deploy.
4. Adversarial acceptance against production **after** it served the merge commit, using synthetic `@example.com` identities only.

| PR | Checks | Result |
|---|---|---|
| #1811 | 32 | **32/32** |
| #1813 | 27 | **27/27** |
| #1816 | 39 | **39/39** |

- **#1816 included a paying account:** a synthetic account was given paid access for the test, so an incorrect gate would have visibly unlocked paid features. None did. The paid fixture was removed afterwards.
- **Zero weak-method logins after #1811 went live.** The identity observation shows no authentication through a removed method since the #1811 deploy.
- **All synthetic acceptance state was cleaned up.** Every synthetic row, key and fixture created during acceptance was deleted and re-counted at zero.

Regression tests, all red against the pre-fix code and green after:
- `src/lib/r1-verified-identity.unit.test.ts`
- `src/lib/lindy/lindy-identity.unit.test.ts`
- `src/lib/r1-pro-gates.unit.test.ts`

## 5. What R1 does not cover (separate lanes, not unfinished R1)

- **Legacy email-activated products** (the older one-time-purchase tools) still identify buyers by their purchase email. Those customers need an **authenticated transition** before the legacy gates can be retired. That is its own migration lane, `tasks/legacy-email-activation-migration-lane-2026-10-04.md`, and not open R1 work.
- **R2** (follow-on entitlement work) has not started.

## 6. Superseded

**#1750**, the original R1 draft, is closed as superseded by #1811 / #1813 / #1816. It was not merged or rebased: it predates several shipped fixes, and was rebuilt against current `main` instead.
