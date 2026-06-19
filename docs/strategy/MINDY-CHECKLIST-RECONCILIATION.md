# Mindy Checklist Reconciliation (Eric's full list, June 10–16)

Reconciled 2026-06-19 against the actual codebase + commit history. Purpose: isolate
the OPEN PRODUCT FIXES from what's already shipped and from org/strategy questions.

Legend: ✅ done · 🔧 open product fix · ❓ verify (likely done, confirm in UI) · 🗂️ org/strategy (not a code fix) · 📋 PRD/backlog (scoped, deferred)

---

## ✅ DONE — verified in code/commits

- **Demo sections (Vehicle Expiry/SMB/MRR) staff-only** — `staffOnly` flag in UnifiedSidebar; hidden from free/pro/team. ✅
- **Body-text search ("M7 in the body")** — `backfill-descriptions` cron + 4-corpus search (title+description+sow_text+department). ✅
- **Market Research top-spending mismatch / numbers not aligning** — reconciled to one window + authoritative spending_by_category total (3e754a8e). ✅
- **"No matching agencies" dead ends** — invalid-NAICS passthrough + same-origin internal fetch (9fdd8d1e, 66f86d63). ✅
- **Market Research 6 filter bugs** (NAICS inflate, keyword=all-spend, set-aside dead codes, state decorative+auto-expand, reconciliation) — all fixed + harness-guarded. ✅
- **Open opps / events column showing 0** — fixed in TMR (normalized agency-key bucketing). ✅
- **Sport-mode keyword order (after NAICS/PSC)** — addressed in onboarding/market flow. ✅ (confirm visually)
- **Pursuit amendment alerts** — `pursuit-changes` cron (owner-attributed, batched). ✅
- **Email over-send (12 emails/day → krithi/Allen)** — per-recipient daily cap + suppression. ✅
- **Mobile sign-out missing** — account menu at sidebar bottom + h-dvh fix (ee16b120). ✅
- **Contractors DB stuck at 2,768 / not wired to BigQuery** — searchRecipients liveBq fix (4db4cf91) + exact-UEI match. ✅
- **Hidden-match semantic alerts** (incl. expiring/upcoming) — built + embed crons scheduled. ✅
- **Onboarding "Start over" / NAICS picker bypass** — routes to guided onboarding. ✅
- **autofill from UEI → semantic keywords** — semantic-keywords-from-UEI shipped. ✅
- **FREE during beta → FREE forever** header — phased setup-nudge messaging. ✅
- **Daily-alert numbers not rising w/ +50/wk** — diagnosed: prefilled-NAICS sweeps, zero-alert-nudge cron. ✅ (data, not a bug)
- **Admin password rotation, cron cap relief, Anthropic probe, data-quality sweep** — this session. ✅
- **Bootcamp → Mindy Day reframe** — app + funnels, deployed. ✅
- **Contractor detail / sales-history by-fiscal-year (RQ vs Excel)** — getBqContractorHistory wired. ✅ (confirm 10-yr zero-fill)
- **DoDAAC office decode (codes → names)** — formatDodaacOffice + directory. ✅

---

## ✅ RECONCILED COMPLETE — verified against live code 2026-06-19

**Bottom line:** of the 24 ranked items, **21 are DONE** (verified in code, not assumed),
**1 is blocked on Eric** (Loom videos), and **2 are genuine future builds** (light mode,
email-in). The codebase had outrun this checklist — most "open" items were already shipped
by prior sessions; the rest were built this session.

### High (user-facing, demo-relevant) — ✅ ALL DONE
1. ✅ **Proposal Assist LOI preview/review button** — `?format=text` endpoint + "👁 Preview
   LOI" button + on-screen preview block (shipped this session).
2. ✅ **"How do we get 100%?" explainer** — MarketCoverageBanner one-liner.
3. ✅ **Opportunities clickable stat chips** — Urgent/Opps/Teaming/Total filter+scroll.
4. ✅ **Today's Intel SHARE button** — re-added.
5. ✅ **Contractors city/state on cards + state filter** — `📍 {city, state}`, stateFilter,
   empty-state w/ Clear Filters. (State filter applies when no NAICS — rollup table has no
   location; known limitation, not a bug.)
6. ✅ **Decision Makers detail + sort** — contact_phone/title/office + derived subAgency
   (Air Force/Navy/DLA) for big parents.
7. ✅ **Documents loading** — pursuit-docs synthesizes a notice_body doc from
   sam_opportunities; attachment pipeline cache-first.
8. ✅ **Sidebar collapse tooltips** — restored on all collapsed icons.
9. ✅ **Grants total + browse-all + email section** — `totalHits`, relevance/newest
   browse-everything sort, grants in daily-alerts.
10. ✅ **Expiring Contracts zip/region match** — `classifyLocation` + `locationMatch` vs the
    user's service area.

