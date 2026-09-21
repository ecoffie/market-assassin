# Opportunity Map — Open Items (handoff, night of 2026-07-26)

The Zillow-style `/opportunity-map` rebuild. Everything below is **scoped/decided but NOT yet
built** — pick up here in the morning. All live on getmindy.ai unless noted.

---

## 🔨 THE BIG ONE — grounded $ pricing range on the card (decided, ready to build)

Eric wants a **real dollar estimate/range** on the opportunity card (the "price" hook, replacing
the weak fields). **Decided approach** (all grounded in real data — no LLM guess):

1. **Predecessor contract value** (strongest) — already computed in `opp-intel` via
   `findPredecessorAward` (`ceiling / currentValue / obligated`). When a predecessor exists →
   *"Est. value $18M–22M — based on the prior contract (2019–2024)."* Found on **9%** of opps.
2. **Comparable-award median/IQR** (broadest) — query USASpending for recent awards matching the
   opp's **NAICS + agency + PSC**, take **median + 25th–75th percentile** → *"Comparable [NAICS]
   awards at [agency]: $2.1M–4.8M (median $3.2M), last 3 FY."* **← the main new build.**
3. GSA CALC labor rates — stays a **rate** signal only (can't total without hours/FTEs SAM lacks).
4. Else → **show nothing** (no fabricated number).

**Build plan:** precompute + store the comparable-award range alongside the existing intel_* columns
(same store-then-read pattern), reuse `buildOppIntel`/the backfill+cron. **Backfill is confirmed
100% drained** (11,254/11,254 active opps computed, cron running, incumbent 9% / pricing 26%) — so
the infra it sits on is solid. Then surface the range as the card's hook fact; **M-Win stays in the
full drawer** (not the preview card), rendered `M-Win 72` never `72%`.

**Open sub-decisions when building:**
- On the popup, when NO range exists → what fills the hook slot? (leaning: keep it to the current
  4 facts, or collapse gracefully).

---

## 📋 Datasets — the 4-dataset model (decided, mostly UNBUILT)

Memory: `opportunity_map_dataset_model`. Dropdown = **Active · Awarded · Contacts · Grants**.
- **Active** (flagship) = SAM + (planned) national labs + consortiums + SBIR + future GSA, **blended
  with a source badge** per pin/card (SAM.gov / NIH / SBIR). **Only SAM wired today.**
- **Awarded** = past contracts (recompete-map) — wired.
- **Contacts** = Gov Buyers + Contractors, as ONE dataset with a **filter toggle** inside it (NOT
  two dropdown items). Currently a "coming next" **stub** — needs the real Contacts map mode built.
- **Grants** = grants.gov, its **own 4th dropdown item**, kept SEPARATE so it never dilutes Active.
  **Not yet a map mode.** Each needs its source's location data (lat/lng or state) verified before
  wiring pins.

---

## 🎨 Drawer / card polish (smaller, optional)

- **Prominent at-a-glance grey-box fact grid** (Zillow's beds/baths/sqft equivalent) as its own
  visual treatment in the snapshot — Set-aside · NAICS · PSC · Due · Est. value as big grey boxes.
  Discussed, not built (snapshot still uses the plain grid).
- **"More" menu on the drawer action bar** — currently just opens the notice on SAM; could be a real
  popover (Save to list / Report / Copy link).
- **Roster / incumbent / pricing drawer sections are conditional** — appear only when data exists +
  (roster) signed-in. Working as intended, just noting they're often absent on thin opps.

---

## ✅ Done this session (for context — do NOT redo)

Map: state-default view (not world) · 2-up→single-column cards · dataset dropdown
(Active/Awarded/Contacts) · dot-click opens a STABLE popup (no flash) · narrower sidebar ·
Set-aside multi-select + NAICS pill · clean right header + custom Zillow sort menu · **overflow
root-cause killed + guard test** · **cards-not-opening $'-in-replace bug fixed** (repl() helper) ·
full drawer redesign (action bar · sticky tabs · unified sections · charts · SOW reflow) ·
**intentional section order + agency roster** · popup **1-click heart (Favorites) + single "Should
I bid?" CTA** · **/favorites page + rail = Search·Updates·Favorites** (dropped Pursuits/Plan) ·
nav "Past Awarded"→"Past" + Bid-with-confidence into left nav · **intel backfill 100% + cron**.

## Other tracked (not map)
- `mi_beta_auth_token` rename (16 files) — deferred auth refactor (`tasks/mi-beta-email-cleanup.md`).
- `/bid` page: gradient placeholders for the split-panel photos; resource-card links are stubs
  (wire real GovCon Giants guide URLs when available).
