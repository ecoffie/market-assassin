# PRD: Relationships Driven by Target List (BD workflow fix)

> Relationships should flow FROM your Target List — target an agency, then build
> relationships AT that agency — not be a disconnected search you re-enter. And
> a relationship attaches to a TARGET AGENCY (the long game), not a pursuit
> (by the time you're pursuing, it's too late to build the relationship).

**Status:** **v1 + v2 SHIPPED 2026-06-05.** v1: Target List drives Decision
Makers (⭐ My Targets) + Relationships (🤝 entry + attach-to-AGENCY). v2: My
Network grouped by agency + relationship stages (prospect→warm→contacted→met→
champion). ⚠️ v2 needs migration `20260605_relationships_v2.sql` hand-run in
Supabase + `NOTIFY pgrst` (API degrades gracefully until then). Remaining v2:
smarter per-agency partner suggestions; outreach-tracking tie-in.
**Trigger:** Eric: "Relationships is a separate disconnected item. From My Target
List I should click an agency and see ITS buyers / OSBP / partners. 'Attach to a
pursuit' is backwards — you develop relationships BEFORE a pursuit, not after.
Target List should DRIVE relationships, not the opposite."

---

## 1. The problem (the logic is inverted today)

Today:
- **My Target List** (under Pipeline) = the agencies you chose. Good.
- **Relationships** = a SEPARATE tab with Gov Buyers / OSBP Directory / Find
  Partners — a generic search you re-enter each time, **not connected** to your
  target agencies.
- Saving a contact **attaches it to a PURSUIT** ("Save & attach to: Delta Range
  Grenade Pits…").

Two things are wrong:
1. **Disconnected silos.** Relationships don't start from the agencies you're
   actually targeting. You re-type the agency you already chose in Target List.
2. **Backwards attach.** Relationships are developed BEFORE a pursuit — by the
   time you're pursuing an opportunity, it's too late to build the buyer
   relationship. Attaching to a *pursuit* is the wrong frame.

**Correct mental model (Eric):** Target an agency → develop relationships
(buyers, OSBP, partners) at that agency → *then* pursuits flow from that
groundwork. Target List is the root; relationships hang off it.

---

## 2. The fix

### A. Target List drives relationships
- **My Target List** becomes the entry point. Each target-agency row gets a
  "Relationships at this agency →" action.
- Clicking it opens the relationships view **scoped to THAT agency** — its Gov
  Buyers, OSBP contacts, Find-Partners — pre-filtered, no re-typing.
- The standalone **Relationships** tab still exists for browsing your whole
  network, but the PRIMARY path starts from your targets.

### B. Attach to a target AGENCY, not a pursuit
- Saving a buyer/partner links them to a **target agency** in your list (the
  long-game BD relationship), not a specific opportunity.
- Replace the "Save & attach to: <pursuit>" dropdown with "Save to <agency> in
  My Network" (the agency is implied by where you drilled in from).
- Keep pursuit-attach only as an OPTIONAL secondary (late-stage teaming), never
  the default.

### C. My Network grouped by agency
- The relationships you save show grouped/filterable **by target agency** — so
  "who do I know at Army? at VA?" is one glance, matching how BD actually works.

---

## 3. What exists (reuse)

- **Target List:** `MyTargetListPanel` + `user_target_list` (agency rows the
  user chose, with agency_name/sub_agency/office).
- **Relationships:** `ContactsPanel` / the Relationships panel + the data behind
  Gov Buyers (`federal_contacts`), OSBP, Find Partners.
- **Saved contacts:** `user_teaming_partners` (or the network table) — needs a
  `target_agency` link instead of (or alongside) `pursuit_id`.
- So this is mostly **rewiring the entry point + the attach target**, plus a
  per-agency drill-down — not new data sources.

---

## 4. Scope / phasing

- **v1:** Target List row → "Relationships at this agency" → scoped relationships
  view (buyers/OSBP/partners pre-filtered to that agency). Saving attaches to the
  AGENCY. My Network filterable by agency.
- **v2:** smarter partner suggestions per agency; relationship "stage" (warm/
  contacted/met); tie-in to outreach tracking.
- **Out:** changing the underlying data sources; the pursuit-attach stays as an
  optional secondary, not removed.

---

## 5. Risks

- **Existing saved contacts** may be pursuit-attached. Migration: backfill a
  target_agency from the contact's agency where possible; don't lose data.
- **Don't orphan the standalone Relationships tab** — keep it for "browse all,"
  just make Target List the primary entry.
- **Agency-name matching** between Target List and the contact sources (use the
  same normalizeAgencyKey approach we built for the SAT/office work).

---

## 6. Success criteria

- From My Target List, one click → the relationships (buyers/OSBP/partners) at
  that exact agency, no re-typing.
- Saving a relationship attaches it to the target AGENCY; My Network shows "who I
  know at each target agency."
- Pursuit-attach is optional, not the default — the workflow is develop-before-
  pursue.

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Target List DRIVES Relationships (click agency → its buyers/OSBP/partners); save attaches to the AGENCY not a pursuit (relationships are pre-pursuit); My Network grouped by agency. Keep standalone Relationships tab for browse-all. | Eric |
| 2026-06-05 | Team Access moved Pipeline → Account (shipped same day — separate small fix). | Eric |