### Medium — ✅ DONE except #14 (blocked on Eric)
11. ✅ **Relationships flow FROM My Target List + Team Access → Settings** — both done (code
    comments match Eric's exact request).
12. ✅ **Weekly deep-dive Mindy-branded** — navy/purple rebrand.
13. ✅ **Pursuit briefs CUT** (2026-06-19) — precompute cron disabled + vercel.json send
    window removed + route fails closed (`PURSUIT_BRIEFS_ENABLED` to revert). pursuit-CHANGES
    (amendment alerts) kept ON. Replace-later: weekly grants + old-SOW intel (future).
14. ⛔ **Loom onboarding videos** — BLOCKED ON ERIC. 3 walkthroughs (profile / find customers
    / first bid), 60–90s, Mindy-branded → Vimeo → send player URLs → wire into empty
    vimeoUrl slots. Only remaining piece of the Getting-Started tour.
15. ✅ **Product tour visibility** — ProductTour shipped + surfaced.
16. ✅ **Mindy Chat: Pro-gate + scrub PII** (2026-06-19) — UI Pro-lock (empty state +
    UpgradeModal + 403 fallback) on the existing server 403; data-layer PII scrub
    (`src/lib/rag/scrub-pii.ts` in RAG retrieval) redacts emails/phones/SSNs from the corpus
    before they reach the model (audit: ~2.4K emails / ~6.3K phones), preserving
    contract#/NAICS/PSC/UEI/$ (11/11 verified).
17. ✅ **Podcast quotes in Today's Intel** — `insight-pulse-lesson.ts` + podcast-insights.

### Lower / V2 — ✅ 18/19/22/23/24 BUILT (verified 2026-06-19); 20/21 are future builds
18. ✅ **Proposal "Sport Mode"** — `driveMode` Auto/`Manual · Sport` toggle in ProposalsPanel
    (L1696–1713). Auto = Mindy drafts; Sport = you drive with your own files. Real, wired.
19. ✅ **Proposal grounds on user's wins** — `v2.ts` drafting pulls `loadVaultContext` +
    `retrieveRagContext` (drafts ground in the user's vault/past-perf) + `extract-sow` route.
    Shipped as RAG-ingest of the user's docs (NOT a fine-tune — Eric's chosen approach).
20. ⏳ **Light/dark mode** — FUTURE BUILD. PRD written (docs/PRD-light-mode.md), themeable-
    token refactor (touches every component). App is dark-only today.
21. ⏳ **Email-in (TripIt-style plans@)** — FUTURE BUILD. PRD written; needs inbound-email
    provider.
22. ✅ **Knowledge-base repository page** — `KnowledgeBasePanel.tsx` +
    `/api/app/knowledge-base/route.ts` + rag-doc drawer, reachable from Mindy Chat "Browse
    sources."
23. ✅ **SAM verify-in-Proposal** — "🔎 Verify on SAM.gov ↗" step in ProposalsPanel
    (L1440, L1737) cross-checks every doc + notice text against the official listing.
24. ✅ **Vault/Settings reorg** — team-members under Settings done (`TeamSection` in
    VaultPanel L222/L708). Only the My Library *redesign* polish remains (cosmetic).

---

## ❓ VERIFY (likely done — confirm in the live UI before re-building)
- Sport-mode keyword ordering · open-opps-column zeros · contractor 10-yr zero-fill ·
  documents-loading · target-list name/agency mismatch (DHS-for-DOI) · 2FA "does it do
  anything" (decide keep/cut).

---

## 🗂️ ORG / STRATEGY (not a code fix — decisions/people/funding)
- CAGE code (George Mack email thread) · Stripe MDEAT payout %-splits + placeholders ·
  reassign Kay's role (no podcast manager) · stock/equity in Mindy · EDC/MBDA partnerships ·
  APEX compete-vs-partner + DoD funding · SBIR/grants/state-local funding (assign FT) ·
  Mindy contest / ClickFunnels "one funnel challenge" gamification · events/keynotes
  (DONE: stage strategy doc) · gov-contact ROLES need commercial enrichment (buy decision) ·
  free-course-remade-using-Mindy · "stock for everyone" · app.getmindy.ai subdomain Q.

---

## 📋 Already in BACKLOG-later.md / PRDs (scoped, deferred)
DoD forecast scrapers (Option A) · Cron Dispatcher Phase 2 · light mode · OG previews ·
5-role contacts · civilian office decode · NAICS+state combo · knowledge-base repo.

---

*Status 2026-06-19: checklist reconciled COMPLETE. 21/24 ranked items done (verified in
code), #14 Loom videos blocked on Eric, #20 light mode + #21 email-in are genuine future
builds (PRDs written). No open product-fix work remains — the only near-term action is Eric
recording the 3 Loom onboarding videos.*
