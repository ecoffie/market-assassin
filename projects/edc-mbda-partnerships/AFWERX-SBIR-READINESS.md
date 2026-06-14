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

### 1.1 Secure a DAF end-user  ← **80% of the win, and it's not code**
- Send Email 1 (connectors: OSBP / APEX directors we already know) — `AFWERX-ENDUSER-OUTREACH.md`
- Use **NAPEX (Aug 16–20)** as the end-user discovery room — every connector is there
- Target: **1–2 candidate end-users** who confirm a real need ("we can't see small-biz
  participation in [their CTA]")
- Output: a named end-user relationship to cite as the Phase I transition path
- **This gates everything else. Start now.**

### 1.2 Make the end-user's 1–2 CTAs survive scrutiny  ← **the only CTA work that matters for Phase I**
Once we know which CTA(s) the end-user cares about (likely AI/autonomy, cyber, microelectronics,
or space — the DAF-heavy ones), harden **just those**:
- **Validate the NAICS anchors** for those CTAs against real DoD award history (USASpending — we
  already have the 317K dataset; pull what NAICS actually won in that CTA's programs)
- **Expand keywords** for those CTAs from ~5 → 30+ (synonyms + abbreviations: "AI", "ML", "drone",
  "UAS", etc. — the audit found bare "AI" is missing today)
- **Spot-check:** pull 10 real solicitations the end-user would recognize as their CTA → confirm
  Mindy tags them. Fix misses. This is the demo-survival test.

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
- [ ] Send Email 1 to known OSBP/APEX connectors
- [ ] Resume + complete CTA backfill (currently ~30%)
- [ ] Confirm next AFWERX Open Topic submission window on DSIP
- [ ] Once end-user known: USASpending-validate their CTA's NAICS + expand its keywords
- [ ] Spot-check 10 real solicitations in the end-user's CTA → fix misses
- [ ] Fix in-memory/DB tag inconsistency before any live demo

---

*Created June 14, 2026. Priority locked: END-USER FIRST, CTA SECOND. We harden only the CTA(s) the
end-user touches for Phase I; full-14 validation is deferred to Phase II (which the SBIR funds).*
