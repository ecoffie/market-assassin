# PRD: Contacts IA Consolidation — eliminate the Relationships tab

> Eric's hypothesis (2026-06-07): Relationships, Decision Makers, Gov Buyers,
> OSBP, and Find Partners overlap heavily. Fold contacts under My Target List
> (per-agency cards with call/email/notes inline). Apply Cal AI simplicity +
> the 1-1-1 principle. Researched BEFORE building.

**Status:** Research complete + recommendation — 2026-06-07. Awaiting Eric's go.

---

## 0. THE RESEARCH (hard evidence, not opinion)

Mapped the actual data source behind every contact surface:

| Surface | Sub-tab | Data source | Verdict |
|---|---|---|---|
| **Decision Makers** | — | `federal_contacts` (123,255 rows, 41,238 w/ email) | The RICH one |
| **Relationships** | Gov Buyers | `sam_opportunities` POCs | **DUP of Decision Makers** |
| **Relationships** | OSBP Directory | `agency_osbp_directory` | Genuinely distinct |
| **Relationships** | Find Partners | `searchContractors` | **DUP of Contractors tab** |
| **Contractors** | — | `searchContractors` (BigQuery) | Canonical |

**Proof of the overlap:**
- `federal_contacts.source_table` = `AllSamContacts` (455 sample) +
  `sam_opportunities_pointOfContact` (29) + `sam_entities_pocs` (16). So
  **Decision Makers and "Gov Buyers" are literally the same SAM-POC humans** —
  Decision Makers just uses the bigger, deduped, role-tagged table (123K rows
  w/ `role_category`), while "Gov Buyers" re-queries raw `sam_opportunities`.
- "Find Partners" calls the **exact same `searchContractors`** as the Contractors
  tab.

**Conclusion:** Of the Relationships tab's 3 sub-tabs, **2 are duplicates** of
existing tabs (Decision Makers, Contractors). Only **OSBP** is unique — and OSBP
contacts are just another contact type that belongs WITH the others, not in its
own tab.

→ **The Relationships tab can be eliminated.** It fragments contacts the user
already has better access to elsewhere.

---

## 1. THE SIMPLIFICATION (Cal AI: one obvious action; 1-1-1)

Eric's desired flow: *under My Target List, each agency card shows the people I
need to target, with call/email + inline notes (outreach log exists), one window
— open contact → call/email → note → move on.*

**Proposed IA:**
- **My Target List = the hub.** Each target-agency card expands to show its
  **Decision Makers** (from `federal_contacts`, the rich table) inline — name,
  role (CO / POC / OSBP), email, phone.
- **Per-contact actions inline:** `mailto:` / `tel:` buttons + a note field that
  writes to the existing outreach log. No tab-hopping.
- **OSBP contacts** appear as a contact ROLE within the same agency card (tagged
  "Small Business Liaison"), not a separate directory.
- **Contractors stays its own tab** (it's a different job: find primes/partners
  to TEAM with, not gov people to target) — but "Find Partners" inside
  Relationships is deleted (it was a dup).
- **Delete the Relationships tab.**

**Why this is the 1-1-1 / Cal AI move:** one place (Target List), one object
(the agency you're going after), one action per contact (reach out + note). The
answer first (here are your people), detail on demand (full directory still
searchable via Decision Makers if needed).

---

## 2. What changes

| Tab | Before | After |
|---|---|---|
| My Target List | agencies only | agencies **+ their contacts inline** (call/email/notes) |
| Decision Makers | standalone directory | **stays** as the full searchable directory (power users) |
| Relationships | Gov Buyers / OSBP / Find Partners | **DELETED** (Gov Buyers→Decision Makers, OSBP→contact role, Find Partners→Contractors) |
| Contractors | standalone | **stays** (teaming, distinct job) |

Net: **5 contact surfaces → 3** (Target List w/ inline contacts, Decision Makers
directory, Contractors). The Relationships tab — the most confusing one — is gone.

---

## 3. Risks / things to preserve

- **Don't lose OSBP data** — fold it in as a contact role, keep the
  `agency_osbp_directory` source wired (just surfaced differently).
- **The outreach log + relationship stages** built in RelationshipsPanel v2 must
  MOVE to the Target List card, not be deleted.
- **Decision Makers' "⭐ My Targets" scope** already defaults to target agencies —
  that logic transfers directly to the Target List card.
- **Office names bug** (codes not names) must be fixed in `federal_contacts`
  rendering since it's now the primary contact source (separate task).

---

## 4. Phasing

- **v1:** Surface Decision Makers (federal_contacts) inline under each Target
  List agency card + call/email/note actions. Delete the Relationships tab. Fold
  OSBP in as a role. Keep Decision Makers + Contractors as-is.
- **v2:** relationship stages on the cards; richer outreach history; auto-suggest
  the top 3 people to contact per agency.

---

## 5. Decision log
| Date | Decision |
|---|---|
| 2026-06-07 | Research proved Gov Buyers = Decision Makers (same SAM-POC source) and Find Partners = Contractors (same searchContractors). Only OSBP is distinct. → Eliminate the Relationships tab; fold contacts under Target List per agency with inline call/email/notes; OSBP becomes a contact role. 5 surfaces → 3. Awaiting Eric's go. |
