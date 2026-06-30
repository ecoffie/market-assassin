# Mindy ROADMAP — v1.1 & v2.0

**Single source of truth** for what's next. Consolidates `tasks/todo.md`,
`tasks/BACKLOG-later.md`, the pending task list, and the `docs/PRD-*` files into two
release buckets. Pick an item, open its PRD/SPEC, build it.

**The line (June 2026):**
- **v1.1 = built on EXISTING infrastructure** — fast-follows that reuse what's
  already shipped (the SOW corpus, `user_pipeline`, `buildProfileFromText`,
  Resend, the dispatcher cron, the panels). Shippable without new plumbing.
- **v2.0 = needs NET-NEW infrastructure** — inbound email, multi-source scrapers,
  pgvector, etc. Each needs a provider/MX/webhook/extension decision first.

> **Status as of the Juneteenth (June 19) drop:** v1.0 is shipped & live on
> getmindy.ai (tasks #6–#66). Everything below is post-launch.

> **Code-verified status — 2026-06-30 (audit against the live codebase).** Several
> rows shipped since the June 10 draft but were never crossed off; a couple are
> still genuinely open. Verdicts below are grounded in real file paths, not the old
> estimates. Legend: ✅ SHIPPED · 🟡 PARTIAL (what's left noted inline) · ⬜ NOT STARTED.

---

## 📍 What's actually left (2026-06-30 audit summary)

**Already shipped (don't rebuild):** v1.1 #1 Recompete SOW Match (engine+API+UI),
v1.1 #4 Product Tour, v2.0 #F SOW archive backfill, v2.0 #B engine half.

**Cheapest wins left (engine exists — finish the surface):**
1. **v2.0 #B user surface** — "describe your work → matched opps" route + panel (the
   hidden-match engine already runs silently in alerts).
2. **v1.1 #7 polish** — per-doc notes + draft version history (who/status already done).
3. **v1.1 #3** — FY year-selector in Market Research (small, fully open).

**Net-new builds (real infra/scope):** v1.1 #2 Content Reaper weave · #5 dark mode ·
#6 amendments-in-alerts · v2.0 #A Email-in · #C/#D scrapers · #E contact-role enrichment.

**⚠️ Highest-priority non-feature:** **Cron Dispatcher Phase 2** — `vercel.json` is at
~55 native crons (cap 100); only ~2 jobs run via the dispatcher. This is a latent
ship-blocker, not a feature. Treat as P0.

---

## 🟢 v1.1 — fast-follow (existing infra)

**Build order:** #1 Recompete SOW Match (the moat, corpus ready) → #3 Year-selector
(quick win) → #2 Content Reaper → rest as time allows.

> Gov Market Research moved OUT of v1.1 — it serves government BUYERS, not our
> contractor users. See "🏛️ Buyer-side products" below.

Items #1–#3 are written as **build cards** (pick up and go). #4–#7 are index rows;
expand to a card when you start one. Each card: **first file → steps → blocker →
done-when.** Run the **Data Feature Builder** agent on data features, `/ship` to deploy.

---

### ▸ #1 — Recompete SOW Match  (M, 1–2d · the BD-moat) — ✅ SHIPPED (#67)
> **DONE end-to-end (verified 2026-06-30).** Engine: `src/lib/market/embeddings.ts`
> (`embedText`/`cosineSimilarity`/`topMatches`); migrations `20260611_sow_embeddings.sql`
> + `20260613_capability_embeddings.sql`; SOW corpus embedded (~8,790/8,799). API:
> `GET /api/app/recompete-sow` (agency + 3-digit-NAICS pre-filter, cosine rank,
> confidence = score AND gap). UI: `src/components/app/awards/RecompeteSowMatch.tsx`
> — lazy "▸ Find incumbent SOW" button in `RecompetesPanel.tsx` (L1219), renders
> confident / possible-only / no-match honestly with % similar + SOW snippet + SAM link.
> Nothing left.

**Goal:** On an expiring contract, surface "likely incumbent SOW (X% confident)".
**Full spec:** `docs/SPEC-semantic-embedding-engine.md` (has the honesty/gap-confidence layer).
**First file:** new `src/lib/market/embeddings.ts`.
**Steps:**
1. `/migrate` — add `sow_embedding JSONB` + `sow_embedded_at` to `sam_opportunities` (SQL in the SPEC).
2. Build `embeddings.ts`: `embedText()` (OpenAI text-embedding-3-small), `cosineSimilarity()`, `topMatches()`.
3. `scripts/sow-embed-drain.ts` (mirror `sow-catalog-drain.ts`) → backfill 6,901 SOWs locally (~mins, ~$0.001).
4. `GET /api/app/recompete-sow` — embed contract desc → pre-filter SOWs by agency+3-digit-NAICS → cosine-rank → top 1–3 with `top_score`, `runner_up_score`, `gap`, verdict. **Confidence = score AND gap, not score alone.**
5. **API spot-check 5–10 real recompetes BEFORE any UI** (tune THRESHOLD + MIN_GAP from logged telemetry).
6. Only then: lazy "📄 Find incumbent SOW" button in `RecompetesPanel.tsx` → drawer; label "likely SOW match by semantic similarity".
**Blocker:** none — SOW corpus (7,009) is built; OpenAI key set; in-app cosine (no pgvector needed).
**Done-when:** API returns confident matches <2s; spot-checks plausible; honest "no match" below threshold; marketing literature updated; shipped + 200.

### ▸ #3 — Year-selector in Market Research  (S, <1d · quick win) — ⬜ NOT STARTED
> **Still open (verified 2026-06-30).** `target-market-research/route.ts` takes no
> `year`/`years` param (FY window hardcoded); `MarketResearchPanel.tsx` has no FY
> picker. Cheapest remaining v1.1 quick win.

**Goal:** Let the user pick fiscal year + see multi-year trend (today auto-rolls latest complete FY).
**First file:** the market-research API route (find `time_period` / FY logic) + `MarketResearchPanel.tsx`.
**Steps:** add a `year` / `years` param to the research API (default = current behavior) → year dropdown in the panel → pass through to the USASpending `time_period`. Ground every figure in the selected FY's real data.
**Blocker:** none.
**Done-when:** selecting a prior FY changes the numbers to that year's real data; multi-year shows a trend; verified 200.

### Index (expand to a card when you start) — verdicts code-verified 2026-06-30
| # | Item | Status | Evidence / what's left |
|---|------|--------|------------------------|
| 2 | **Content Reaper woven in** — Mindy writes BD content from a tracked opp | ⬜ NOT STARTED | No `bd-content` route under `/api/app`; only the standalone `/api/content-generator`. |
| 4 | **Interactive product tour** — in-app walkthrough | ✅ SHIPPED | `src/components/app/ProductTour.tsx` (driver.js), rendered in `app/page.tsx` (~L1319). |
| 5 | **Light / Dark mode** — themeable tokens, in user settings | ⬜ NOT STARTED | App is dark-only by design (`globals.css`); no `next-themes`/toggle/`data-theme`. |
| 6 | **Amendments INTO daily alerts** — fold pursuit-change digest into the daily email | ⬜ NOT STARTED | `daily-alerts/route.ts` has only a static "check SAM for amendments" string; `pursuit-changes` cron stays separate. |
| 7 | **Proposal Assist v2 polish** — per-doc notes, compliance who/status, draft versions | 🟡 PARTIAL | who/status DONE (`proposal/compliance-state` — owner + open/in_progress/done/n_a, PATCH). LEFT: per-doc notes + draft version history. |

---

## 🔵 v2.0 — net-new infrastructure  (verdicts code-verified 2026-06-30)

| # | Item | Status | Scope / what's left |
|---|------|--------|---------------------|
| A | **Email-in to Mindy** (TripIt model) | ⬜ NOT STARTED | Forward any opp email → tracked pursuit. No `inbound-email`/`in.getmindy.ai`/webhook in code yet. Needs Resend Inbound + MX + per-user address map + DKIM/dedup. PRD ready: **`docs/PRD-email-in.md`**. The natural v2.0 lead. |
| B | **Semantic "find work like mine"** | 🟡 PARTIAL (engine done, no user surface) | Engine SHIPPED: `src/lib/alerts/hidden-match.ts` + `capability-vector.ts`, wired into `daily-alerts` behind `ENABLE_HIDDEN_MATCH`/rollout/whitelist flags; status at `admin/hidden-match-status`. LEFT: a user-facing "describe your work → matched opps" search route + panel (today it only runs silently inside alerts). |
| C | **Multi-source opportunity adapters** | 🟡 PARTIAL | Have adapters: NIH, DARPA, NSF(SBIR), NECO (`src/lib/scrapers/apis/*`, `SourceId` in `scrapers/types.ts`); snapshot cron exists. LEFT: AF, Army, GSA eBuy as distinct adapters; a user-facing unified `/api/app/multisite` search. |
| D | **DoD Forecast Coverage (real)** | 🟡 PARTIAL (scaffolded) | `src/lib/forecasts/scrapers/dod-multi-source.ts` has Army/Navy/AF/DLA source URLs + `parseDODRow` (Phase 4). LEFT: file-import is stubbed ("not implemented yet"); no NAVFAC scraper. Option B early-signals shipped as interim. |
| E | **Real gov-contact roles** | 🟡 PARTIAL (column only) | `role_category` column exists (`20260604_federal_contacts.sql`) but only `contracting`/`small_business` populated from SAM POCs. LEFT: CO/PM/engineer/end-user — blocked on a commercial-enrichment buy decision. |
| F | **Recompete SOW recovery — archive backfill** | ✅ SHIPPED (interim form) | `src/app/api/cron/sow-catalog/route.ts` (#66) drains active opps then recovers inactive/expired-sol SOWs (by `archive_date`) into the recompete corpus. Recovers from cached attachment URLs rather than a dedicated SAM `archived=true` pull — adequate for now. |

**The v2.0 dependency chain:** v1.1 #1 embed engine (✅ done) already unlocked B's
engine. Email-in (A) is the most-requested net-new capability and the natural v2.0 lead.

---

## 🏛️ Buyer-side products — DIFFERENT AUDIENCE (not for our sellers)

> **Important (Eric):** these serve **government BUYERS (contracting officers)**, NOT
> our contractor users. They do **not** benefit the people paying for Mindy today —
> they're a *separate product line for a separate audience*. Track them here, but do
> NOT list them as user features or in the seller-facing marketing. Pursue only as a
> deliberate buyer-side GTM decision, not as a v1.1 user feature.

| Item | Audience | Notes | PRD |
|---|---|---|---|
| **Gov Market Research** (CO does FAR Part 10 MRR market-depth) | Gov buyers (COs) | LIVE skeleton at `/agency` + `gov-buyer/market-research`. Enhancing it is buyer-side product work, not a seller feature. | `docs/PRD-gov-market-research.md` |

---

## 🟡 P2 — Quick wins (slot between bigger pieces)

Small, incremental — grab one when you have a gap.

| Item | Scope | PRD/note |
|---|---|---|
| **Civilian office decode** | Extend the DoDAAC office-roster decode to GSA/VA/HHS solicitation formats (office rosters are DoD/DLA/Navy-only today). | — |
| **NAICS + state combo** | Contractor state filter is name-search only (BQ rollup has no per-NAICS location); needs a location-aware path. | — |
| **5-role contacts** | Add KO + the other 4 BD roles (the `role_category` column groundwork exists). | `tasks/todo.md` P1 #5 |
| **Deal-flow board** | Kanban-style pipeline board view. | `docs/PRD-deal-flow-board.md` |
| **SaaS landing page** | A proper marketing landing for getmindy.ai (vs the app). | — |
| **Cal-AI simplification sweep** | UI simplification pass (Cal-AI reference). | — |

---

## 📦 P0/P1 (bigger, PRD-ready — from `tasks/BACKLOG-later.md`)

These have full PRDs (phasing/risks/success criteria worked out) — "open the doc and go."

| Pri | Item | Status | PRD |
|---|---|---|---|
| **P0** | **DoD Forecast Coverage — Option A** (component LRAF scrapers into `agency_forecasts`). Same work as v2.0 #D. | 🟡 PARTIAL — `dod-multi-source.ts` scaffolded, file-import stubbed. Option B interim shipped. | `docs/PRD-dod-forecast-scrapers.md` |
| **P0** | **Cron Dispatcher — Phase 2** — migrate remaining native crons onto the dispatcher; load-bearing send pipelines LAST. Unblocks scale past the Vercel 100-cron cap. | ⬜ NOT STARTED — **dispatcher infra is live but only ~2 jobs registered in `cron_jobs`; `vercel.json` still holds ~55 native crons (grew, not shrank).** Real ship-blocker: 45 crons from the cap, and one new `vercel.json` cron blocks the whole deploy. | `docs/PRD-cron-dispatcher.md` |
| **P1** | Light/dark mode (also v1.1 #5) · Newcomer clarity (OG previews on last public pages) · Real gov-contact roles (v2.0 #E — needs a commercial-enrichment buy decision) | ⬜ open | — |

---

## ⚙️ Infra / Ops notes (remember — NOT tasks)

- **mi→getmindy final cutover is READY** — runbook `tasks/mi-to-getmindy-cutover-runbook.md`.
  `NEXT_PUBLIC_APP_URL` is already flipped for the share loop. 139 refs / 61 files
  bucketed: (A) env-var-driven → just set the var, (B) hardcoded URLs → code change,
  (C) host-pinned auth redirects → flip carefully (auth-critical). **Golden rule: the
  old domain becomes a permanent 301, NEVER a shutdown** — years of sent email links
  must keep resolving. `auth.getmindy.ai` is already done (verify only, no data
  migration). Say **"do the final migration"** to execute step-by-step.
- **Hand-run DDL + NOTIFY pgrst quirk** — this DB has no in-app DDL; after a schema
  change you may need to reload the PostgREST schema cache (`NOTIFY pgrst, 'reload schema'`)
  for new columns to be queryable.
- **Commit + push BEFORE `vercel --prod`** (Process Non-Negotiable).
- **DoDAAC directory refresh is auto-cron'd** (dispatcher) — not a manual task anymore.
- **Public tier rename — AFTER migration** (Eric, June 10): an ADDITIVE ladder (each
  tier = prior + more), named by WHO buys. `free`→**"Mindy"** (curious-about-GovCon
  individual; never "Mindy Free" publicly — internal only), `pro`→**"Solopreneur"/
  "Mindy Pro"** (solo operator; Mindy + full BD suite), `team`→**"Teams"** (Solopreneur
  + multiple users — small businesses WITH employees AND consultants/coaches/agencies
  with multiple clients via Coach mode), `enterprise`→**"Enterprise"** (Teams +
  org-scale shared access — national orgs APEX/USHCC AND mid/large businesses with 5+
  BD staff: user mgmt, RBAC, cross-user sharing, reporting, group alerts, calendar
  invites; org caps = separate v2.0+ build). Rename = public surfaces only (keep
  `MITier` keys + internal IDs). Plan: `docs/PRD-public-tier-naming.md`.
- **8,834 unconfigured users — DEFERRED until AFTER the migration** (Eric, June 10:
  "once we move everyone over to Mindy then we can deal with it"). These have
  accounts but only the default fallback NAICS (`541512/541611/541330/541990/561210`)
  or empty — ~89% of ~9,910 accounts, mostly the batch-seeded bootcamp enrollees.
  They get generic/no alerts. The fix is an **activation campaign → the new
  Auto-setup (#12, paste→profile in 30s)** — but do NOT run it mid-migration (auth/
  domain surface shifting = broken links at the worst time). Sequence: **finish
  mi→getmindy → THEN activation campaign on solid ground.** (Admin dashboard:
  "General Unconfigured Users".) **Full plan: `docs/PRD-migration-onboarding.md`** —
  segmented: ~83% are imported bootcamp leads (suppress generic alerts → nurture, NOT
  onboard); the real base is ~1,076 custom-NAICS (11%) (claim-account → Auto-setup). Don't chase
  the 9,910 vanity number.
- **Google Drive KB ingest** (if redone): auth gcloud as the GovCon Drive account →
  export ~373 files → migration + deploy → ingest.

---

## 📎 Cross-cutting (do alongside, any release)
- **Cron Dispatcher Phase 2** — migrate remaining jobs off the band-aid (`docs/PRD-cron-dispatcher.md`).
- **Marketing literature** — update on every feature push (standing rule).
- **Process Non-Negotiables** — ground in data, measure-before-build, verify-before-done (`~/CLAUDE.md`).

## How to use this
Pick an item → open its PRD/SPEC → run the **Data Feature Builder** agent (or
`/ship` for small ones). v1.1 items are independent; build in the recommended
order. v2.0 items need an infra decision first — write/read the PRD before coding.
Delete rows as they ship; this stays the live map.

*Last updated: 2026-06-30 — code-verified audit pass (v1.1 + v2.0 + P0/P1). Marked
#1/#4/#F shipped, corrected the native-cron count (~55, Phase 2 not started), re-ranked
what's actually left. Maintained as the canonical next-work index.*
