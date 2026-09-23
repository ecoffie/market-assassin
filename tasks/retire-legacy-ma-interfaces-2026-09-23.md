# Retire legacy Market Assassin / Unified-MI customer interfaces — 2026-09-23

Branch `fix/retire-legacy-ma-interfaces` · base `origin/main` @ `bf4556f1`.
Status: **review PR only.** Not merged, not deployed. No production data, Stripe, KV or
account changes were made. Everything below marked "local" was verified on a local dev
server built from the branch head, not in production.

## Accounts investigated (read-only: check-access admin GET, `user_engagement`, Stripe API GETs)

| Customer | Identity confirmed | Records | What the evidence shows |
|---|---|---|---|
| Adam Sokolowski `adam.sokolowski01@gmail.com` | Stripe customer `cus_VDgMnVsrSPZ3F4` (same email) | 1 purchase $149.00, 2026-09-08, `prod_UI5RXVGKsdywuf` "Mindy Ai" (`tier: briefings`); sub active; KV `briefings:`=true; **no `ma:` grant** | Checkout session came from payment link `plink_1TTYfR…` whose **success URL is `getmindy.ai/briefings?welcome=true`**. His last `/app` events are 2026-08-15 (tier free); **zero `/app` events after paying**. `/briefings` logs no event before it knows an email, consistent with (not proof of) the `/briefings → /alerts/signup` bounce. Used the Map 2026-09-22 via Google. |
| Andre Jerry `aj@cypherintel.com` | Advocate registry (`advocate-accounts.ts`) + CLAUDE.md; KV contentgen customerName "Andre" | No `purchases` row (comp); KV `contentgen:` full-fix (legacy) + `briefings:`=true | **Confirmed** use of the legacy `/briefings` dashboard: 16 events on panels that exist only there (`sbir`, `content`) on 2026-07-20; ~122 path-less legacy-shaped events 2026-07-09→07-27. Entry link not recoverable from records. |

**Not available:** browser history, server access logs by user, the exact URL either customer
opened, whether Adam clicked the welcome-email CTA. Fixture shapes below are sanitized
representations; they do **not** prove either real account is fixed.

## Root cause

A paying Mindy Pro buyer is handed legacy URLs by **three distributors**, all still live:

1. **Stripe payment-link success URL** (dashboard config, not code): MI Pro $149/mo
   (`plink_1TTYfR…`) and $1,490/yr (`plink_1TTYhl…`) → `getmindy.ai/briefings?welcome=true`.
   58 paid monthly + 4 paid annual checkouts, 2026-05-10 → 2026-09-22.
2. **MI Pro welcome email** (`sendMarketIntelligenceWelcomeEmail`) CTA → `/market-intelligence`
   (sales page) whose "verify access" → `/briefings`.
3. **Non-apex hosts** (`market-assassin.vercel.app/`, verified live) render the old
   "Government Contracting Intelligence Tools" grid at `/`.

`/briefings` then: no saved legacy email → `/alerts/signup` (free signup form); with one →
"Market Research" card → `/federal-market-assassin` → (no `ma:` cookie) `/market-assassin-locked`
→ enter email → **"No access found for this email. Please purchase below."**

## Entry-point table (before → after)

