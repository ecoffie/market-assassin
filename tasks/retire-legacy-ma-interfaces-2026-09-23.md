# Retire legacy product interfaces into Mindy — review packet (final) — 2026-09-23

PR **#1671** · branch `fix/retire-legacy-ma-interfaces` · base `main` (branched at `bf4556f1`).
**HOLD: review only.** Not merged, not deployed. No Stripe, subscription, grant, env or
production-data change was made. The separate proposals (Stripe, subscriptions, grant defects,
shared-password transition/security, gap work) are in
**`tasks/legacy-retirement-proposals-2026-09-23.md`**.

The final production-build acceptance run is tied to the exact head in the PR comment titled
"Final packet — head `<sha>`". A file cannot record results about the commit that contains it.

Decisions applied (Eric, on #1671):
- We only use Mindy. Every legacy entry point goes to its Mindy equivalent.
- Purchased access, functionality, saved work and preferences are preserved.
- Where there is no equivalent, the gap is flagged instead.
- Destination is the current `/app`, with its normal landing and supported deep links.
- Paid CTAs go to sign-in/workspace, never a pricing detour.
- No billing changes.

---

## 1. Migrated entry points (code)

| Legacy entry (bookmark / link) | Now | How |
|---|---|---|
| `/briefings` (+ `?panel/tab/setup`) — incl. the MI Pro Stripe success URL `/briefings?welcome=true` | 307 → `/app` (panel mapped) | `legacy-routes.ts` + `proxy.ts` |
| `/briefings/dashboard`, `/bd-assist` | → `/app?panel=dashboard`, `/app?panel=pipeline` | same |
| `/federal-market-assassin`, `/federal-market-assassin/success`, `/market-assassin-locked`, `/market-assassin` | → `/app?panel=research` | same |
| `/opportunity-hunter`, `/opportunity-scout(.html)` | → `/app?panel=research` | same; removed from sitemap |
| `/prime-lookup.html` | → `/app?panel=recompetes` | same |
| `/start` (free-alerts onboarding that sold Alert Pro) | → `/app` | same |
| `/bundles/ultimate`, `/contractor-database-product` (still-live legacy checkouts) | → `/pricing` | same |
| `/recompete` | **URL kept** (SEO landing, server-rendered 2026-09-21); legacy gate + iframe body replaced by a Mindy entry → `/app?panel=recompetes` | `recompete/page.tsx` |
| `/access/<CODE>` (admin single-use report code) | → `/app?panel=research&email=<code email>&redeem=<CODE>` = a **report credit in Mindy** | `access/[code]/page.tsx` + `generate-all` |
| `/` on non-`getmindy.ai` hosts (old tools grid) | → `/app` (auth-recovery hash hop kept) | `app/page.tsx` |
| Alert Pro success URL `/alerts/preferences?upgraded=true` | the **shared** preference page (no Alert Pro UI). It is used by every alert email's "Manage preferences" and by token links for users without a password, so it is a current Mindy surface, not the retired product | unchanged page; one stray `shop.govcongiants.com` link fixed |

**Sources fixed, not just redirected:**
- **Emails:**
  - MI Pro welcome → `/app` sign-in (was `/market-intelligence`);
  - MA access → `/app?panel=research`; "one-time / can only be used once" wording removed;
  - FHC, bundle, Opportunity Hunter Pro, Recompete emails → `/app` panels + "Sign in to Mindy";
  - Alert Pro welcome → `/app` (the subscriber is Pro via `ospro:`).
- **Activation:** `/activate` tiles and `/api/activate-license`.
- **Admin and product links:** `/api/ma-access/[token]`, `purchases.ts`, DSBS-scorer upsell.
- **Post-purchase page:** `/purchase/success` (two 404s removed).
- **Page links:** `/market-intelligence` (verify → `/app`; Ultimate callout and Content Reaper row removed), mute / pipeline / contacts / shared-opp / alerts-signup pages.
- **Public SEO pages:** 10 of them now link the **public Map** (`/opportunity-map`, `/opportunity-map?mode=recompete`) instead of retired tools.

**Login destinations:**
- `/app` is current, so `safeNext` / post-signup accept an **explicit** `next=/app…`. They still refuse `/app/onboarding` and `/briefings`; new accounts with no intent still go to `/welcome`.
- A Google sign-in started on `/app` now returns to that `/app` view. Before this, it stranded the customer on `/app/onboarding` (proven by mutation, §5).

**Email guard:** `/app` allowed. There is an explicit retired list, each entry with a reason. Credential flows are always allowed. The general alert CTA still refuses `/app` (lockout protection for recipients without a password).

## 2. Preserved access (entitlement → Mindy)

| Legacy grant | Mindy tier (`verifyMIAccess`) | Equivalent | Proven by (acceptance fixture) |
|---|---|---|---|
| `briefings:` ($149 Pro buyer) | Pro | `/app` | paid-briefings (password + 2FA); legacy-paid-no-password (magic link); google-returning |
| `ma:` standard/premium | Pro (report generator uses the same check) | Market Research | ma-purchaser: Pro **from `marketAssassinPremium`**, briefings=false |
| `contentgen:` (+ comp) | Pro | ⚠️ no Content Reaper equivalent (gap §3) | legacy-comp: Pro in `/app`; `/content-generator` still reachable |
| `ospro:` (OH Pro; also written by Alert Pro + FHC) | Pro | Market Research | alert-pro: Pro **from `opportunityHunterPro`** |
| Alert Pro (`alertpro:` + `ospro:` + `alert_frequency='daily'`) | Pro | Alerts panel + shared preferences | alert-pro: daily preference read back through `/api/alerts/preferences`; Alerts panel renders |
| `recompete:` | Pro | Recompetes panel | route + source tests |
| `dbaccess:` | Pro | ⚠️ Contractors panel lacks SBLO contacts/export (gap §3) | DB entry points not retired |
| single-use `access:<CODE>` | one full report | report credit in Market Research | code-holder: full (Pro) report once, consumed server-side, second use refused |
| anonymous shared password (`ma_access_email=authorized-user`) | free (proven) | free Mindy account | shared-password checks (§5) |
| none (control) | Free | Free Plan, Pro panels locked | no-grant |

- **Saved work:** a representative saved pursuit is visible in My Pursuits for every fixture.
- **Preferences:** these stay on `user_notification_settings`, which `/app` already reads.
- **No saved work lost:** the standalone MA tool, Opportunity Hunter and the Recompete Tracker kept no server-side saved work.

## 3. Unresolved functionality gaps (flagged; entry points NOT retired)

| Product | Missing in Mindy | Status |
|---|---|---|
| **Content Reaper** | the whole generator, graphics/carousels, exports, `content_library`, calendar | `/content-generator` stays reachable; the migration work item is in the proposals doc (§E) |
| **Federal Contractor Database** | SBLO email/phone, plan/portal filters, CSV export | `/contractor-database`, `/database.html`, `/database-locked` stay; the $497 link is still live, and **its webhook grants no `dbaccess:`** (proposals §A, §C.2) |
| **Action Planner** | saved `user_plans` / progress | `/planner` stays; needs a product decision |
| Opportunity Hunter → Research | agency-list CSV export, office-ID drill | retired; add to Research |
| Recompete Tracker → Recompetes | export, incumbent-name search, value filter | retired; add to Recompetes |

These are not exemptions. Each has a named owner decision in the proposals doc.

## 4. Adam / Andre — evidence vs assumption (read-only; unchanged)

- **Adam:**
  - **Confirmed:** $149 purchase via `plink_1TTYfR…`, whose redirect is `/briefings?welcome=true`; zero `/app` events after paying.
  - **Not established:** which legacy page he then saw.
- **Andre (advocate, comp):**
  - **Confirmed:** legacy-only `/briefings` panels on 2026-07-20.
  - **Not established:** the link that took him there.

Neither account was used, read in a browser, or impersonated. The fixtures only **represent** their shapes.

## 5. Verification — local isolation vs production

**Real sign-in, local, isolated identity provider.** Runner: `scripts/acceptance/legacy-retirement/run.mts`.

| Flow | What ran for real | Simulated | Result (dev run, head `c6de6fd9`) |
|---|---|---|---|
| Password | `/app` form → `/api/auth/mindy-login` → paid-MFA gate → **emailed 2FA code read from the captured mail** → `/api/auth/two-factor/verify` → session | identity provider (fixture only) | ✓ |
| Magic link (paid, no password) | `/app` "email me a link" → `/api/auth/mindy-magic-link/request` → auth user ensured → link emailed → link opened → `/app` bootstrap | identity provider, mail delivery | ✓ |
| Google return | `/app` "Continue with Google" → `/authorize` → `/app/onboarding?next=…` → session → mindy-session → **back to `/app?panel=pipeline`** | **Google's consent screen** (auto-granted) | ✓; mutation (pre-fix code) → lands on `/app/onboarding` ✗ |

**Other results (dev run):**
- **Totals:** 125/129 on the full run; the 4 failures were the Google journey, fixed and then re-run alone: 12/12.
- **Isolation:** 0 Supabase writes forwarded; 6 mails captured, 0 delivered; the real KV was never contacted.
- **Routes:** 11 retired routes redirect correctly; `/recompete` and `/alerts/preferences` serve.
- **Shared password:**
  - with `MA_ACCESS_PASSWORD` unset, **as in production**, the source-code default still issues the anonymous cookie; a wrong password is refused;
  - with the grace window closed, the cookie is routed to `/app`, and identity-cookie customers cannot enter the old tool;
  - the cookie resolves to **free-tier** reports.
- **Report code:** redemption works end to end (it was broken on `main`: the old page called `generate-all` without an email, which returns 403).

**Unit tests:**
- routing contract (legacy-routes);
- rendered paid emails, including tracking wrappers;
- the guard;
- `safeNext` / post-signup / signup-corridor, updated to the `/app`-is-current contract.

All are in `src/lib/{mindy,email}`.

**Final evidence for the exact head**, posted in the PR comment:
- a production build (`next build` + `next start`) with the full acceptance against it;
- the full unit suite;
- typecheck;
- the pre-push gate.

**Not verified:**
- Google's own consent screen;
- `/activate`, whose API writes `user_profiles`;
- the recovery-hash hop on `/` (unit-asserted only);
- **anything in production — nothing is deployed.**

## 6. Exact release steps (after approval; stop at each check)

1. **Merge** #1671 (squash) → confirm the production deploy for the merge SHA reaches READY. Confirm the serving SHA contains it.
2. **Env:** leave `LEGACY_SHARED_PASSWORD_ACCESS` **unset** (grace closed), or set it to `on` with a fixed end date if a courtesy window is wanted (proposals §D).
3. **Smoke checks on production (read-only curls):**
   - 307s: `/briefings?welcome=true`→`/app`, `/federal-market-assassin`→`/app?panel=research`, `/opportunity-hunter`→`/app?panel=research`, `/bundles/ultimate`→`/pricing`, `/start`→`/app`;
   - `/recompete` 200 with "Open Recompetes in Mindy";
   - `/alerts/preferences` 200;
   - `market-assassin.vercel.app/` has no "Government Contracting Intelligence Tools".
4. **Sign-in on production** with an **approved internal test account**, not a customer: password (+2FA), magic link, Google → lands in `/app`; Research and My Pursuits render.
5. **Report-code check:** issue one **test** code to that internal account, redeem it once, and confirm the second use is refused.
6. **Stripe (separate approval, proposals §A):** repoint the two MI Pro success URLs to `https://getmindy.ai/app`; deactivate the Alert Pro, Contractor DB, Ultimate ×2 and Tool Bundle links. Re-read each via the API.
7. **Alert Pro subscriber** (1, renews 2026-10-22): execute the option Eric picks in proposals §B.
8. Only after 1–5 pass: consider telling Adam and Andre; outreach is Eric's call.
9. **Follow-ups:** the security PR (shared-password routes) and the gap work items (Content Reaper, Contractor DB, Planner, exports).
