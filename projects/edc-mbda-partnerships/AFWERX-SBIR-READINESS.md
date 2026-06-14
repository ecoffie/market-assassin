# AFWERX SBIR — Readiness Priorities

**Goal:** Get to a submittable, winnable AFWERX Open Topic Phase I.
**Owner:** Eric → FT Head of Partnerships & Funding (+ product for CTA work)
**Status:** Plan — June 14, 2026
**Companions:** `FUNDING-STRATEGY.md` (why AFWERX), `AFWERX-ENDUSER-OUTREACH.md` (the emails)

---

## The governing principle (don't skip this)

**AFWERX Phase I is won by a GOVERNMENT END-USER NEED, not a tech demo.** The Customer
Memorandum (proof a DAF office wants this) is the deliverable — and it's only formally required at
**Phase II**. So the priority is **relationship first, product second** — and CTA work is scoped to
**only what the end-user actually touches**, not gold-plating all 14.

This is why we do NOT lead with "harden all 14 CTAs." That's months of OSBP-validation work that
doesn't move the Phase I needle. We make the **1–2 CTAs the end-user cares about** bulletproof, and
defer the rest.

---

## TIER 1 — wins Phase I (do these first)

### 1.1 Convert a warm government end-user  ← **80% of the win — and we may already have it**
**We already have 3 warm contacts with stated needs** (see `AFWERX-ENDUSER-OUTREACH.md` → Live
prospects): **Army MICC KO** (acquisition market research), **DISA** (expiring-contracts research),
**Navy OSBP** (SMB market research). Finding an engaged end-user is normally the whole battle —
we're past it. So Tier 1.1 is **convert**, not discover:
- **Capture each contact's name/email/exact need** → 20-min discovery call each (Email 2/3).
- **Per contact, pick the SBIR route:** AFWERX (needs a DAF use case + DAF TPOC — these are
  Army/Navy/Joint, so AFWERX requires a DAF angle) **vs.** the contact's **own component SBIR**
  (Army SBIR / Navy SBIR / DISA topics) where they're the direct customer. The own-component route
  may be cleaner for MICC/DISA/Navy than forcing an AFWERX-DAF frame.
- **NAPEX (Aug 16–20)** is now a *backup* discovery room + a place to find a DAF TPOC if we go AFWERX.
- Output: a named end-user + the right SBIR vehicle. **This still gates everything else.**

### 1.2 Harden the CAPABILITY the winning end-user actually needs  ← **scoped to their need, not all of CTA**
Each contact needs a *different* Mindy capability — harden whichever one advances first. **Don't
assume it's CTA tagging.** Map:
- **DISA → expiring-contracts / recompete.** This is the **award-detail + incumbent engine**
  (`src/lib/usaspending/award-detail.ts`, `find-predecessor.ts`) — **already our strongest, most-built
  feature.** Demo-survival here = make sure recompete results are accurate + complete for DISA-relevant
  agencies. Likely the *easiest* of the three to make bulletproof.
- **MICC KO → acquisition market research.** Contractor search + (if their requirement is CTA-adjacent)
  CTA tagging. If CTA matters: validate the NAICS anchors for *their* CTA against real DoD award
  history (USASpending, 317K dataset), expand its keywords ~5→30+ (bare "AI"/"drone"/"UAS" missing
  today), spot-check 10 real solicitations they'd recognize.
- **Navy OSBP → SMB market research.** Contractor DB by set-aside + NAICS — verify socioeconomic
  filters return clean, complete results.
- **Spot-check is the demo-survival test for all three:** pull 10 real cases the end-user would
  recognize → confirm Mindy nails them → fix misses before any live demo.

### 1.3 Write the Phase I narrative around the DIB-visibility mission
- Frame: *"give a DAF office visibility into small-business participation across [CTA], and
  strengthen the industrial base by surfacing qualified small/minority firms to team."*
