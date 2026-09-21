# Org / Enterprise Pricing — Metering Model (canonical)

> ## ⚡ 2026-07-14 — FIRST REAL DEAL (GCAP) DIVERGED FROM THIS MODEL — read before quoting
> This doc is the 2026-07-08 *theoretical* model (flat scope-banded license, annual prepaid, Proposal Assist metered). The **GCAP proposal — the first real org deal — evolved past several of these assumptions** when it hit a live buyer. Where they conflict, **the GCAP proposal + [[project_gcap_proposal_sendready]] are the current source of truth for how we actually sell; this doc's *band anchors* ($36K Single / $75K Regional / $150K Statewide) still stand as scope anchors.** What changed:
>
> - **Per-seat, not a pure "flat scope band."** GCAP is priced **$400/seat list → $250/seat at 8+ seats** (volume + state-funded/public-sector rate). The $36K Single anchor survives, but as *12 seats × $250 × 12*, not an opaque flat number. §1/§3's "NOT per-seat" is superseded FOR THIS BUYER — the seat frame turned out to be what a funded SBDC's procurement understands. (Scope banding still governs Regional/Statewide.)
> - **Term = 6-MONTH INITIAL, not annual-prepaid lock.** $0 30-day pilot → 6-month term → month-6 joint economics review → continue by mutual agreement. Multi-year is an OPTIONAL post-review concession. §1/§6's "annual prepaid" is superseded — a first-deal buyer (and Eric's own support-cost risk) both want the 6-month out. Pilot is **30-day**, not 60 (§2/§5 Pilot row stale).
> - **Mutual termination for cause** (30-day cure, pro-rata refund) — new, wasn't in the model.
> - **Proposal Assist = FIXED $99/mo per-user add-on, NOT metered/PENDING.** §4b's "metered credit-pack, credit price PENDING" and §5's client "$75/seat/mo member rate" are BOTH superseded: counselors get Proposal Assist included with their seat; clients optionally buy it at **$99/mo/user, direct** (no separate discounted client-platform SKU — that idea stays dropped per §4a). No BYO-LLM in client-facing terms.
> - **MCP / API credits** are a separate live Pro-member prepaid-pack product, explicitly excluded from the org license (new carve-out; MCP is in prod).
>
> Net: the scope BANDS and the "flat, budgetable, institutional-SaaS" philosophy hold; the GCAP *mechanics* (per-seat rate card, 6-mo term, termination, $99 add-on) are the real-world refinement. Re-derive the model here once a second org closes and confirms the pattern.

**Status:** Model LOCKED 2026-07-08 (theoretical). **First real deal (GCAP) refined it 2026-07-14 — see banner above.** Numbers = separate decision (see §5).
**Supersedes the pricing structure scattered across:** `APEX-GROWTH-STRATEGY.md`,
`PRD-apex-sbdc-funding-justification.md` §8, `USHCC-Atlanta-Mindy-Proposal.html`,
`Association-Mindy-Proposal-Template.html`, `MI-SAAS-PRICING-STRATEGY.md`. Those had
drift ($50K vs $35K Foundation, $2,500/mo vs $30K/yr). This doc is the single source
of truth for the *model*; each live proposal fills in banded numbers from it.

