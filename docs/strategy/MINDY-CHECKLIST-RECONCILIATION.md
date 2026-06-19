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

## 🔧 OPEN PRODUCT FIXES — the actual remaining work (ranked)

### High (user-facing, demo-relevant)
1. **Proposal Assist output clutter** — "Available outputs / Export LOI template / LOI
   response sections" is confusing (Eric: "over 50, ChatGPT-simple, 1-1-1 principle").
   Simplify to one clear "open/review your draft" + one export. Also: **the LOI drafted
   but had no button to open/review it** (6/13). → SIMPLIFY + add the review button.
2. **"How do we get 100%?" (91% coverage)** — banner needs a one-line explainer of why
   90% coverage is the smart target (not a gap). Small copy/UX fix.
3. **Opportunities tab top stats not clickable** — Urgent/Opps/Teaming/Briefings/Total
   should filter/sort/scroll to what they name. Currently dead.
4. **Today's Intel SHARE button** — lost in beta→new; needed for virality. Re-add.
5. **Contractors DB: defaults to user NAICS → "No contractors found"** + search UI
   alignment/design. Also: **preview card needs city/state** (can't tell which "Excel"),
   and a **state search filter**.
6. **Decision Makers: more detail** — phone/location/title + sort by office/sub-agency
   for big parents (DoD/HHS). (Roles need commercial enrichment — see 🗂️.)
7. **Documents still not loading** (6/11, recurring) — Proposal Assist / opportunity
   attachments. VERIFY current state; was partially fixed (notice_body synth).
8. **Sidebar collapse: hover tooltips lost** — only the Mindy icon shows a label;
   restore names on all collapsed icons. Also the **collapse-vs-sidebar-names mutual
   exclusion bug** (adding one loses the other).
9. **Grants: only 25 results, no "see all" / can't clear ranked profile to browse** —
   add total count + browse-all + real search. **Add a Grants section to alert emails.**
10. **Expiring Contracts: no zip/region match** shown vs the user's service area.

### Medium
11. **Relationships tab logic** — should flow FROM My Target List (develop relationships
    BEFORE a pursuit, not attach-after). Rework the model. **Move Team Access out of
    Pipeline → Settings/Account.**
12. **Weekly deep-dive email → Mindy-branded** (still old styling).
13. **Pursuit briefs: cut or repurpose** — inconsistent, low value. Eric: replace with
    weekly grants + old-SOW intel on tracked pursuits/target agencies. → DECISION + build.
14. **Loom onboarding videos** — 3 walkthroughs (profile / find customers / first bid).
    Shot-list written; Eric records → drop into empty vimeoUrl slots. (Last piece of the
    Getting-Started tour.)
15. **Product tour visibility** — exists (ProductTour.tsx) but buried under settings;
    make it prominent / required-on-first-login for free users.
16. **Mindy Chat: gate to Pro + scrub PII** — proprietary KB; clean Toolcorp/Repita-type
    real names from KB docs. (Decision + cleanup.)
17. **Podcast-guest quotes in Today's Intel insight** — RAG the podcasts for actionable
    quotes, surface NAICS-matched. (Partially built: podcast_insights; confirm scope.)

### Lower / V2
18. **Proposal "Sport Mode"** — manual drive: upload files + chat-style extraction
    (Perplexity-like). Eric flagged as v2.0, not v1.
19. **Proposal training/fine-tune on user's own wins** — ingestion criteria + extract
    SOW/PWS to separate doc + section-tagged compliance matrix. (Bigger build.)
20. **Light/dark mode** — PRD written (docs/PRD-light-mode.md), themeable-token refactor.
21. **Email-in (TripIt-style plans@)** — PRD written, deferred.
22. **Knowledge-base repository page** (reuse/expand Vault) — PRD written.
23. **SAM verify-in-Proposal** — "go to SAM.gov and verify all info" confidence step.
24. **Vault/Settings UI reorg** — team-members under Settings not Vault; profile/NAICS
    placement; My Library redesign.

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

*Next: work the 🔧 OPEN list top-down. Items 1-10 are the user-facing/demo-relevant ones.
Several "❓ verify" may already be done — check the UI first to avoid rebuilding.*
