# PRD: Government Buyer Market Research

> A reverse-search surface for federal contracting officers and acquisition staff:
> instead of "find contracts for this business," answer "find businesses for this requirement."

**Status:** Draft / scoping — captured 2026-06-04. No code yet.
**Origin:** Two government officials asked to use Mindy in reverse — to find qualified small businesses for their acquisitions and justify set-aside decisions.
**Related docs:**
- `tasks/TODO-contractor-database-expansion.md` (entity re-source + SBS differentiation)
- `docs/TODO-mi-beta-opengov-iq-database-buildout.md` (OpenGov IQ teardown notes)
- `docs/PRD-bd-assist-platform.md` (seller-side BD platform — this is its buyer-side mirror)
- `docs/govcon-market-research.md` (GAO-15-8 market research framework)

---

## 1. Executive Summary

Mindy today is a **seller** tool: small businesses get matched to contracts. Two government officials want the **buyer** view — a contracting officer asking *"Are there enough qualified small businesses in NAICS 541512 in the DC area to justify an 8(a) set-aside for this $2M IT requirement?"*

We can answer that with ~80% existing infrastructure. The reverse search is mostly a query-direction flip plus one new idea: **don't count registrations, count performers.** A registration is a claim; an award is proof.

**The moat (vs. the free government tool):** SBA retired DSBS on 2025-07-09 and replaced it with **SBS** (`search.certifications.sba.gov`). SBS runs on the **same SAM.gov data** we'd ingest — so a bare "search SAM entities by NAICS/state/set-aside" feature just rebuilds a staler SBS. Our differentiation is what we **join onto** the registry that SBS cannot:

- **Award history + 5yr federal revenue per firm** (BQ `awards`/`recipients`, 63M awards) — separates real performers from dormant/paper registrations.
- **Incumbency** (`recompete_opportunities`) — who holds the expiring contract this requirement replaces.
- **Rule-of-Two market-depth count**, performance-weighted — one defensible number.
- **Searchable capability statements** (seller uploads — see §6) — SBS has only self-typed profile text.
- **Government people search** beyond the contracting officer (see §7) — the 5 BD roles, not just the KO.
- **Exportable market-research determination memo** (.docx) for the CO's file.

> **One line:** *SBS tells a contracting officer who claims to qualify. Mindy tells them who actually performs — and who to talk to.*

---

## 2. Goals & Non-Goals

### Goals (pilot)
- Let a verified government buyer search businesses by **NAICS + state + set-aside**.
- Return a **performance-weighted market-depth count** that supports a Rule-of-Two / set-aside determination.
- Show **award history + total federal revenue** per business.
- **Export a market-research memo** (.docx) the CO can file.
- Gate the surface to government users only; sellers never see it, buyers see only it.