**Buyer:** agencies / gov-adjacent orgs that license Mindy for their constituents —
APEX Accelerators, SBDCs, chambers (USHCC), APEX/SBDC state networks. NOT per-seat
commercial teams (that's the shipped Teams tier).

---

## 1. The decision

**Flat annual org license, banded by ORG SCOPE, with soft workspace + admin-seat caps
inside each band. Annual prepaid. "Contact Sales" published; rep quotes the band.**

This is the institutional-SaaS standard — how Salesforce Gov Cloud, ESRI (education),
and Bloomberg (enterprise) price into governments/universities/agencies. It is NOT
per-seat and NOT usage-metered, for reasons in §3.

## 2. The bands (scope = the value metric)

| Band | Who they are (self-identifies, no audit) | Soft caps inside |
|---|---|---|
| **Single** | one center / one chapter | admin seats + client workspaces capped generously |
| **Regional** | multi-site / multi-chapter org | higher caps, roll-up reporting |
| **Statewide / National** | state network or national HQ | effectively uncapped, named CSM |

Plus a **$0 pilot on-ramp** (60-day director eval) below the bands — gov can't buy
without proving ROI first; the eval is the enterprise "land" motion.

**Why scope, not seats:** an APEX center has ~15 counselors but serves ~30K businesses.
Per-seat prices the 15 and ignores the 30K — leaves the actual value on the table AND
creates seat-audit friction gov buyers hate. Scope lets the buyer self-select instantly
and grows the price with their reach, not their headcount.

**Cap the view, not the action:** unlimited *use* within a band; the soft caps on
workspaces/seats are the upgrade lever to the next band. (Enterprise-SaaS default —
keep the habit frictionless, make scale the paid pull.)

## 3. Why not the other two metering models

- **Per-seat (Salesforce/Slack):** caps revenue at org headcount not reach; seat-counting
  true-ups are procurement friction. Rejected for this buyer.
- **Usage/consumption (Snowflake/Twilio):** unpredictable annual bill = non-starter for a
  buyer who commits a fixed budget line a year ahead. Rejected.
- **Flat org license (institutional SaaS):** one PO line item, one renewal, budgetable,
  no audits. ✅ Chosen.

## 4. How the number is anchored (floor / ceiling — defensible, provable only)

Every enterprise quote lives between two anchors we CAN defend with clean data:

- **Floor** = equivalent value at our own published list. Pro $149/mo, Teams $499/mo
  ($100/seat). An org license must clear "what these seats would cost at list × heavy
  volume discount" or we're underpricing.
- **Ceiling** = the incumbent's published price. **GovWin (Deltek) $15K–$50K/yr** is the
  public anchor (used across our /compare pages). We price UNDER the incumbent, WELL
  ABOVE our own self-serve.

That band (above self-serve, below GovWin) is where the org-license numbers land.

**Deliberately NOT anchored on** unprovable insider comps (Neoserra private license,
Govology per-APEX sponsorship, DoD per-vendor funding slices). Real but unverifiable →
not used to set price. If sourced later with proof, add here.

## 4a. WHAT WE SELL (settled 2026-07-09) — read this first

**One flat annual org license: the COMPLETE Mindy platform for the center's office,
minus Proposal Assist.** Not a lite "counselor coaching" tool — the real first center
(and the buyer profile generally) wants the FULL stack: pipeline management, teaming,
contractor DB (317K), all intel (market scans, forecasts, awards), client-workspace
management, briefings, alerts, white-label tab, funder reporting.

- **In the license:** everything above (the full platform).
- **Carved out:** **Proposal Assist** — the ONLY token-burning feature. Sold as a metered
  add-on OR counselors bring their own LLM. Keeps the flat license margin-safe (§4b).
- **DROPPED for now:** the individual client-subscription SKU ($75/mo). Reason: the FREE
  tier already gives clients their own alerts, so "counselor sends a teaser → client pays
  to act" doesn't convert — free is good enough. Clients still benefit (counselor-managed
  + own free alerts); we just don't build/sell a paid client tier yet. Revisit only if we
  redesign the free/paid line so pipeline/teaming/DB are the paid gap.

**Pricing consequence:** we are NOT pricing "12 counselor seats." We are pricing the FULL
BD-intelligence platform for an office (pipeline + teaming + 317K DB + all intel) — the
TOP of the product line. The seat-based derivation in §5 is a FLOOR; full-stack value
supports the $36K Single anchor and arguably higher.

## 4b. Structure — Proposal Assist carve-out (the only token layer)

**Decision 2026-07-09.** The org/client tiers are split into a fixed-cost flat layer and
a variable-cost metered layer, because Proposal Assist burns real LLM tokens and a flat
"unlimited" license against it would get margin-crushed by heavy centers.

- **Layer 1 — Platform license (flat, token-free):** counselor seats + client-workspace
  management + market intel + alerts + briefings + matching + white-label + reporting.
  All fixed-cost. This is what the center buys and procurement budgets. Safe to sell flat
  because nothing here scales token cost. **Proposal Assist is NOT in this layer.**
- **Layer 2 — Proposal Assist add-on (metered):** the ONLY token-burning feature, gated
  OUT of the base tiers and sold as a paid add-on (credit-pack). Bought by the center
  (for counselor use) OR by an individual client. Heavy users self-fund their own tokens;
  the flat license never goes underwater. (Standard enterprise-SaaS AI-add-on pattern —
  Copilot / Intercom Fin / Notion AI: base platform flat, AI metered on top.)

**Two-sided access model (the real first center: 12 counselors / 1,000 clients):**
- **Center** buys counselor seats — counselors set up + manage client profiles/workspaces
  and run intel/coaching. Clients do NOT need their own login to be managed.
- **Clients** optionally buy their OWN discounted access (member/partner rate below $149
  retail) — unlocked because they're with a partner center. They own their seat and, if
  they want Proposal Assist, they buy the add-on and bear their own token cost.
- **Why:** GovDash / GovWin are priced for centers, not small businesses — a student/
  small-biz literally can't afford them. Mindy flips it: center gets management tooling
  AND clients get affordable individual access the incumbents don't offer. The center is
  a distribution channel that drives discounted individual signups. (Channel/partner
  model — HubSpot Solutions Partners, Shopify Partners.)

**Proposal Assist credit price = PENDING.** ⚠️ **SUPERSEDED 2026-07-14 (see top banner):** for GCAP this became a **FIXED $99/mo per-user add-on** (counselors included; clients buy direct), NOT a metered credit-pack. The "metered `real cost × margin`" model below was never adopted for the client-facing deal — keep only as the internal cost-justification, not the price. Client discount SKU ($75/seat/mo) also dropped — the client add-on is the $99 Proposal Assist, not a discounted platform seat.
~~Must be `real per-proposal token cost × margin`. Pull the actual cost from the Proposal Assist code/usage before setting it. Client discount rate (USHCC precedent = $75/seat/mo, half retail) is the reference for the client-side price.~~

