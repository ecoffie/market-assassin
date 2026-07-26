# Section feature-parity checklist — every dataset gets EVERYTHING the Active/Open section has

**GOS #9 (COMPOUND) made concrete.** The Active/Open dataset is the GOLD MASTER — it accumulated
every feature we built and like. Every other dataset (Awarded · Companies · Gov Buyers) must have
**all of the same features, replicated from Open**, not a stripped-down version. A section missing
any of these is INCOMPLETE. (Eric, Jul 26: "make sure all sections have all the features we learned
from active — saved, search, detail card layout." + "compound not go backwards.")

## The gold-master feature set (from Open/Active) — every dataset must have ALL of it

| # | Feature | Open | Awarded | Companies | Gov Buyers |
|---|---|---|---|---|---|
| 1 | **Detail DRAWER** (`openXDrawer`) — rich profile on click | ✅ | ✅ | ❌ **gap** | ❌ **gap** |
| 2 | **Save** — heart on popup/card + Save button in drawer | ✅ | partial | ❌ **gap** | ❌ **gap** |
| 3 | **Search-bar dropdown** — history + saved searches | ✅ | ✅ | ✅ | ✅ (global) |
| 4 | **Value-tag pins** — the $ on the pin | ✅ M-Est | ✅ contract$ | ✅ $won | dot (no $ — ok) |
| 5 | **Detail-card / drawer LAYOUT** — same shell, section order, styles | ✅ (master) | ✅ (replicated) | ❌ **build** | ❌ **build** |
| 6 | **Popup card** on pin click — facts + primary CTA | ✅ | ✅ | popup exists | popup exists |
| 7 | **Favorites** — hearted items appear on `/opportunity-map/favorites` | ✅ | (opps only today) | should extend | should extend |
| 8 | **Feed list cards** — clickable, open the drawer | ✅ | ✅ | list ✅ / click ❌ | list ✅ / click ❌ |
| 9 | **"Should I bid?" / primary action** in popup + drawer | ✅ | ✅ (Should I bid) | needs its own CTA | needs its own CTA |

## How to build a section (the COMPOUND recipe — GOS #9)
1. **Replicate the OPEN section's drawer + card + save wiring VERBATIM** onto the new dataset. Copy the
   `openOppDrawer` shell, the drawer section order, the save heart (`toggleFav`) + drawer Save
   (`oppSave`/`__resetOppSave`), the popup card structure, the feed-card click→drawer wiring. Same
   layout, same styles, same order.
2. **Then modify ONLY for accuracy** (GOS #9b): swap the entity-specific CONTENT —
   - **Company drawer** = the opp-drawer shell, but content = contractor profile (awards won, top
     agencies, NAICS, location, set-asides, award history — reuse `getRecipientBySlug`/`/contractors/
     [slug]` data). Primary CTA: e.g. "View award history" / "Add to targets" instead of "Should I bid?".
   - **Gov Buyer drawer** = same shell, content = the buyer's office/role + the opportunities they run
     + how to reach them (roster). CTA: "See their opportunities" / "Add to CRM".
3. **Save + Favorites must work identically** — the heart saves a company/buyer the same way it saves
   an opp; they appear on the favorites page (extend favorites to handle non-opp entity types, or note
   the entity type on the saved row).
4. **Consistency is the default; divergence must be justified** (GOS #9c) — if a field/section from Open
   genuinely doesn't apply, that's the ONLY reason to drop it, and it's a conscious call.

## ⚠️ AUDIT FINDING (Jul 26): the drawer LAYOUT itself is not at parity
Measured: the **Open/opp drawer has 18 sections** (Bid facts · Buying organization · Know your buyer/
agency intel · Contract history-who-holds-this · Estimated value · Pricing intel · SOW facts · Scope
of work · Similar opps · Solicitation contacts · Other contacts-BD roster · Attachments · Description ·
AI Go/No-Go · …). The **Awarded/recompete drawer has only 1** (`Recompete facts` + a facts grid +
the new task-order stream + "Should I bid?"). So Awarded is a STRIPPED drawer — it did NOT replicate
the opp drawer's full section layout. This is the GOS-#9 violation to fix.

Sections from the gold master that DO apply to Awarded and are MISSING (add them):
- **Contract history · who holds this now** (incumbent — core to a recompete)
- **Know your buyer · agency intel** (agency priorities/pain points)
- **Pricing intel · what vendors charge here**
- **Other contacts at this agency · who to network with** (BD roster)
- **Solicitation contacts**
- (Task-order spend — added by #472 — keep it)
Consciously N/A for Awarded: Estimated value (it has real contract $), SOW facts / Interested vendors
(solicitation-specific) — justify each drop per GOS #9c.

## Current build order
1. **Company drawer** (next, after task-order merges) — replicate the OPP drawer's FULL 18-section shell
   → contractor-profile content (awards won, top agencies, award history, NAICS, location, set-asides).
   Same section layout + order, modify content for accuracy. Save/favorites + feed-click. FULL parity.
2. **Gov Buyer drawer** — same recipe (office/role + opps they run + roster).
   - ⚠️ ALSO (Eric, Jul 26): **Gov Buyers must use a distinct RED color, NOT the same purple as
     Companies.** Today there's ONE shared `CONTACT_COLOR='#7c3aed'` (purple) used 6× in route.ts for
     BOTH companies + buyers (pins, popup strip, card chip). Split it: keep purple for COMPANIES, use a
     distinct BUYER-RED for gov buyers (keyed on `CONTACT_TYPE==='buyers'`). Rationale: a company
     (contractor you compete/team with) vs a government buyer (who awards contracts) are opposite sides
     of the table — they should read differently at a glance; red = the authority/buyer side.
     **REVISED (Eric, Jul 26 — after the "all green" decision):** the per-SET-ASIDE color coding was
     removed (Open pins are now ALL GREEN, legend gone — too distracting with the value-tag numbers).
     So colors are now DATASET-LEVEL only, and the WOSB→pink recolor is MOOT (there's no WOSB-red on
     the map anymore). Simplified palette = one color per DATASET: **Open green · Awarded amber ·
     Companies purple · Gov Buyers RED**. Just give Gov Buyers a distinct RED (buyer pins + "BUYER"
     chip + popup/card strip + drawer) to distinguish the buyer dataset from companies (purple). Do
     NOT reintroduce per-set-aside pin colors or a legend. (Set-aside stays filterable + shown on the
     card/drawer, just not as a pin color.)

### ALSO (Eric, Jul 26): add "Full & Open (no set-aside)" to the Set-aside filter
The set-aside filter dropdown (SDVOSB · Small Business · 8(a) · WOSB/EDWOSB · HUBZone · Other set-aside)
is MISSING the biggest bucket: **full-and-open / non-set-aside work** — 4,801 of 11,239 active opps
(~43%) have NO set-aside, and there's no way to filter for it. A large business (or anyone wanting
unrestricted work) can't isolate what they can actually bid.
- Add a **"Full & Open (no set-aside)"** checkbox to the set-aside filter (`route.ts` — the set-aside
  filter list + the query that maps checked set-asides → the API `set_aside` filter). Checked = opps
  where `set_aside_code` is NULL/empty/unrestricted. Works ALONGSIDE the other checkboxes (check Full &
  Open + Small Business → both show). Aligns with the existing gray "Open" pin (that's already the
  non-set-aside color). Grep how the current set-aside filter builds its query (`setAsideMulti`/the
  filter → `&setAside=` param) and add the "open/none" value.
- Since this touches the SAME set-aside filter + color code as the WOSB→pink/buyer-red change, do it in
  the SAME pass (the Gov Buyer drawer build) to keep all set-aside-filter changes together.
3. **Bring the AWARDED drawer up to full-section parity** (add the applicable sections above) — it was
   shipped stripped; replicate the opp drawer's section set, modify for accuracy.
4. Backfill Save/Favorites parity on Awarded/Companies/Buyers.
Each done = every applicable row in the table above is ✅ (or a justified N/A), and the drawer has the
FULL section layout, not a facts-only stub.

Verify each new section against THIS TABLE before calling it done — every row must be ✅ (or a
justified N/A). A section that only renders pins/list but can't be clicked into, saved, or searched is
half-built.
