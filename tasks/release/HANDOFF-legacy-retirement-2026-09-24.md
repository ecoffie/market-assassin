# HANDOFF — legacy retirement into Mindy (2026-09-24)

Nothing has been merged or deployed, and no billing, grant, customer-message or production-sign-in action has been taken.
**The next step is REVIEW** of the frozen diffs and the manifest. Do not write another readiness packet or re-audit.

## PRs (all OPEN, all HELD)

| PR | Branch | Head | Base | Status |
|---|---|---|---|---|
| [#1671](https://github.com/ecoffie/market-assassin/pull/1671) | `fix/retire-legacy-ma-interfaces` | `57b74a38` | `main` | **FROZEN.** Partial migration. Do not expand |
| [#1675](https://github.com/ecoffie/market-assassin/pull/1675) | `fix/cancellation-entitlement-attribution` | `f37b7ab6` | `main` | Frozen. **Not releasable alone** (16/19 route proofs) |
| [#1676](https://github.com/ecoffie/market-assassin/pull/1676) | `test/1675-webhook-proofs` | `3814bf87` | #1675 | Proofs + 3 fixes (19/19). **Review with #1675** |
| [#1679](https://github.com/ecoffie/market-assassin/pull/1679) | `security/remove-shared-password-routes` | `7fbfc0fe` | #1671 | Removes the shared-password routes and the grace window. Review separately |
| [#1680](https://github.com/ecoffie/market-assassin/pull/1680) | `release-prep/legacy-retirement-2026-09-23` | this branch | `main` | Packet, manifest, dry-run scripts, this handoff |

## Dependencies

- #1676 is stacked on #1675. Merge them together, or re-freeze #1675 at #1676's head.
- #1679 is stacked on #1671. Merge it only after #1671 is live and verified.
- #1675/#1676 are independent of #1671.
- The next batch's legacy-route redirects (`/contractor-database`, `/content-generator`, `/planner`) use `src/lib/mindy/legacy-routes.ts`, which exists only in #1671. Build the functionality on `main`; add the redirect once #1671 has merged.

## Decisions standing (Eric, 2026-09-24)

- Keep #1671 frozen. The three remaining tools stay reachable **until their functionality and saved work exist in Mindy**. This is a temporary migration dependency, not an exception.
- Next implementation batch, in order: **Contractor Database → Content Reaper → Action Planner**. Build, test, open review PRs; no production changes. Design: `tasks/release/next-batch-content-db-planner-2026-09-23.md`.
- Shared-password grace window: **OFF** (no related environment variable is set in production).
- **Refunded buyer #4** (`cs_live_a1FG2WU0…`, $497 fully refunded, `dbaccess:` still present): leave unchanged pending a decision based on the refund plus any other valid entitlements. They also hold OH Pro, Recompete and Mindy Pro grants.
- **Never change shared Git config.** If the resolver refuses a push, use only `git -c core.hooksPath="$PWD/.githooks" push`. The absolute-path check shipped in #1681.

## Remaining decisions for Eric

1. Approve (or not) each manifest item S1–S7 and A1 (packet §4).
2. Google sign-in check in production: (a) Eric signs in with his own Google account (links an identity), or (b) skip it.
3. Buyer #4.
4. Whether to refund the $397 Recompete line for buyer #5.
5. The historical-restoration audit for past cancellations (scoped in packet §2).

## Evidence locations

| What | Where |
|---|---|
| Release packet, manifest, production acceptance plan | `tasks/release/legacy-retirement-release-packet-2026-09-23.md` (#1680) |
| Next-batch design + ownership rule | `tasks/release/next-batch-content-db-planner-2026-09-23.md` (#1680) |
| Dry-run production scripts | `scripts/release/legacy-retirement/` (#1680) |
| #1671 acceptance (129/129 @ `99c61662`; 74/74 @ `63bbe7a8`) | `tasks/evidence/legacy-retirement/` on #1671 |
| #1671 packet, proposals, Contractor DB incident | `tasks/retire-legacy-ma-interfaces-2026-09-23.md`, `tasks/legacy-retirement-proposals-2026-09-23.md`, `tasks/incident-contractor-db-checkout-2026-09-23.md` on #1671. ⚠️ The incident doc predates the buyer #4 refund finding; the correction is in the packet §4 A2 |
| #1675 proofs (16/19 before, 19/19 after) | `tasks/evidence/1675/` on #1676 |
| #1679 acceptance (131/131 @ `ef12f32f` and @ `7fbfc0fe`, strict 403) | `tasks/evidence/1679/` (#1680) |

## Local-only / not preserved

- **Unmasked buyer list for the Contractor DB incident** (session scratchpad, contains customer emails). **Deliberately not committed.** It is reproducible read-only: `npx tsx scripts/release/legacy-retirement/repair-db-buyer.mts --session <cs_id>` prints the masked evidence for each of the five sessions listed in packet §4.
- Screenshots from the acceptance runs (session scratchpad): not committed. The JSON reports above are.
- Worktree `.claude/worktrees/contractors-db` on branch `feat/contractors-sblo-contacts` (at `main` `c29974c5`): created at the very end of the session, **no changes and no commits**, not pushed. Safe to reuse or remove.
- The other worktrees (`retire-legacy-ma`, `cancel-attribution`, `1675-proofs`, `rm-shared-pw`, `release-prep`) are clean and equal to their remote heads.

## Known issues found, not fixed (for the batch)

- `/api/content-generator/library` returns 500 in production. It queries `content_library.user_email`, but the table is keyed by `user_id` (126 posts, 13 auth users). Replace the route with a session-scoped one; do not add the column.
- `/api/contractors/search-bq` returns no SBLO contact fields, although the Contractors panel's type declares them.
- Some routes still trust an unverified body `userEmail` (a broad weak-identity pattern; needs its own PR).