## 5. Numbers — the bands (SET 2026-07-08, updated 2026-07-09, list/offer prices)

Anchored to the REAL first center's unit economics (GCAP: **8 counselors today, adding
4 → 12**; ~1,000 managed clients) using ONLY our own published list prices — NOT the prior
vendor quote (dropped: it was an unverifiable sent quote, never a deal) and NOT GovWin (its
range is a sanity ceiling, not the anchor). **Anchor the seat-based methods to the committed
12, not today's 8** — you license the account they're becoming, so no true-up in 3 months
when the 4 seats land. (If they push to land at 8 now: ~$24–28K floor with the 4 adds as
built-in expansion, but that leaves budget they've already committed on the table.) The
Single band is where three independent methods converge:

- **Seat floor:** 12 counselors × Pro $149/mo × 12 = **$21,456/yr** — the underprice line
  (this ignores that each counselor manages ~83 client workspaces, a gated power).
- **Seat × mgmt power:** 12 × (1.5–2× Pro) = **$32K–$43K** — counselors aren't solo Pro
  users; each runs ~83 client workspaces.
- **Managed-workspace basis:** 1,000 workspaces × $2.50–3/mo = **$30K–$36K**.
- **Flat license at value ceiling:** ~$36K.
- → all converge at **~$36K**, so that is the Single-center anchor. (This is also the
  "$2,500/mo + white-label" Eric originally anchored on, = $36K/yr with the real math.)

Bands scale ~2× per scope jump. **Platform prices below EXCLUDE Proposal Assist** (§4b —
metered add-on). Workspace cap scales with band, so a center with far more than ~1,000
clients lands in Regional, not Single.

| Band | Annual (list) | What's included (platform layer — NO Proposal Assist) | Anchor logic |
|---|---|---|---|
| **Pilot** — 60-day eval | **$0** | 1 org_admin seat, ~20 client workspaces, branded Org Tab, core Mindy. MOU-closed. | Land motion; gov proves ROI before buying. |
| **Single** — one center (~12 staff / ~1K clients) | **$36,000/yr** *(GCAP: as $250/seat × 12 × 12; $24K at 8 seats — see banner)* | 12 counselor seats, manage ~1,000 client workspaces, full intel/alerts/briefings/matching, white-label tab, quarterly report. | Convergence of seat-power / workspace / flat methods on the REAL center. ~1.7× the $21K seat floor. GCAP quotes it per-seat ($400 list/$250 rate), billed as a 6-mo term. |
| **Regional** — multi-site | **$75,000/yr** | Single × all sites + roll-up reporting + priority support + more counselor seats + higher workspace cap. | ~2× Single; multi-site = multi-license value. |
| **Statewide / National** — state network or national HQ | **$150,000/yr** | Effectively uncapped seats/workspaces + named CSM + statewide roll-up. | ~2× Regional; matches the already-approved "$150K State Network" in `PRD-apex-sbdc-funding-justification.md` §8. |
| **National HQ / custom** | **Contact Sales** | Negotiated national rollout. | Every enterprise ladder tops out in custom. |

**Client-side (individual):** small businesses buy their own access at the member/partner
rate (USHCC precedent $75/seat/mo, half retail) — separate from the center license. Their
Proposal Assist, if wanted, is the metered add-on they buy + fund themselves.

**Discount lever:** these are LIST. Multi-year (2yr ~8%, 3yr ~12%) + annual-prepaid are
the standard concessions a rep trades for the signature — quote list, discount to close.

**Status:** these are OFFER prices, not yet validated by a closed deal (as of 2026-07-08
no org deal has signed; a prior APEX-IL $50K/$68K quote and USHCC $18K are sent-not-signed).
When the first org deal CLOSES, record the actual number here — it validates or corrects
the band. The two-ladder split (federally-funded APEX at higher points vs chambers lower)
in `PRD-apex-sbdc-funding-justification.md` §8 is a REFINEMENT of these bands by buyer
budget, not a contradiction: same scope model, APEX skews to Regional/Statewide pricing
because their cooperative-agreement budgets are larger; chambers skew to Single/Pilot.

## 6. Sales motion (institutional-SaaS standard)

- **Published:** keep Enterprise = "Contact Sales" (every mature player hides the top-tier
  price). Optionally publish "Enterprise from $X/yr" as a procurement anchor.
- **Annual prepaid**, not monthly (gov budgets are annual).
- **Pilot on-ramp** ($0 60-day eval) → band quote → annual license.
- **Tier-gate on features gov requires:** SSO/SAML, org admin/RBAC, white-label tab,
  funder reporting — these live in the org bands, not self-serve.
- One product, multiple SKUs. The build is identical; the price + gating differ by band.

---

*Model locked 2026-07-08. Applies the "what would a mature enterprise-SaaS company do"
lens: flat org/site license banded by scope = how institutional SaaS (Salesforce Gov,
ESRI, Bloomberg) sells into governments/agencies.*