| Old path | Before (live, measured) | After (this branch, local) | Evidence |
|---|---|---|---|
| `/briefings?welcome=true` (Stripe return) | legacy dashboard / → `/alerts/signup` | 307 → `/app` (sign-in or dashboard) | curl + browser |
| `/briefings?panel=X&email=Y` | legacy dashboard | 307 → `/app?panel=X'&email=Y` (panel mapped; only email/notice/utm carried) | curl + browser (prefill shown) |
| `/briefings/dashboard` | legacy stats page | 307 → `/app?panel=dashboard` | curl |
| `/bd-assist` | → `/briefings` | 307 → `/app?panel=pipeline` | curl |
| `/` on non-`getmindy.ai` hosts | legacy tools grid | recovery-token hop kept; else → `/app` (canonical domain for prod aliases) | browser (localhost) |
| `/market-assassin-locked` with a non-MA email | "No access found… purchase below" | → `/app?panel=research&email=` | browser |
| `/federal-market-assassin` with `ma:` cookie | tool | **unchanged** (paid legacy tool) | code |
| `/purchase/success` quick links | 2×404, retired sales page, legacy DB gate | `/app` panels + `/opportunity-map` | browser |
| `/activate` tiles | MA → `/market-assassin` (308 → home); briefings → `/briefings`; recompete → SEO page | `/federal-market-assassin`, `/app`, `/app?panel=recompetes` | unit |
| MI Pro welcome email CTA | `/market-intelligence` | `mindyDashboardUrlFor(to)` (email policy #1362) | unit |
| MA access email (webhook) | `/market-assassin?email=` (308 → home) | `/federal-market-assassin?email=` | unit |
| FHC / Alert Pro / bundle emails | `/market-assassin`, `/market-intelligence` | `/federal-market-assassin` (holders) / Mindy dashboard URL | unit |
| mute, pipeline, contacts, shared-opp, alerts-signup, market-intelligence pages | `/briefings`, `/bd-assist` | `/app` (+ panel) | unit |

Untouched on purpose: `/briefings/feedback/*`, `/alerts/preferences`, `/alerts/signup` (page),
all `/api/*`, webhook grant logic, `/federal-market-assassin` for entitled holders.

## Destination decision — needs Eric's confirmation

The brief says "route to the current Mindy /app". The repo also carries a frozen rule
(2026-08-24/25, #1362) that `/app` is itself legacy and **emails must land on Maps**
(`legacy-destination-guard.ts`, `email-branding.ts`). This branch follows the brief for
**pages/redirects** (→ `/app`, where the paid panels live) and the enforced guard for
**emails** (→ `mindyDashboardUrlFor`, i.e. `/opportunity-map`). If pages should go to Maps
instead, it is a one-line change: `WORKSPACE_PATH` in `src/lib/mindy/legacy-routes.ts`
(plus the panel map).

## Infrastructure proposal (NOT executed — needs approval)

Update the after-completion redirect on two live Stripe payment links:

| Link | Product | Current | Proposed |
|---|---|---|---|
| `plink_1TTYfRK5zyiZ50PBkZ4mukPq` | Market Intelligence $149/mo | `https://getmindy.ai/briefings?welcome=true` | `https://getmindy.ai/purchase/success?product=briefings_monthly` |
| `plink_1TTYhlK5zyiZ50PBGhvWwBLq` | Market Intelligence $1,490/yr | same | `https://getmindy.ai/purchase/success?product=briefings_annual` |

Optional: `plink_1TBXg2…` Alert Pro $19 → `/alerts/preferences?upgraded=true` (working page; low priority).
The code redirect makes the current URL safe, so this is cleanup, not a blocker.

## Remaining legacy surfaces (not changed here)

- `/briefings` page code itself (now unreachable via proxy; deletion is a separate cleanup).
- Admin-triggered email templates: `lib/briefings/recompete/email-templates.ts`,
  `lib/briefings/contractor-db/email-templates.ts` (link `/briefings/settings` and
  `/briefings/unsubscribe`, which don't exist), `admin/send-all-briefings`, `admin/feedback`,
  `admin/align-treatment-types`.
- `sendLicenseKeyEmail` / bundle `activateUrl` → `shop.govcongiants.com/activate` (separate repo).
- In-app upgrade CTAs → `/market-intelligence` (a Mindy sales page; its verify step now lands on `/app`).
- SEO pages linking `/opportunity-hunter`, `/recompete`; `lib/dsbs-scoring.ts` CTAs; `/store` page.
- `vercel.json`: `tools.govcongiants.org/*` → `mi.govcongiants.com` (which then → `getmindy.ai`).
- Webhook tier detection: no amount-based fallback for a $149 line item without tier metadata (both current links carry `tier: briefings`, so not triggered today).

## Post-release acceptance plan (bounded, after an approved merge + deploy)

1. Serving SHA contains this branch's merge commit.
2. `curl -sI https://getmindy.ai/briefings?welcome=true` → 307 `Location: /app`;
   same for `/bd-assist` (→ `/app?panel=pipeline`) and `/briefings/dashboard`.
3. `curl -s https://market-assassin.vercel.app/` does **not** contain "Government Contracting Intelligence Tools".
4. Browser (logged out): open the Stripe success URL → Mindy sign-in renders; back button does not loop.
5. Browser: `/market-assassin-locked` with a test email without `ma:` → lands on `/app?panel=research`.
6. `/briefings/feedback/thanks` and `/alerts/preferences` still 200.
7. Only after 1–6: apply the Stripe proposal above (with approval), then buy-flow check with a test link.
8. Do **not** tell Adam or Andre they are fixed until 1–6 pass in production; any outreach is Eric's call.
