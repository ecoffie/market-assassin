# Retire legacy Market Assassin / Unified-MI customer interfaces — 2026-09-23

Branch `fix/retire-legacy-ma-interfaces` · base `bf4556f1` (origin/main at branch time).
Commits: `8a326a87` (routing + source links) · `9d509ed8` (this packet, v1) ·
`ee870864` (email CTAs: no Map default) · this revision.
Status: **review PR only — not merged, not deployed.** No production writes, no Stripe
changes, no KV / account / customer changes were made.

Decision applied (Eric, 2026-09-23): **destination = current `/app`**, supported deep links
preserved, `/app` applies its own normal landing. No separate Map default.

---

## 1. Confirmed legacy routes and repaired destinations (CODE — this branch)

"Before" was measured on production with `curl -L` (read-only). "After" was verified locally
on the branch (see §3), not in production.

| Legacy entry point | Before (production, measured) | After (branch) | Mechanism |
|---|---|---|---|
| `/briefings?welcome=true` (Stripe MI Pro success URL) | old Unified-MI dashboard; no saved legacy email → `/alerts/signup` | 307 → `/app` (normal landing) | `proxy.ts` + `legacy-routes.ts` |
| `/briefings?panel=X` / `?tab=X` / `?setup=true` | old dashboard | 307 → `/app?panel=<mapped>` (research, pipeline, forecasts, recompetes, contractors, contacts, grants, alerts, dashboard, settings); legacy-only panels (content, planner, sbir) → `/app` | same |
| `/briefings?email=…&notice=…&utm_*` | old dashboard | carried through (email = sign-in prefill only; identity always from the live session). Everything else (`next`, `returnTo`, …) dropped | same |
| `/briefings/dashboard` | old stats page | 307 → `/app?panel=dashboard` | same |
| `/bd-assist` | → `/briefings` | 307 → `/app?panel=pipeline` (page fallback updated too) | same |
| `/` on every host except `getmindy.ai` (e.g. `market-assassin.vercel.app/`, measured) | "Government Contracting Intelligence Tools" card grid | Supabase recovery/invite hash handled first (unchanged); else → `/app` (production aliases → `https://getmindy.ai/app`) | `src/app/page.tsx` |
| `/market-assassin-locked`, email without an `ma:` grant (every Mindy Pro buyer) | "No access found for this email. Please purchase below." | → `/app?panel=research&email=…` | gate page |
| `/federal-market-assassin` with a real `ma:` cookie | paid legacy tool | **unchanged** (~7 legacy buyers keep their tool) | — |

