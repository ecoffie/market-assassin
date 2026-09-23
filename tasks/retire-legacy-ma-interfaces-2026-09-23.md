# Retire legacy Market Assassin / Unified-MI customer interfaces — 2026-09-23

Branch `fix/retire-legacy-ma-interfaces` · PR #1671 · base `main` (branched at `bf4556f1`).
**Status: HOLD — review only. Not merged, not deployed.** No production writes, no Stripe
changes, no KV/account/customer changes were made at any point.

Decisions applied (Eric, on #1671):
1. Destination is the current `/app`. Supported deep links are preserved, and `/app` applies its own
   normal landing. No separate Map default.
2. Retire the standalone Market Assassin tool too, preserving purchased functionality:
   entitlement compatibility first; flag any missing equivalent without deleting access.
3. Reconcile the email guard with the `/app` decision. Keep protections for retired routes and
   credential flows. Paid welcome/access CTAs reach sign-in/workspace, not a pricing page.
4. Stripe unchanged.

| Commit | What |
|---|---|
| `8a326a87` | Unified-MI retirement: `/briefings`, `/briefings/dashboard`, `/bd-assist` → `/app`; root grid removed; source links |
| `ee870864` | (superseded by `9526ffaa`) email CTAs taken off the Map default |
| `9526ffaa` | Standalone Market Assassin retired into `/app`; email guard reconciled; rendered-email tests |
| `63914946` | Authenticated browser acceptance harness (zero production writes) |
| this doc | packet v3 |

---

## 1. Entitlement compatibility — established BEFORE retiring the tool

| Legacy grant (KV) | `/app` tier | Evidence |
|---|---|---|
| `ma:` standard or premium | **Pro** | `verifyMIAccess` (`src/lib/api-auth.ts`) counts every legacy paid source as Pro; `/api/access/check` uses it |
| `contentgen:` / `ospro:` / `recompete:` / `dbaccess:` | **Pro** | same union |
| `briefings:` | **Pro** | same (+ `resolveAccess`) |
| none | Free | control fixture |

- **Reports:** `/api/reports/generate-all` authorizes through the same `verifyMIAccess`. Pro gets every
  Market Research report, so an MA purchaser has at least the 8 reports MA Premium sold.
- **Saved work:** the standalone tool kept no server-side saved reports. It generated on demand and
  had only a monthly usage counter (`/api/ma-usage`) and a localStorage flag. Nothing is lost by
  moving holders to `/app`.
- **Proven in the browser:** a fixture with ONLY `ma:` premium signs in as "Pro Plan", and
  `legacy_sources.marketAssassinPremium = true` with `briefings = false` (see §5).

**Missing equivalents: flagged, access NOT removed.**

| Access class | Why `/app` can't honour it | What this branch does |
|---|---|---|
| Anonymous shared-password cookie (`/api/verify-ma-password` → `ma_access_email=authorized-user`) | no identity to attach a grant to | **keeps** the standalone tool for that cookie (routing exception, tested) |
| `/access/[code]` admin single-use report codes (12 total, **8 unused**, all created 2026-01-02/03, each carries an email) | anonymous single-use flow | untouched |
| Content Reaper (`contentgen:`) | `/app` has no Content Reaper panel | bundle email still links `/content-generator` (the tool); nothing changed |
| Opportunity Hunter Pro / Contractor DB links in bundle email | not Market Assassin; equivalence not established in this pass | unchanged |

## 2. Confirmed legacy routes → repaired destinations (CODE)

"Before" = production, measured read-only with `curl -L`. "After" = this branch, verified locally (§5).

| Legacy entry | Before (prod) | After (branch) |
|---|---|---|
| `/briefings?welcome=true` (MI Pro Stripe success URL) | Unified-MI dashboard, or free `/alerts/signup` | 307 → `/app` |
| `/briefings?panel=X` / `?tab=X` / `?setup=true` | old dashboard | 307 → `/app?panel=<mapped>` (content/planner/sbir → `/app`) |
| `/briefings/dashboard` · `/bd-assist` | old pages | → `/app?panel=dashboard` · `/app?panel=pipeline` |
| `/federal-market-assassin` (no cookie) | → `/market-assassin-locked` → "No access found… purchase below" for a Pro buyer | → `/app?panel=research` |
| `/federal-market-assassin` (identity `ma_access_email` cookie) | standalone tool | → `/app?panel=research` (holder is Pro there) |
| `/federal-market-assassin` (anonymous password cookie) | standalone tool | **unchanged** (flagged gap) |
| `/federal-market-assassin/success`, `/market-assassin-locked` | old tool / gate | → `/app?panel=research` |
| `/market-assassin` (retired sales page) | 308 → `/` (homepage) on getmindy.ai; sales page elsewhere | → `/app?panel=research` on every host (next.config no longer owns it) |
| `/` on non-`getmindy.ai` hosts | GovCon Giants tools grid | recovery-hash hop kept; else → `/app` |

The routes live in one table, `src/lib/mindy/legacy-routes.ts`, applied by `src/proxy.ts`:
- redirects are 307, so they can be reversed;
- only `email`, `notice` and `utm_*` are carried over;
- every destination is relative, and none is itself legacy, so there are no loops.

**Links fixed at the source.** No surface keeps handing out the old tool:
- `/activate` tiles → `/app?panel=research`;
- `/api/activate-license` → `/app?panel=research`;
- `/api/ma-access/[token]` → `/app?panel=research` (success + error);
- MA gate success → `/app?panel=research`;
- `purchases.ts` product map;
- DSBS-scorer upsell;
- Ultimate bundle page;
- Stripe webhook MA access email;
- FHC welcome (includes MA Standard);
- bundle emails: MA → research, "Mindy AI" → `/app`, Recompete → `/app?panel=recompetes`;
- `/purchase/success` quick links (two 404s removed);
- `/market-intelligence` verify → `/app`;
- mute / pipeline / contacts / shared-opp / alerts-signup pages.

Untouched: all `/api/*` logic other than the redirect targets named above, webhook grant logic,
`/briefings/feedback/*`, `/alerts/preferences`, `/alerts/signup`, admin routes.

## 3. Email destination guard — reconciled

`src/lib/email/legacy-destination-guard.ts`, which runs on every rendered payload inside `sendEmail()`:

| | Before (2026-08-25 → today) | After |
|---|---|---|
| `/app` | banned (all of it) | **allowed** — current workspace |
| Retired list | `/app`, `/briefings` | `/briefings*`, `/bd-assist`, `/market-assassin`, `/market-assassin-locked`, `/federal-market-assassin`, `/app/onboarding` — **each with a stated reason** |
| Credential flows | allow-listed exception | always allowed (`/app/reset-password`, `setup-password`, `setup-account`, `forgot-password`, `verify`, `signup`, `sign-in`, `auth/callback`) |
| Tracking wrappers | unwrapped | unwrapped, recursively (single and double tested) |
| Non-prod / prod | throws / logs | unchanged |

- **Credential protection kept on purpose:** `MINDY_APP_URL` is the GENERAL alert/briefing CTA,
  sent to free and beta recipients who may never have set a password. It still refuses an `/app`
  override, because pointing those people at a sign-in wall is the lockout that guard exists for.
- **Paid emails link `/app` directly:**
  - MI Pro welcome → `https://getmindy.ai/app?email=<buyer>`, a sign-in prefill (no longer the `/market-intelligence` pricing page);
  - MA access and FHC → `/app?panel=research&email=…`;
  - bundles → `/app` panels.
- **Alert Pro:** its MA *upsell* points at `/market-intelligence`, because Alert Pro is not a Pro grant and this block is a sales pitch.

**Rendered-email tests.** `src/lib/email/paid-email-destinations.unit.test.ts`, 13 tests:
- Each paid email (MI welcome, FHC, 4 bundle variants, MA access, Alert Pro) is rendered through the real `sendEmail()` with the real guard. Only the provider is mocked; nothing is sent.
- Every destination is read from the HTML **and** text parts. The tests assert that the paid CTAs land on `/app` and that no retired surface appears.
- Every link is then wrapped once and twice in `/api/track`. The guard still finds zero retired destinations, unwrapping yields the identical destination set, and the real `sendEmail` accepts it.
- A retired link hidden inside a tracked CTA is **refused** at send time.

Mutation-checked: the welcome CTA back to the pricing page, FHC back to the tool, and the guard forgetting `/federal-market-assassin` each turn the suite red.

## 4. Adam / Andre — historical evidence vs assumptions (unchanged; read-only)

| | Adam (`adam.sokolowski01@gmail.com`) | Andre (`aj@cypherintel.com`) |
|---|---|---|
| Identity, confirmed | Stripe `cus_VDgMnVsrSPZ3F4` | advocate registry; KV `contentgen:` record "Andre" |
| Entitlements, confirmed | $149 purchase 2026-09-08 (`tier: briefings`), sub active, KV `briefings:`; no `ma:` | comp; KV `contentgen:` full-fix + `briefings:` |
| Routing, confirmed | checkout via `plink_1TTYfR…` → `/briefings?welcome=true`; zero `/app` events after paying | 16 events on legacy-only `/briefings` panels (`sbir`, `content`) on 2026-07-20 |
| Assumption, NOT established | that he then hit `/alerts/signup` or the MA "purchase" gate; that he clicked the welcome email | which link took him to `/briefings` |

The browser fixtures represent these **shapes** only. Their accounts were not used, read in the
browser, or impersonated, and nothing here shows either real account is fixed.

## 5. Local / browser verification vs production

**Authenticated browser acceptance (local): 50/50 passed.** The harness is
`scripts/acceptance/legacy-retirement/` (`run.mts`, `stubs.mjs`, `fixtures.mjs`).

| Fixture (synthetic `@acceptance.invalid`) | Legacy entry | After login | Tier (from `/api/access/check`) | UI | Deep links¹ | Research panel | Saved pursuit² | Refresh/back |
|---|---|---|---|---|---|---|---|---|
| paid-briefings (`briefings:` only) | `/briefings?welcome=true` → `/app` sign-in | `/app` | pro | no "Upgrade to Pro" | ✓ | ✓ | ✓ | ✓ |
| legacy-comp (`contentgen:` + `briefings:`) | `/briefings?panel=pipeline` → `/app?panel=pipeline` sign-in | `/app` | pro | no upgrade CTA | ✓ | ✓ | ✓ | ✓ |
| ma-purchaser (`ma:` premium only + legacy cookie) | `/federal-market-assassin` → `/app?panel=research` sign-in | `/app` | pro, from `marketAssassinPremium` (briefings=false) | "Pro Plan" | ✓ | ✓ | ✓ | ✓ |
| no-grant (control) | `/briefings?welcome=true` → `/app` sign-in | `/app` (Source Feed) | **free** | "Free Plan", Pro panels locked, "Upgrade to Pro" | ✓ | ✓ | ✓ read-only preview³ | ✓ |
| anonymous password cookie | `/federal-market-assassin` | — | — | stays on the standalone tool (flagged gap) | — | — | — | — |

¹ `/federal-market-assassin` → `/app?panel=research`, `/bd-assist` → `/app?panel=pipeline`, `/briefings?tab=forecasts` → `/app?panel=forecasts`.

² Returned by `/api/pipeline` for that identity **and** visible in My Pursuits.

³ Free users see a read-only preview of their own data (`FREE_PREVIEW_PANELS`). That is existing `/app` behaviour.

**What is real in that run:**
- The Next.js app built from this checkout (proxy, `/app`, API routes, `verifyMIAccess`).
- Headless Chrome.
- Production Supabase **reads** for non-fixture data: 2,773 GETs forwarded.

**What is substituted:**
- KV → a local Upstash-protocol fake seeded with the fixture grants (491 commands; 47 writes held in memory; the real KV was never contacted).
- Supabase → a proxy that serves fixtures locally and **absorbs every write**: 651 absorbed (e.g. `user_engagement`, `mi_beta_team_members` inserts), **0 forwarded**. The run fails if any write is forwarded.
- Postgres, Redis TCP, QStash, mail, Stripe, GHL, Slack, Twilio, LLM, SAM, BigQuery and the planner DB → blanked. `@next/env` was verified not to refill an empty-string variable from `.env.local`.
- Session signing → a harness-only secret, so fixture sessions are worthless in production.

**Not driven:**
- The credential step itself (password entry or the OAuth consent screen). The browser gets the exact token `/api/auth/mi-login` issues, produced by the server's own `createMIAuthSessionToken`.
- A production build (this was `next dev`).
- `/activate`: its API upserts `user_profiles`.
- The Supabase recovery-hash hop on `/` (unit-asserted only).

Chrome ran under Rosetta (x64 Node), so it was slow; the checks wait for rendered content, not network idle.

**Unit and other checks:**
- `legacy-routes.unit.test.ts`: 52 tests.
- Guard tests: 26.
- Rendered-email tests: 13.
- Related suites: 292/292.
- Typecheck clean.

**Production: nothing verified. Nothing is deployed.**

## 6. Code changes vs pending Stripe / infrastructure changes

**Code:** everything in §2–§3 and the harness (§5).

**Stripe: unchanged; proposal only (read via API 2026-09-23).** With the code deployed, the current URL is safe.

| Link | Product | Paid | Now | Proposed |
|---|---|---|---|---|
| `plink_1TTYfRK5zyiZ50PBkZ4mukPq` | Market Intelligence $149/mo | 58 | `https://getmindy.ai/briefings?welcome=true` | `https://getmindy.ai/app` |
| `plink_1TTYhlK5zyiZ50PBGhvWwBLq` | Market Intelligence $1,490/yr | 4 | same | `https://getmindy.ai/app` |
| `plink_1TBXg2K5zyiZ50PBp5xvOJP2` (optional) | Alert Pro $19/mo | 2 | `…/alerts/preferences?upgraded=true` | leave, or `…/app?panel=alerts` |

**Remaining (not changed here):**
- `shop.govcongiants.com/activate` in license/bundle emails (govcon-shop repo).
- The MA access email body still says "one-time access code… link can only be used once". That copy is stale for `/app`; MA payment links are deactivated, so the path fires only on legacy metadata.
- Content Reaper has no `/app` panel (§1).
- `/briefings` page code (unreachable; delete separately).
- Admin-triggered briefing templates linking `/briefings/settings` and `/briefings/unsubscribe`, which don't exist (the guard now throws on them outside production).
- The anonymous MA password: `/api/verify-ma-password` falls back to a hard-coded default password in source. That's a separate security item.

## 7. Pre-push gate record

Unchanged from packet v2:
- Attempts 1–4 were blocked only by vitest worker-RPC timeouts and live-DB test timeouts.
- The one isolated assertion failure in `lookup-solicitation.live.test.ts` test A (9,015 ms) was **not preserved**, so its cause is not established.
- Branch vs clean `main`: 6/6 passes under bounded concurrency.
- Pushes since then use the normal gate with `VITEST_MAX_FORKS=4` on the command only.
- The tooling proposal (split deterministic vs live tests, per-worktree logs, bounded workers, label worker errors) is a separate PR, not in this branch.

## 8. Post-release acceptance plan (after an approved merge + deploy)

1. The serving SHA contains this PR's merge commit.
2. `curl -sI` against production returns 307:
   - `/briefings?welcome=true` → `/app`;
   - `/federal-market-assassin` → `/app?panel=research`;
   - `/market-assassin` → `/app?panel=research`;
   - `/bd-assist` → `/app?panel=pipeline`.
3. `market-assassin.vercel.app/` has no "Government Contracting Intelligence Tools".
4. Re-run `scripts/acceptance/legacy-retirement/run.mts` against a production build **locally**.
   Don't point it at production; it is designed for a local server.
5. With an approved internal test account, not a customer:
   - sign in on production through the real UI;
   - confirm the `/app` landing, the Research panel and a saved pursuit.
6. `/briefings/feedback/thanks`, `/alerts/preferences`, `/app` and `/opportunity-map` → 200.
7. Only then, with approval, apply the Stripe redirects in §6 and re-read them via the API.
8. Adam and Andre are **not** described as fixed until 1–6 pass. Outreach is Eric's call.
