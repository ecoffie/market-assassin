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

| # | Item | Scope (one line) | Effort | Reuses | PRD/SPEC |
|---|------|------------------|--------|--------|----------|
| 1 | **Recompete SOW Match** | On an expiring contract, semantic-match the recovered SOW corpus → "likely incumbent SOW (X% confident)". The BD-moat feature. | M (1–2d) | SOW corpus (7,009 SOWs, built), `RecompetesPanel`, OpenAI embed | `docs/SPEC-semantic-embedding-engine.md` |
| 2 | **Content Reaper woven in** (#13) | "Mindy writes your BD content" — LinkedIn posts / outreach from a tracked opp. | M | existing Content Reaper, `callLLM` | `docs/PRD-mindy-bd-content-v1.1.md` |
| 3 | **Year-selector in Market Research** (#26) | Pick fiscal year + multi-year trend (today auto-rolls latest complete FY). | S (<1d) | market-research API, USASpending | — (small) |
| 4 | **Interactive product tour** | In-app "click here" walkthrough for new users. | M | onboarding flow | `tasks/todo.md` P1 |
| 5 | **Light / Dark mode** | Themeable-tokens refactor; lives in user settings. PRD ready. | S–M | app chrome | `docs/PRD-light-mode.md` |
| 6 | **Amendments INTO daily alerts** | Pursuit-change digest is a separate email today; optionally fold into the daily alert. | S | `pursuit-changes` cron (built), `daily-alerts` | — (small wiring) |
| 7 | **Proposal Assist v2 polish** | per-doc notes, compliance who/status, draft versions. | M | Proposal Assist (shipped) | `tasks/todo.md` |
| 8 | **Gov Market Research — buyer side** (Mindy as the 3rd alternative) | **Enhance the LIVE `/agency` tool**: CO uploads draft requirement PDF → auto-fill §5 taxonomy → deepen §11–12 small-biz market depth (performer-weighted, the slice SBS can't do) + wire §9/§14/§16 into the export. ~15–20% of the MRR but the highest-CO-pain slice. NOT the full MRR; never auto-generate determinations/signatures. | M (partly built) | LIVE: `/agency`, `gov-buyer/market-research` route + rubric engine + export; reuse `pdf-extract`, `profile-from-text`, BQ recipients | `docs/PRD-gov-market-research.md` + `docs/gov-mrr-template-reference.md` (real MAY-2026 MRR map) |

**Recommended v1.1 build order:** (1) Recompete SOW Match — the moat, corpus is
ready → (3) year-selector — quick win → (8) Gov Market Research — strategic (buyer
side, mostly reuse) → (2) Content Reaper → rest as time allows.

---

## 🔵 v2.0 — net-new infrastructure

| # | Item | Scope | New infra needed | Reuses | PRD |
|---|------|-------|------------------|--------|-----|
| A | **Email-in to Mindy** (TripIt model) | Forward any opp email (labs/AF/Army/NECO/eBuy) → tracked pursuit. Per-user forwarding address. | Inbound email (Resend Inbound), MX record, `/api/webhooks/inbound-email`, per-user address map, spoofing/DKIM security, dedup | `user_pipeline` (`source='email-in'`), `pdf-extract`, `buildProfileFromText`, Resend | **TODO — write next** (`tasks/BACKLOG-later.md` has the shape) |
| B | **Semantic "find work like mine"** | Describe your work → cosine-match the FULL active-SOW corpus → opps that match by MEANING (building-envelope=cyber). | pgvector (full-corpus scan, not pre-filtered) | SOW corpus, embed engine (v1.1 #1 builds the lib) | `docs/PRD-semantic-hidden-work-discovery.md` |
| C | **Multi-source opportunity adapters** | Scrape/ingest NIH/DARPA/NSF labs, AF/Army open sols, NECO, GSA eBuy → unified feed. | Per-source scrapers + normalizer + dedup vs SAM | multisite MCP (partial), `agency_forecasts` pattern | `docs/PRD-agency-intel-scrapers.md`, `docs/PRD-dod-forecast-coverage.md` |
| D | **DoD Forecast Coverage (real)** | Component LRAF scrapers (Army/Navy/NAVFAC → AF/DLA → DHA/SOCOM) into `agency_forecasts`. | New scrapers (rate-limited, resumable) | forecast pipeline | `docs/PRD-dod-forecast-coverage.md` |
| E | **Real gov-contact roles** | CO / PM / engineer / end-user roles (null at SAM/FPDS source). | Commercial enrichment source (HigherGov/LinkedIn-grade) | contacts pipeline | `tasks/todo.md` P1 #5 |
| F | **Recompete SOW recovery — archive backfill** | Recover SOWs for expired sols no longer in cache via SAM archive (`archived=true`). | SAM archive fetch pipeline | SOW catalog (built), `sow-catalog-drain` | `docs/PRD-semantic-hidden-work-discovery.md` Phase 6 |

**The v2.0 dependency chain:** v1.1 #1 (embed engine) unlocks v2.0 B. Email-in (A)
is the most-requested net-new capability and the natural v2.0 lead.

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