**Links fixed at the source** (so we stop distributing old URLs):
- `/purchase/success`: primary + dashboard buttons → `/app`; "Quick Access" had `/recompete-contracts` (404), `/prime-lookup` (404), `/content-generator-product` (308 → home), `/contractor-database` (legacy gate) → `/app?panel=research|recompetes|contractors`, `/opportunity-map`.
- `/activate` tiles: MA → `/federal-market-assassin` (was `/market-assassin`, 308 → home); briefings → `/app`; recompete → `/app?panel=recompetes`.
- `/market-intelligence`: verify-access → `/app` (was `/briefings`), setup → `/app?panel=settings`, nav → `/app`.
- Mute / pipeline / contacts / shared-opportunity / alerts-signup / MA-tool pages → `/app` (+ panel).
- Emails: MA access email (webhook) and FHC + bundle MA links → `/federal-market-assassin` (were `/market-assassin` → home). Alert Pro upsell → `/market-intelligence` (was retired MA sales page).
- **Emails do not link `/app`.** The frozen send-time guard (`legacy-destination-guard.ts`, #1362) throws on any `/app` link outside production. So the MI Pro welcome CTA stays on `/market-intelligence`, whose verify step now lands a verified buyer on `/app`. Linking `/app` directly from email would need a documented guard exception — **a separate decision, not made here.**

Untouched on purpose: all `/api/*`, webhook grant logic, `/briefings/feedback/*` (email
feedback pages), `/alerts/preferences`, `/alerts/signup`, admin routes.

## 2. Adam / Andre — historical evidence vs assumptions

Sources (all read-only): `check-access` admin GET (KV + Supabase + purchases),
`user_engagement`, Stripe API GETs. No sessions impersonated, nothing modified.

| | Adam Sokolowski (`adam.sokolowski01@gmail.com`) | Andre Jerry (`aj@cypherintel.com`) |
|---|---|---|
| **Identity — confirmed** | Stripe customer `cus_VDgMnVsrSPZ3F4`, same email | Advocate registry (`advocate-accounts.ts`); KV `contentgen:` record name "Andre" |
| **Entitlements — confirmed** | 1 purchase $149.00, 2026-09-08, `prod_UI5RXVGKsdywuf` "Mindy Ai" (`tier: briefings`); sub active; KV `briefings:`=true; no `ma:` | No purchases row (comp); KV `contentgen:` full-fix + `briefings:`=true |
| **Routing — confirmed** | His checkout session came from `plink_1TTYfR…`, whose redirect is `getmindy.ai/briefings?welcome=true`. Zero `/app` events after paying (last `/app` events 2026-08-15, tier free). | 16 events on panels that exist only in legacy `/briefings` (`sbir`, `content`) on 2026-07-20; ~122 path-less legacy-shaped events 2026-07-09→07-27. |
| **Assumption — NOT established** | That he then hit `/alerts/signup` or the Market Assassin "purchase" page. `/briefings` logs nothing before it knows an email, so no event is consistent with that but doesn't prove it. That he clicked the welcome-email CTA. | Which link took him to `/briefings`. |
| **Unavailable** | Browser history, per-user access logs, the exact URL opened | same |

Fixtures in the tests represent these account *shapes* (Pro buyer without `ma:`; legacy
panel deep link). **They do not show either real account is fixed.**

## 3. Local/browser verification vs production

**Local / branch (done):**
- Unit: `src/lib/mindy/legacy-routes.unit.test.ts` — 41 tests (resolver, loop/external-URL safety, proxy wiring, source links, email CTAs). Mutation-checked: 4 injected regressions each turned it red.
- Full suite: 7,542 passed / 0 failed in the worktree (vitest's exit code was 1 because of 3 worker-RPC timeouts; see §5). Typecheck clean.
- Pre-push gate at `ee870864`: named this worktree and HEAD; **"✓ pre-push gate passed"**.
- curl against local dev server (from `8a326a87`): all redirects above returned the expected 307 targets; `/briefings/feedback/thanks` 200; `/federal-market-assassin` (no cookie) → gate.
- Browser (local dev, logged out, test emails only, no customer sessions):
  - Stripe return URL → Mindy sign-in rendered, no legacy UI.
  - `/briefings?panel=research&email=<fixture>` → `/app?panel=research`, email pre-filled.
  - Back button → previous `/app` entry; the 307 never enters history, no loop.
  - `/?utm_source=bookmark` → `/app?utm_source=bookmark`, no grid.
  - `/market-assassin-locked` + non-MA fixture email → `/app?panel=research&email=…`.
  - `/purchase/success?product=briefings` → every rendered link is a current destination.
- Not browser-tested:
  - The recovery-hash hop on `/`. Unchanged logic; asserted in unit tests. Driving it would navigate to production with a fake token.
  - `/activate`. Its API upserts `user_profiles` in production, so it was not driven.
- The email CTA change in `ee870864` is unit-verified only (email rendering, not a browser flow).

**Production: nothing verified. Nothing is deployed.**

## 4. Code changes vs pending Stripe / infrastructure changes

**Code (this PR):** everything in §1.

**Stripe — PROPOSAL ONLY, not applied (needs approval).** Live values read via the Stripe API 2026-09-23:

| Payment link | Product / price | Paid via link | `after_completion` now | Proposed |
|---|---|---|---|---|
| `plink_1TTYfRK5zyiZ50PBkZ4mukPq` (buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C) | Market Intelligence $149.00/mo | 58 (2026-05-10 → 2026-09-22) | redirect `https://getmindy.ai/briefings?welcome=true` | redirect `https://getmindy.ai/app` |
| `plink_1TTYhlK5zyiZ50PBGhvWwBLq` (buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D) | Market Intelligence $1,490.00/yr | 4 (2026-06-23 → 06-27) | redirect `https://getmindy.ai/briefings?welcome=true` | redirect `https://getmindy.ai/app` |
| `plink_1TBXg2K5zyiZ50PBp5xvOJP2` (optional, low priority) | Alert Pro $19.00/mo | 2 | redirect `https://getmindy.ai/alerts/preferences?upgraded=true` | leave (working page) or `https://getmindy.ai/app?panel=alerts` |

Once this PR is deployed, the current URLs are safe (redirected), so the Stripe edit is
cleanup and does not block the PR. Apply only after production verification (§6 step 2).

**Other infrastructure / remaining legacy surfaces (not changed):**
- `/briefings` page code (unreachable via the proxy; delete in a separate cleanup).
- Admin-triggered email templates linking `/briefings`, `/briefings/settings`, `/briefings/unsubscribe` (the last two don't exist): `lib/briefings/recompete/email-templates.ts`, `lib/briefings/contractor-db/email-templates.ts`, `admin/send-all-briefings`, `admin/feedback`, `admin/align-treatment-types`.
- `shop.govcongiants.com/activate` in license/bundle emails (govcon-shop repo).
- `vercel.json` `tools.govcongiants.org/*` → `mi.govcongiants.com` → `getmindy.ai` (works; two hops).
- SEO pages, `lib/dsbs-scoring.ts`, `/store` linking `/opportunity-hunter` / `/recompete`.
- Email → `/app` directly needs a guard exception decision (§1).

## 5. Pre-push gate findings (no bypass, no suppression, no shared gate change)

| Attempt | HEAD | Load (1m) | Assertion failures | DB/test timeouts | Worker errors | Verdict |
|---|---|---|---|---|---|---|
| 1 (11:38) | `9d509ed8` | ~149 | 0 | 0 | 3 × `[vitest-worker]: Timeout calling "onTaskUpdate"` | blocked |
| 2 (11:48) | `9d509ed8` | ~29 → ~80 | 0 | 0 | 3 × same | blocked |
| 3 (11:56) | `9d509ed8` | 15, no other vitest | 0 recorded | 4 × `Test timed out in 20000ms` (all in `lookup-solicitation.live.test.ts`) | 0 | blocked |
| 4 (~12:0x) | `9d509ed8` | ~60 | 0 | not recoverable* | reported, count not recoverable* | blocked |
| 5 (12:17) | `ee870864` | ~33 | 0 | 0 | 0 | **passed** (`VITEST_MAX_FORKS=4` on the command) |

\* `/tmp/mindy-prepush-unit.log` is a fixed path shared by every worktree's gate; concurrent
sessions overwrote it (headers from `agent-adc2d8…` and `agent-a32bcd…` were seen). The
gate named this worktree and HEAD on every attempt.

**The one assertion failure is NOT preserved.** In an isolated run of
`lookup-solicitation.live.test.ts` between attempts 3 and 4, test A failed at 9,015 ms. My
output filter dropped its message. Test A asserts `elapsed < 8_000` and `db_ms < 8_000`, so a
latency assertion is *plausible* but **not established**. A later pass does not establish it.

**Branch vs clean main, equivalent conditions.** File-only runs, `--maxWorkers=1`, same
Node (v22.14, the gate's PATH), alternating, 3 rounds each. Baseline was a detached worktree
at `bf4556f1` with the same `node_modules` and `.env.local` (via the helper). The test file is
identical, and none of the branch's changed files is in its 8-module import graph.

| Run | A | E | B/C/D | F | routing |
|---|---|---|---|---|---|
| branch 1 / 2 / 3 | pass 5,904 / 2,635 / 2,367 ms | pass | pass | pass | pass |
| main 1 / 2 / 3 | pass 3,453 / 3,815 / 2,910 ms | pass | pass | pass | pass |

Assertion failures 0/6 on both sides, timeouts 0, worker errors 0. No branch-specific
difference was found. Loads were 12–20 during these runs.

Supported concurrency setting used: `VITEST_MAX_FORKS` (read by vitest 3.2.6). Nothing in
`vitest.config.ts` or `package.json` bounds workers, so the default is ~15 forks on a 16-core
machine shared by many worktree sessions. Noted: `package.json` `engines.node` is `24.x`,
but the gate runs `/Users/ericcoffie/local/nodejs/bin/node` v22.14 (see open PR #1602).

### Proposed tooling repair (separate PR, NOT in this branch)

1. Split the unit gate into two named steps:
   - **deterministic** (`*.unit.test.*`, seam tests) — stays blocking;
   - **live integration** (`*.live.test.ts`, e.g. `lookup-solicitation.live.test.ts`, which queries production and asserts wall-clock `< 8s`) — runs and reports an explicit outcome per test: `PASS / ASSERTION_FAIL / TIMEOUT / SKIPPED(no env)`.
   - Never silently skipped. Whether an assertion failure there blocks is a decision for Eric.
2. Per-worktree log paths: `/tmp/mindy-prepush-<worktree-hash>-unit.log` instead of one shared file, so evidence can't be overwritten by another session.
3. Bounded workers in the gate via the supported setting (`--maxWorkers` or `VITEST_MAX_FORKS`), sized for multi-session use.
4. Report vitest "unhandled errors" separately from test failures in the gate output, so a worker-RPC timeout is labelled as infrastructure, not a failing test. It still blocks until decided otherwise.

## 6. Post-release acceptance plan (bounded; after an approved merge + deploy)

1. Serving SHA contains this PR's merge commit.
2. `curl -sI "https://getmindy.ai/briefings?welcome=true"` → 307, `location: /app`. Same shape for `/briefings/dashboard` (→ `/app?panel=dashboard`) and `/bd-assist` (→ `/app?panel=pipeline`).
3. `curl -s https://market-assassin.vercel.app/` does not contain "Government Contracting Intelligence Tools".
4. Browser, logged out: the Stripe success URL renders Mindy sign-in; back does not loop.
5. Browser: `/market-assassin-locked` + a test email without `ma:` → `/app?panel=research`.
6. `/briefings/feedback/thanks`, `/alerts/preferences`, `/app`, `/opportunity-map` → 200.
7. Only then, with approval: apply the Stripe redirects in §4; re-read them via the API.
8. Adam and Andre are **not** described as fixed until 1–6 pass in production. Outreach is Eric's call.
