# Drawer Parity Audit — Mindy Opportunity Map (2026-07-26)

The definitive feature-parity matrix across the 4 dataset drawers, so remaining gaps get fixed in
ONE informed pass (not one screenshot at a time). Gold master = the Open/Active drawer. From a
read-only trace of `src/app/opportunity-map/route.ts`.

## Verdict
The datasets are NOT half-built — Save/Share/Hide/More, sticky tabs, value-tag pins, search bar, and
account menu all work across all 4. The real gaps are specific + few (below).

## PARITY MATRIX
✅ has it · ❌ MISSING (add) · N/A (justified) · 🚧 in-flight (`feat/awarded-spend-chart-and-similar`)

| Feature / section | Open | Awarded | Company | Buyer |
|---|---|---|---|---|
| Snapshot/overview hero | ✅ | ✅ | ✅ | ✅ |
| "What's special" trait chips | ✅ | ❌ (minor) | ✅ | N/A |
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
| Know-your-buyer · agency intel | ✅ | ✅ | ❌ **(add)** | ✅ |
| Pricing intel | ✅ | ✅ | ❌ | ❌ |
| Other contacts / BD roster | ✅ | ✅ | ❌ | ✅ |
| AI Go/No-Go "Should I bid?" | ✅ | ✅ | N/A | N/A |
| Similar-card flywheel | ✅ | 🚧 (in flight) | ✅ | ❌ **(CTA only, add cards)** |
| Award history timeline | N/A | ❌ (ledger only) | ✅ | N/A |
| Top-agencies bar chart | N/A | N/A | ✅ | N/A |
| NAICS / what-they-do | ✅ | ✅ | ✅ | N/A |
| Set-asides held | ✅ | ✅ | ✅ | N/A |
| Task-order actual-spend ledger + pins | N/A | ✅ | ❌ | N/A |
| The opportunities they run | N/A | N/A | N/A | ✅ |
| In-body actions block | ✅ | ❌ **(add)** | ✅ | ✅ |
| Action bar Back/Save/Hide | ✅ | ✅ | ✅ | ✅ |
| Share (deep-link copy) | ✅ | ⚠️ emits `?opp=` (wrong) | ✅ | ✅ |
| "More" → external link | ✅ (SAM) | ❌ dead (empty uiLink) | ✅ | ❌ dead |
| Sticky tabs | ✅ | ✅ | ✅ | ✅ |
| Deep-link auto-open | ✅ `?opp=` | ❌ **no `?recompete=`** | ✅ `?company=` | ✅ `?buyer=` |
| Popup Save heart (on pin) | ✅ | ❌ **(add)** | ✅ | ✅ |
| Value-tag $ pin | ✅ M-Est | ✅ contract$ | ✅ $won | N/A (POC, dot) |
| Search bar recents/saved | ✅ | ✅ | ✅ | ✅ |
| Account/app-shell menu | ✅ | ✅ | ✅ | ✅ |

## PRIORITIZED MISSING (the fix list)
### Awarded / Recompete
1. Similar recompetes flywheel + spend chart — 🚧 in flight (`feat/awarded-spend-chart-and-similar`).
2. `?recompete=` deep-link handler + fix Share (it emits `?opp=<piid>` → reloads into wrong mode).
3. "More" button dead (empty `uiLink`) → point at USASpending `/award/<id>`.
4. In-body actions block (Draft / Track CTA).
5. Popup Save heart on recompete pins.
6. (minor) "What's special" chips.

### Company
1. **Agency pain-point / "know your buyer" intel** — shows WHICH agencies, not the intel block. Reuse `getUnifiedAgencyIntelligence` on the firm's #1 agency.
2. M-Estimate-style band/chart for $won (lower priority — a firm total isn't an estimate).
3. Pricing intel / BD roster (optional enrichment).

### Gov Buyer
1. **"Similar buyers" clickable peer cards** (currently just a CTA link) → wire to `openBuyerDrawer`.
2. "More" button dead → point at agency/SAM entity.

### Open / Active — no gaps (reference implementation).

## Correctly-scoped (NOT gaps)
- SOW card-facts / NSN decode = Open-only (no SOW on an award/firm/person). ✅
- Buyer value-tag pin = a dot (a POC has no $ — never fabricate). ✅
- Company/Buyer have MORE save surfaces than Open (popup + action-bar + in-body). ✅