- Ground in real Mindy facts: 317K contractors, CTA-tagged feed, UEI win attribution.
- A government end-user story — NOT a vendor-tool pitch.

---

## TIER 2 — makes the proposal/demo solid (not a Phase I blocker)

### 2.1 One source of truth for CTA tags
- **Kill the in-memory vs. DB inconsistency** the audit flagged (same opp can show different tags on
  refresh). Finish the DB backfill, then have the feed read DB tags only.
- Files: `src/lib/cta/tagger.ts`, `src/app/api/cron/tag-cta/route.ts`, the in-memory path in
  `/api/app/opportunities`.

### 2.2 Finish the backfill to 100%
- Audit found ~30% coverage / backfill still in-flight (June 13). Resume the cron, monitor, drain to
  100% so the feed isn't sparse/inconsistent. Admin: `/api/admin/cta-tagging`.

### 2.3 Surface "why matched" on demand
- Confidence (high/med/low) + match reason (NAICS vs keyword) is already tracked — expose it in the
  UI for the demo so an expert can see the logic, not a black box. Low lift, high trust.

---

## TIER 3 — defer (real, but not for this Phase I)

- OSBP-validate **all 14** CTAs (only matters once we're selling the full CTA product / Phase II)
- Manual tag override / dispute mechanism
- Org-level CTA reporting + funder export (that's the Phase II *build*, which the SBIR funds — don't
  pre-build it)
- ML classifier for tagging (rules-based is fine for Phase I; revisit at scale)

---

## What changed from the raw CTA audit

The audit (honest, correct) said the CTA tagging is "fragile and incomplete for a credible DoD
pitch" across all 14. **True — but for Phase I we don't need all 14.** We need:
- a real end-user need (Tier 1.1),
- their 1–2 CTAs accurate enough to not visibly miss (Tier 1.2),
- a clean, consistent feed (Tier 2.1–2.2).

The rest of the audit's red flags (full-14 NAICS validation, dispute mechanism, ML classifier) are
**Tier 3** — correct to fix eventually, wrong to block Phase I on.

---

## Sequence

1. **Now:** send connector emails (1.1); resume CTA backfill (2.2 — it's just running the cron).
2. **As end-user(s) surface:** harden their specific CTA(s) (1.2); fix tag consistency (2.1).
3. **At NAPEX (Aug):** lock the end-user relationship; spot-check their CTA live.
4. **Next AFWERX Open Topic window** (confirm on DSIP): submit Phase I citing the end-user.
5. **Phase I award → use the SBIR to build** the org-level CTA reporting (Tier 3) — that's what the
   money is for.

## Open items
- [ ] **Capture name/email/exact need for the 3 warm contacts** (Army MICC KO, DISA, Navy OSBP)
- [ ] 20-min discovery call each → confirm the need + which is most ready to be a Phase I end-user
- [ ] **Per contact, decide SBIR vehicle:** AFWERX (DAF angle + DAF TPOC) vs. their own component
      SBIR (Army / Navy / DISA) — pick the cleaner path
- [ ] Harden the capability the lead contact needs (DISA→recompete engine / MICC→market research /
      Navy→SMB DB) — spot-check 10 real cases
- [ ] Resume + complete CTA backfill (~30%) — only critical if a CTA-search contact leads
- [ ] Confirm next AFWERX Open Topic window on DSIP (+ Army/Navy SBIR cycles if going component route)
- [ ] Fix in-memory/DB tag inconsistency before any live demo

---

*Created June 14, 2026. Priority locked: END-USER FIRST, CTA SECOND. UPDATE: we already have 3 warm
govt contacts with stated needs (Army MICC KO, DISA expiring-contracts, Navy OSBP SMB research) —
the hard part may be in hand. Tier 1.1 is now CONVERT, not discover; per contact, choose AFWERX
(DAF angle) vs. their own component SBIR. Harden the capability the lead contact needs (DISA's
recompete engine is already our strongest) — not necessarily CTA. Full-14 CTA validation stays Phase II.*
