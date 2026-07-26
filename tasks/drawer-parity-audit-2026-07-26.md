# Drawer Parity Audit — Mindy Opportunity Map (2026-07-26)

The definitive feature-parity matrix across the 4 dataset drawers, so remaining gaps get fixed in
ONE informed pass (not one screenshot at a time). Gold master = the Open/Active drawer. From a
read-only trace of `src/app/opportunity-map/route.ts`.

## Verdict
The datasets are NOT half-built — Save/Share/Hide/More, sticky tabs, value-tag pins, search bar, and
account menu all work across all 4. The real gaps are specific + few (below).

## PARITY MATRIX
✅ has it · ❌ MISSING (add) · N/A (justified) · 🚧 in-flight (`feat/awarded-spend-chart-and-similar`)

✅ CLOSED rows below marked with `→ ✅` were fixed in PR `feat/close-drawer-parity-gaps` (2026-07-26).

| Feature / section | Open | Awarded | Company | Buyer |
|---|---|---|---|---|
| Snapshot/overview hero | ✅ | ✅ | ✅ | ✅ |
| "What's special" trait chips | ✅ | ✅ (was ❌ minor → ✅) | ✅ | N/A |
| Bid facts grid | ✅ | ✅ (Recompete facts) | N/A | N/A |
| Buying organization | ✅ | ✅ | N/A | ✅ |
| SOW card-facts (NSN/eval/brand-name) | ✅ | ❌ | N/A | N/A |
| Description | ✅ | N/A | N/A | N/A |
| Scope of work | ✅ | N/A | N/A | N/A |
| Solicitation contacts | ✅ | ❌ (no POCs on award) | N/A | ✅ (buyer IS the contact) |
| Attachments/links | ✅ | ❌ | N/A | N/A |
| Interested vendors | ✅ | N/A | N/A | N/A |
| M-Estimate™ + distribution chart | ✅ | N/A (real ceiling) | ❌ ($won only, no band) | N/A |
| Contract history / who-holds-now | ✅ | ✅ | N/A (firm IS incumbent) | N/A |
| Know-your-buyer · agency intel | ✅ | ✅ | ✅ (was ❌ → ✅) | ✅ |
| Pricing intel | ✅ | ✅ | ❌ | ❌ |
| Other contacts / BD roster | ✅ | ✅ | ❌ | ✅ |
| AI Go/No-Go "Should I bid?" | ✅ | ✅ | N/A | N/A |
| Similar-card flywheel | ✅ | ✅ (#486) | ✅ | ✅ (was ❌ CTA-only → ✅ peer cards) |
| Award history timeline | N/A | ❌ (ledger only) | ✅ | N/A |
| Top-agencies bar chart | N/A | N/A | ✅ | N/A |
| NAICS / what-they-do | ✅ | ✅ | ✅ | N/A |
| Set-asides held | ✅ | ✅ | ✅ | N/A |
| Task-order actual-spend ledger + pins | N/A | ✅ | ❌ | N/A |
| The opportunities they run | N/A | N/A | N/A | ✅ |
| In-body actions block | ✅ | ✅ (was ❌ → ✅) | ✅ | ✅ |
| Action bar Back/Save/Hide | ✅ | ✅ | ✅ | ✅ |
| Share (deep-link copy) | ✅ | ✅ `?recompete=` (was ⚠️ `?opp=`) | ✅ | ✅ |
| "More" → external link | ✅ (SAM) | ✅ USASpending (was ❌ dead) | ✅ | ✅ SAM agency (was ❌ dead) |
| Sticky tabs | ✅ | ✅ | ✅ | ✅ |
| Deep-link auto-open | ✅ `?opp=` | ✅ `?recompete=` (was ❌) | ✅ `?company=` | ✅ `?buyer=` |
| Popup Save heart (on pin) | ✅ | ✅ (was ❌; heart tags recompete) | ✅ | ✅ |
| Value-tag $ pin | ✅ M-Est | ✅ contract$ | ✅ $won | N/A (POC, dot) |
| Search bar recents/saved | ✅ | ✅ | ✅ | ✅ |
| Account/app-shell menu | ✅ | ✅ | ✅ | ✅ |

## PRIORITIZED MISSING (the fix list) — ALL CLOSED in PR `feat/close-drawer-parity-gaps`
### Awarded / Recompete
1. ✅ Similar recompetes flywheel + spend chart — shipped #486.
2. ✅ `?recompete=` deep-link handler + Share now emits `?recompete=` (round-trips on reload).
3. ✅ "More" button → USASpending record for the PIID (was dead empty `uiLink`).
4. ✅ In-body actions block (Track this recompete · Draft capture strategy · View on USASpending).
5. ✅ Popup Save heart on recompete pins (the shared heart now tags entityType=recompete + snapshot).
6. ✅ "What's special" trait chips (service line · set-aside · expiry window).

### Company
1. ✅ **Agency "know your buyer" intel** — added `companyAgencyIntelSec` (priorities + pain points) for
   the firm's #1 agency via `getUnifiedAgencyIntelligence` (new `agencyIntel` field on company-detail).
2. Deferred: M-Estimate-style band/chart for $won (a firm total isn't an estimate — low priority).
3. Deferred: pricing intel / BD roster (optional enrichment).

### Gov Buyer
1. ✅ **"Similar buyers" clickable peer cards** — `buyerSimilarSec` (same-agency peers from the roster,
   each → `openBuyerDrawer`), replacing the dead CTA link.
2. ✅ "More" button → the agency's SAM.gov opportunities page (was dead).

### Open / Active — no gaps (reference implementation).
- ✅ (coordinator add) M-Estimate™ `{none:true}` opps (~11%) now show an honest "No M-Estimate — too
  few comparable awards" note instead of a silent blank. Open-opp only (recompete has a real ceiling).

## GOS invariant #10 — constant drawer skeleton (coordinator upgrade, same PR)
Sections that CAN carry data now ALWAYS render (header + muted placeholder when empty); they no longer
collapse to '' — so the drawer skeleton + buildTabs are constant. Fabrication still forbidden (empty =
"not available", never a fake value). Genuinely-N/A sections stay omitted (SOW facts on a company;
task-order ledger when a recompete has no UEI/PIID).
- **Open opp:** M-Estimate™ · Contract history · Know your buyer · Pricing intel · Scope of work ·
  Similar opportunities · BD roster — all render placeholders when empty. The intel fetch renders
  `renderIntel({})` on a miss (survives a failed fetch), and `loadRoster` always renders (sign-in /
  no-agency / empty placeholders).
- **Awarded:** `renderRecompeteIntel({})` always renders agency intel + pricing; Similar recompetes
  renders a placeholder when none in view.
- **Company:** Top agencies · NAICS · Set-asides · Similar companies · Know-your-buyer intel — all
  placeholder-when-empty.
- **Gov Buyer:** Similar buyers · roster — placeholder-when-empty.
- Guard: `constant-skeleton.unit.test.ts` (9 cases) locks this on the shipped source.

## Correctly-scoped (NOT gaps)
- SOW card-facts / NSN decode = Open-only (no SOW on an award/firm/person). ✅
- Buyer value-tag pin = a dot (a POC has no $ — never fabricate). ✅
- Company/Buyer have MORE save surfaces than Open (popup + action-bar + in-body). ✅
