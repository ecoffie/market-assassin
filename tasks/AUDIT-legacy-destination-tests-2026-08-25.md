# Audit — tests whose expectations rest on `/app` or `/briefings` being the destination

**Run 2026-08-25 after the email migration fix (#1362). Read-only; nothing was changed.**

> Rule applied: **preserve the behavioral contract; update only the legacy destination
> assumption.** A test that encodes retired product architecture becomes either a migration
> blocker or false confidence.

## The two tests I rewrote — both re-checked

| test | its real subject | destination changed | subject still asserted? |
|---|---|---|---|
| `dashboard-cta.unit.test.ts` | the CTA carries `?email=` so the landing can identify the recipient | `/briefings` → `/opportunity-map` | **yes** — `toBe('…/opportunity-map?email=user%40example.com')`, plus case/whitespace normalisation and `+tag` encoding |
| `entity-failover.unit.test.ts` | a cached row is never presented as a confirmed LIVE registration | assertion moved from hardcoded `'Unknown'` to "never hardcode `'Active'`, always carry `asOf`" | **yes** — the DEFECT-7 key-failover and `synced_at` assertions are untouched |

Neither lost coverage. In both cases the destination was incidental to what the test
existed to protect.

## Positive assertions of a legacy destination that REMAIN (4)

All are **in-app UI**, none are email. Left alone deliberately — changing a test to match
a migration that has not happened would be false confidence.

| site | asserts | verdict |
|---|---|---|
| `mindy-signup-signin.unit.test.ts:24` | MFA handoff → `/app?email=` | **correct** — credential flow, no Map equivalent |
| `constant-skeleton.unit.test.ts:161` | signed-out CTA → `/app?next=%2Fopportunity-map` | **correct** — sign-in flow, and it already returns to the Map |
| `settings-drawer.unit.test.ts:42` | account-menu fallback → `/app?panel=settings` | **migration work**, not a test bug — a real fallback for pages that do not inject the drawer |
| `pursue-actions.unit.test.ts:113` | after capture → `/app?panel=pipeline` | **migration work** — Pursuits is still an `/app` panel |

The last two are genuine `/app` corridors in the MAP UI. They are out of scope for the
email migration and should move when Pursuits/Settings get Map-native homes — that is the
`/app` onboarding audit already filed, not this one.

## What the codebase enforces already

The overwhelming majority of matches are **`not.toContain('/app…')`** — tests that ENFORCE
the migration rather than depend on it: `account-menu-destinations`, `maps-signout`,
`proposal-workspace-link`, `notice-deeplink`, `network-drawer-dispatch`. The map surface
is already well fenced.

## Conclusion

**The email migration path is clean.** `sendEmail()` now rejects any rendered payload
containing a legacy destination, so a future sender cannot reintroduce one — the guard
fires before a user sees it. No test was found that would block that migration or assert
a destination that is now wrong.
