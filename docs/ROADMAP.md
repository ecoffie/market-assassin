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

### ▸ #1 — Recompete SOW Match  (M, 1–2d · the BD-moat)
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

### ▸ #3 — Year-selector in Market Research  (S, <1d · quick win)
**Goal:** Let the user pick fiscal year + see multi-year trend (today auto-rolls latest complete FY).
**First file:** the market-research API route (find `time_period` / FY logic) + `MarketResearchPanel.tsx`.
**Steps:** add a `year` / `years` param to the research API (default = current behavior) → year dropdown in the panel → pass through to the USASpending `time_period`. Ground every figure in the selected FY's real data.
**Blocker:** none.
**Done-when:** selecting a prior FY changes the numbers to that year's real data; multi-year shows a trend; verified 200.

### Index (expand to a card when you start)
| # | Item | Effort | Reuses | PRD |
|---|------|--------|--------|-----|
| 2 | **Content Reaper woven in** (#13) — Mindy writes BD content from a tracked opp | M | Content Reaper, `callLLM` | `docs/PRD-mindy-bd-content-v1.1.md` |
| 4 | **Interactive product tour** — in-app walkthrough | M | onboarding flow | `tasks/todo.md` P1 |
| 5 | **Light / Dark mode** — themeable tokens, in user settings | S–M | app chrome | `docs/PRD-light-mode.md` |
| 6 | **Amendments INTO daily alerts** — fold pursuit-change digest into the daily email | S | `pursuit-changes` cron, `daily-alerts` | — (small wiring) |
| 7 | **Proposal Assist v2 polish** — per-doc notes, compliance who/status, draft versions | M | Proposal Assist | `tasks/todo.md` |

---

## 🔵 v2.0 — net-new infrastructure

| # | Item | Scope | New infra needed | Reuses | PRD |
|---|------|-------|------------------|--------|-----|
| A | **Email-in to Mindy** (TripIt model) | Forward any opp email (labs/AF/Army/NECO/eBuy) → tracked pursuit. Per-user forwarding address. | Inbound email (Resend Inbound), MX on `in.getmindy.ai`, `/api/webhooks/inbound-email`, per-user address map, spoofing/DKIM security, dedup | `user_pipeline` (`source='email-in'`), `pdf-extract`, `profile-from-text`, Resend (`webhooks/resend` exists) | **`docs/PRD-email-in.md`** ✅ |
| B | **Semantic "find work like mine"** | Describe your work → cosine-match the FULL active-SOW corpus → opps that match by MEANING (building-envelope=cyber). | pgvector (full-corpus scan, not pre-filtered) | SOW corpus, embed engine (v1.1 #1 builds the lib) | `docs/PRD-semantic-hidden-work-discovery.md` |
| C | **Multi-source opportunity adapters** | Scrape/ingest NIH/DARPA/NSF labs, AF/Army open sols, NECO, GSA eBuy → unified feed. | Per-source scrapers + normalizer + dedup vs SAM | multisite MCP (partial), `agency_forecasts` pattern | `docs/PRD-agency-intel-scrapers.md`, `docs/PRD-dod-forecast-coverage.md` |
| D | **DoD Forecast Coverage (real)** | Component LRAF scrapers (Army/Navy/NAVFAC → AF/DLA → DHA/SOCOM) into `agency_forecasts`. | New scrapers (rate-limited, resumable) | forecast pipeline | `docs/PRD-dod-forecast-coverage.md` |
| E | **Real gov-contact roles** | CO / PM / engineer / end-user roles (null at SAM/FPDS source). | Commercial enrichment source (HigherGov/LinkedIn-grade) | contacts pipeline | `tasks/todo.md` P1 #5 |
| F | **Recompete SOW recovery — archive backfill** | Recover SOWs for expired sols no longer in cache via SAM archive (`archived=true`). | SAM archive fetch pipeline | SOW catalog (built), `sow-catalog-drain` | `docs/PRD-semantic-hidden-work-discovery.md` Phase 6 |

**The v2.0 dependency chain:** v1.1 #1 (embed engine) unlocks v2.0 B. Email-in (A)
is the most-requested net-new capability and the natural v2.0 lead.

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

| Pri | Item | PRD |
|---|---|---|
| **P0** | **DoD Forecast Coverage — Option A** (component LRAF scrapers: Army/Navy/NAVFAC → AF/DLA → DHA/SOCOM into `agency_forecasts`, reusing the civilian pipeline; no schema/UI rebuild). Option B (early-signals) already SHIPPED as the interim. | `docs/PRD-dod-forecast-scrapers.md` |
| **P0** | **Cron Dispatcher — Phase 2** (migrate the remaining ~24 crons off the band-aid; load-bearing send pipelines LAST, carefully) — unblocks scale to 50K users past the Vercel 100-cron cap. | `docs/PRD-cron-dispatcher.md` |
| **P1** | Light/dark mode (also v1.1 #5) · Newcomer clarity (OG previews on last public pages) · Real gov-contact roles (needs a commercial-enrichment buy decision) | — |

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
- **8,834 unconfigured users — DEFERRED until AFTER the migration** (Eric, June 10:
  "once we move everyone over to Mindy then we can deal with it"). These have
  accounts but only the default fallback NAICS (`541512/541611/541330/541990/561210`)
  or empty — ~89% of ~9,910 accounts, mostly the batch-seeded bootcamp enrollees.
  They get generic/no alerts. The fix is an **activation campaign → the new
  Auto-setup (#12, paste→profile in 30s)** — but do NOT run it mid-migration (auth/
  domain surface shifting = broken links at the worst time). Sequence: **finish
  mi→getmindy → THEN activation campaign on solid ground.** (Admin dashboard:
  "General Unconfigured Users".)
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

*Last updated: June 2026 (post-#66). Maintained as the canonical next-work index.*