### Non-Goals (explicitly deferred — creep guard)
- Full federal-employee directory enrichment (program managers, engineers, end-users from agency org charts / GSA / LinkedIn). We ship the **contracting-contact** layer from our own SAM data and structure for the rest later (§7).
- Real-time SAM cross-checks per result row.
- Multi-tenant agency accounts / SSO.
- Buyer-side saved searches, alerts, or CRM.
- Capability-statement *authoring* (we surface seller uploads; we don't build a cap-statement editor for buyers).

---

## 3. The Data Picture (audited 2026-06-04)

### Entity coverage — TWO ingest paths (decided 2026-06-04)
The SAM Entity **API** caps page size at **10**, so covering one NAICS needs
thousands of calls against a 1,000/day shared limit (~31 days for 8 NAICS).
The **PUBLIC monthly extract** is the whole registry in one ~138MB ZIP, no
per-record limit — the real coverage path.

- **Bulk extract** (`scripts/import-sam-entity-extract.mjs`) — downloads
  `SAM_PUBLIC_MONTHLY_V2_*.ZIP`, stream-parses the pipe-delimited `.dat`
  (884K entities), filters to seed NAICS, bulk-upserts. Run on a worker /
  locally (NOT serverless — too big). **Initial load: 160K rows for the 8
  seed NAICS.** Re-run monthly (SAM refreshes 1st Sunday). `--all-naics` for
  the full registry. **Cert codes are subtle:** the certified set-asides
  (8(a)=A6/JT, HUBZone=XX) live in field 118, NOT field 31 (which is general
  business types — mapping it inflated 8(a) to 95%, a trust-killer). A6
  carries a concatenated expiry date, so prefix-match.
- **API cron** (`sync-gov-buyer-data`) — the daily incremental top-up for
  freshness between monthly extracts (new registrations, status changes).

### What we have
| Asset | Source | Status |
|---|---|---|
| **SAM entity registry** | `sam_entities` ← bulk extract + API top-up | ✅ Live (160K seed-NAICS rows) |
| Award history per contractor | BQ `awards` (63M rows, all NAICS) | ✅ Live |
| 5yr revenue + activity per firm | BQ `recipients` (~317K, `total_obligated`, `last_action_date`, `award_count`, `distinct_agency_count`) | ✅ Live |
| Incumbent / recompete data | `recompete_opportunities` (Supabase) | ✅ Live |
| Seller business profile + cap statements | `user_identity_profile`, `user_boilerplate_docs` | ✅ Live |
| Upload + PDF parse pipeline | `src/lib/sam/pdf-extract.ts`, `vault-assets` bucket | ✅ Live (reuse) |
| Auth session | `requireMIAuthSession()` (`src/lib/two-factor-session.ts`) | ✅ Live |

### What's missing (the build)
| Gap | Why | Fix |
|---|---|---|
| **SAM entity registry** | OpenGov IQ access LOST (Base44 CSV only, stale). BQ `recipients` only has firms that *won* — the opposite of what a *new* set-aside needs. | New `sam_entities` table sourced from **SAM.gov bulk Entity Extract** (official, free, daily-refreshable). **#1 blocker.** |
| **Market-depth count query** | Nothing in the codebase counts firms by NAICS+state+set-aside. | New query (small). |
| **Structured set-aside filter** | `sba_business_types_string` is free text. | `certifications TEXT[]` + GIN index on the new table. |
| **Buyer user type** | All `/api/app/*` routes treat any logged-in user identically. | `user_type` on `user_profiles` + `.gov`/`.mil` gate (§5). |
| **Gov people beyond KO** | Our SAM POCs only reliably yield the contracting officer. | Re-source contracting contacts now; structure for the other 4 roles (§7). |

> **On the "50,000" number:** that was OpenGov IQ's *claim* for `SAMEntities`, captured second-hand and never row-verified (unlike `IDIQ_details`, a confirmed 50,000). The real SAM-registered universe is far larger (hundreds of thousands). We are not recreating their 50K slice — we're pulling the authoritative, fuller, fresher registry from SAM directly.

---

## 4. The Activity Rubric — "Active Performer Score"

**Core principle (Eric, 2026-06-04):** Don't show a CO a count of *registrations* — show a count of firms that *actually perform*, ranked by a defensible score. A registration is a claim; an award is proof. This is also the single thing SBS cannot do, so it doubles as the moat.

**Fairness rule (Eric, 2026-06-04):** *"My concern is it will eliminate new people who also need a chance."* The rubric is a **tiered lens, not a filter.** Qualified-but-never-won firms are **never hidden** — they become a named **Emerging** tier a CO can deliberately develop (valuable for new 8(a)/HUBZone programs). The rubric only stops dormant shells from *inflating* the headline number; it never removes a real, qualified, registered business from view.

### Signals (all real columns — no new data)
From BQ `recipients`, LEFT-joined to `sam_entities` by UEI:

| Signal | Column | Reads as |
|---|---|---|
| Recency | `last_action_date` | Won recently vs. dormant |
| Volume | `total_obligated` (5yr) | Real scale, not a shell |
| Frequency | `award_count` / `transaction_count` | Repeat performer vs. fluke |
| Breadth | `distinct_agency_count` | Multi-agency = lower risk |
| Relevance | `distinct_naics_count` + NAICS match | Does *this* kind of work |
| Longevity | `first_action_date` | Established vs. brand-new |
| Eligibility | `sam_entities.certifications[]`, `registration_status` | Holds the cert + active SAM reg |

> **LEFT join is deliberate:** registered-but-never-won firms survive the join (no award row) and score low — they become "Emerging" / "Registered Only," not deleted.

### Score (0–100)
| Factor | Weight | Logic |
|---|---|---|
| Recent activity | 30 | award ≤12mo = 30 · ≤24mo = 20 · ≤36mo = 10 · older/none = 0 |
| Set-aside eligibility | 25 | holds required cert; **verified** certs (8(a)/HUBZone/SDVOSB) weighted over self-cert (WOSB/SDB) |
| NAICS relevance | 20 | won under target NAICS = 20 · related only = 10 · registered-not-won = 5 |
| Track-record depth | 15 | scaled by `award_count` + `total_obligated`, **capped** so a giant doesn't crowd out small firms |
| Agency breadth | 10 | ≥3 agencies = 10 · 2 = 5 · 1 = 2 |

### Tiers (what a CO acts on)
| Tier | Score | Meaning for the determination |
|---|---|---|
| 🟢 Active Performer | 70+ | Won relevant work recently — **counts toward Rule of Two** |
| 🟡 Capable | 45–69 | Qualified + some history — credible, verify |
| 🟠 Emerging | 25–44 | Qualified, registered, thin/old record — **capacity-building candidate, shown by default** |
| ⚪ Registered Only | <25 | In SAM, no relevant awards — shown but flagged, excluded from the Rule-of-Two count |

### Count behavior (resolves the fairness concern)
- **Headline count** = Active Performer + Capable + Emerging (default **includes** Emerging — excluding new entrants is a bias we won't bake in silently).
- **"Registered Only"** shown as a **separate** secondary count so the CO sees the fuller pool without dormant shells inflating the justification number.
- A **toggle** lets the CO exclude Emerging for a strict performers-only view if they want it. Default ON.

### Why defensible
- Every point traces to a USASpending-sourced federal award record. Methodology is footnoted in the export memo. A CO won't sign a determination built on a black box.
- Mirrors the existing in-codebase pattern in `src/lib/briefings/win-probability.ts` (NAICS/set-aside/agency weighting) — proven shape to reuse.

---

## 5. Access & Auth Model

A government contracting officer is a fundamentally different user than a seller. **Decision (Eric, 2026-06-04): separate gov signup + `.gov`/`.mil` gate.**

### Model
- New `user_type` column on `user_profiles`: `'seller'` (default) | `'gov_buyer'`.
- **Email-domain gate:** signup for the buyer surface requires a `.gov` or `.mil` email. Verification via the existing magic-link / 2FA flow (`createMIAuthSessionToken`).
- Buyers see **only** the market-research surface; sellers never see it. Routing keys off `user_type`.
- New route family `/api/gov-buyer/*` gated by a thin wrapper over `requireMIAuthSession()` that additionally asserts `user_type === 'gov_buyer'`.

### Why a separate surface (not a flag on existing accounts)
- Clean separation of concerns: a CO shouldn't see seller upsells; a seller shouldn't see the buyer tool.
- `.gov`/`.mil` verification is a trust signal that matters for a government-facing product and for any future FedRAMP/ATO conversation.
- Pilot caveat: for the **two officials specifically**, we can hand-provision `user_type='gov_buyer'` immediately (manual grant) while the self-serve `.gov` signup is built — don't block the pilot on the signup flow.

### Open questions
- Self-serve `.gov` signup vs. invite-only for the pilot? (Recommend invite-only for the two officials; self-serve later.)
- Does the buyer tool live under a distinct path (e.g. `/gov` or `getmindy.ai/agency`) or as a `user_type`-gated panel inside `/app`? (Recommend distinct path for clarity + future standalone-product optionality.)

---

## 6. Capability Statements — Seller-Linked (Path A)

**Decision (Eric, 2026-06-04): Path A — seller-linked.** No other platform has a searchable database of capability-statement PDFs. We get one nearly for free.

- The upload + parse + store pipeline **already exists three times** (`/api/app/proposal/upload`, `/api/app/vault/documents`, pursuit-docs). All use `extractPdf/extractDocx/extractTxt`.
- A cap-statement slot already exists: `user_boilerplate_docs` with `doc_type='cap_stmt'`, bucket `vault-assets`, AI-parsed into `parsed_sections`. Today it's **user-scoped** (`user_email`).
- **Change:** add `uei` / `cage` to `user_boilerplate_docs`; link a seller's cap-statement upload to their `user_identity_profile.uei`. Buyers searching NAICS/state then see **attached cap-statement PDFs** for the subset of matching firms that are also Mindy sellers.
- **Flywheel:** more sellers → richer buyer database. The seller base directly funds the buyer moat. Zero new upload code — one column add.
- **Honest framing in the UI:** cap statements appear only for firms that are Mindy sellers; absence ≠ unqualified. Don't imply full coverage.

---

## 7. Government People Search (the 5 BD roles)

**Context (Eric, 2026-06-04):** A government official searched our active people database and **found his own name — and he was not a CO.** OpenGov IQ's `AllSamContacts` carried more than solicitation POCs. Per our BD/Capture framework, the people you must meet are **decision maker, program manager, engineer/technical lead, end user, and contracting officer** — and *"KO is the last line of defense, not the first."*

### The honest gap
| Role | In our `sam_opportunities.points_of_contact`? |
|---|---|
| Decision maker | ❌ Rarely |
| Program manager | ❌ No |
| Engineer / technical lead | ❌ No |
| End user | ❌ No |
| **Contracting officer (KO)** | ✅ Yes — the only role POCs reliably yield |

Recreating gov-contacts from our SAM POCs alone rebuilds the **least valuable** of the five. We will not pretend otherwise.

### The plan (Eric: "start with what we have and expand later — no feature creep")
1. **Ship the contracting layer now** from our own data. `scripts/populate-contracting-officers.js` already harvests `sam_opportunities.points_of_contact` (75K+ notices) into `federal_contacts`, deduped, garbage-name-filtered. This **self-refreshes** off the daily SAM opportunities sync.
2. **Cut `/api/app/relationships` off the dead OpenGov BQ.** It currently hardcodes `fresh-ward-455220-j0.samgovcons.AllSamContacts` (line ~35) — access we lost. Repoint it to native `federal_contacts` so it stops depending on a dead connection.
3. **Future-proof with one column:** add `role_category` to `federal_contacts` from day one — `contracting` (populated now) plus empty `program` / `technical` / `end_user` / `decision_maker` buckets. Expansion later becomes an **insert**, not a migration + re-architecture. The search UI, route, and buyer surface all key off `role_category` and don't care that only one bucket is full yet.

### Creep guard
We do **not** build the org-chart / GSA / enrichment pipeline for the other four roles in this pilot. The `role_category` column costs nothing today and is the *only* thing that prevents a painful rebuild when we do decide to add them. Building the enrichment now is the creep; the empty column is the discipline.

---

## 8. MVP Scope — Pilot for the Two Officials

**Decision (Eric, 2026-06-04): tightest viable pilot.**

### Endpoint
`GET /api/gov-buyer/market-research?naics=541512&state=DC&setAside=8a`
→ `{ counts: { activePerformer, capable, emerging, registeredOnly }, businesses[], setAsideBreakdown }`

Per business: name, UEI, CAGE, location, certs, NAICS, **Active Performer Score + tier**, recent awards, 5yr revenue, incumbency flag, cap-statement link (if seller).

### In scope
- NAICS + state + set-aside search against `sam_entities`.
- Activity rubric scoring + tiered counts (§4), with the Emerging-included default + toggle.
- Award history / revenue join from BQ (reuse `getContractorSalesHistory()` shape).
- Contracting-contact lookup (§7 step 1).
- `.docx` market-research memo export (adapt `/api/app/proposal/export`), with methodology footnote + "data as of" date + self-cert caveat.
- `.gov`/`.mil`-gated buyer surface; manual provision for the two officials.

### Out of scope (deferred)
Everything in §2 Non-Goals, plus the 4 non-KO roles (§7), buyer saved-searches/alerts, multi-agency accounts.

---

## 9. Landing Page & Funnel

### Surface
A dedicated buyer landing page — proposed path `getmindy.ai/agency` (or `/gov`) — distinct from the seller `/market-intelligence` upgrade page. Reuses the existing landing-page component pattern (`src/app/market-intelligence/page.tsx`): client component, magic-link entry, `persistAccessEmail`.

### Positioning (copy direction — not final)
- **Headline:** "Market research for federal buyers — who can actually do the work."
- **Subhead:** "Search registered small businesses by NAICS, location, and set-aside. See who's actually won the work. Justify your set-aside with one defensible number."
- **The SBS contrast (the hook):** "SBS shows you who's registered. Mindy shows you who performs — registry + 63M award records + capability statements + the people to talk to."
- **Three value blocks:** (1) Performance-weighted market depth (Rule of Two), (2) Award history + incumbency per firm, (3) Exportable determination memo.
- **Trust band:** ".gov / .mil verified access · data sourced from SAM.gov + USASpending · methodology transparent."

### Access flow
1. CO lands on `/agency` → enters `.gov`/`.mil` email.
2. Domain check → magic-link / 2FA (`createMIAuthSessionToken`).
3. On verify, `user_type='gov_buyer'` provisioned (manual for pilot; self-serve later).
4. Redirect to the buyer market-research surface.
5. Sellers who hit `/agency` with a non-gov email → friendly redirect to the seller `/market-intelligence` page.

### Pilot pricing
Undecided — likely **free for the two pilot officials** (learn first). Government procurement of a SaaS tool is its own process; do not gate the pilot behind a Stripe link. Pricing model (per-seat, agency license, GSA Schedule path) is a post-pilot decision.

---

## 10. Build Sequence

1. **Stand up `sam_entities`** from SAM.gov bulk Entity Extract + daily refresh cron. *(Blocker — everything depends on it.)* Include `certifications TEXT[]` + GIN, `registration_status`, `registration_expiry`.
2. **`/api/gov-buyer/market-research`** — count + list + rubric + BQ award/revenue join.
3. **Auth:** `user_type` on `user_profiles`; `.gov`/`.mil` gate; manual-provision the two officials.
4. **Buyer UI + `.docx` memo export.**
5. **Gov contacts:** run `populate-contracting-officers.js`; repoint `/api/app/relationships` off dead OpenGov BQ; add `role_category` column.
6. **Cap statements (Path A):** add `uei`/`cage` to `user_boilerplate_docs`; link seller uploads.
7. **Landing page** `/agency` + access flow.

---

## 11. Risks & Honest Caveats

- **SAM bulk-extract ingest is the long pole.** Sizable dataset, new pipeline — budget real time. Everything else is glue.
- **"Active registration" ≠ "qualified."** Filter on `registration_status='Active'` + non-expired; surface the as-of date prominently. The rubric mitigates this by tiering on performance.
- **Self-certified set-asides.** SAM flags are self-certified except 8(a)/HUBZone/SDVOSB (verified). The memo must footnote which certs are authoritative; the rubric weights verified certs higher.
- **Gov people = SAM contacts, not all of OPM.** Step-1 coverage is solicitation-named contracting people. The 5-role expansion needs a future source; the `role_category` column keeps that door open without committing to it now.
- **Cap-statement coverage is partial by design** (sellers only). Never imply full coverage.

---

## 12. Decisions Log

| Date | Decision | By |
|---|---|---|
| 2026-06-04 | OpenGov IQ dead — re-source entities from SAM.gov bulk Entity Extract | Eric |
| 2026-06-04 | Separate gov signup + `.gov`/`.mil` gate for buyers | Eric |
| 2026-06-04 | Cap statements Path A (seller-linked) | Eric |
| 2026-06-04 | Tightest pilot scope for the two officials | Eric |
| 2026-06-04 | Rubric = tiered lens, not filter; never hide new entrants; Emerging included in count by default | Eric |
| 2026-06-04 | Gov people: ship contracting layer now, structure for 5 roles via `role_category`, expand later — no creep | Eric |
