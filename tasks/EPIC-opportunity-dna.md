# Epic: Opportunity DNA

**Written 2026-08-03. Owner: Eric's product call. Status: SCOPING → slices to follow.**

## Naming (Eric, 2026-08-03)
- **Internal / the object:** `opportunity_dna` — keep this in code + engineering.
- **In the UI:** **Personality** / **"Why this one?"** — DNA is an engineering term; users don't ask
  "what's the DNA of this opportunity?". The card surfaces a personality, not "DNA".

## PRODUCT LANGUAGE (Eric, 2026-08-03 — "Decision Card Language", the doc you hand a new hire)
This is the middle of three docs: Working Backwards (WHY) → **Decision Card Language (how the product
THINKS)** → Design System (how the interface BEHAVES). Approved visual spec: artifact `770f3a39`.

- **THE CREED (box it):** *"The estimate tells you HOW BIG. Identity tells you WHY THIS ONE."* — the
  reusable principle (Mindy's "don't make me think"). "Opportunity Memory" is a principle under it:
  people don't remember numbers, they remember stories. We design for **RECOGNITION**; memory is the
  outcome. (So the doc is titled **Decision Card Language**, not "Memory".)
- **A CARD IS A SENTENCE — grammar (the breakthrough):** **Subject = Identity** (Army — typography) ·
  **Verb = Behavior** (Repeat buyer — an icon) · **Object = Opportunity** (the title). "The Army
  repeat buyer for facilities maintenance." That grammar is WHY it feels natural.
- **TWO LANGUAGES, NEVER CROSSED:** **Identity = TYPOGRAPHY · Behavior = ICONS.** One rule, hundreds
  of decisions. Never invent agency icons. Never invent agency COLORS (no per-agency color system —
  that's 50 visual languages; a calm interface uses one). Never use type for behavior. Agencies are
  brands already (ARMY/VA/NASA) — the WORD is the identity; one calm `Landmark` lucide anchor for ALL
  agencies (it almost disappears — cover the icon, still readable; cover the word, not). Behavior gets
  the reserved lucide set: `Repeat`/`Gem`/`Zap`/`Star`/`Check`. **NO EMOJI** (de-vibe rule Jul 8:
  emoji→lucide; memory `devibe-design-system`). My earlier mockups used emoji — WRONG, corrected.
- **ANTI-PATTERN (show what NOT to do):** eight badges (Army · Repeat · Top Match · SB-friendly ·
  Underwatched · High-confidence · Top 4% · Closes-soon) = ZERO identity, wins an argument instead of
  earning a glance. Right = one subject + one verb + estimate. Everything else waits in the listing.
- **"The vocabulary is the INTERFACE TO THE MOAT — not the moat."** The moat stays the data / corpus /
  behavioral models / recommendation engine; the language makes them VISIBLE. A year out users stop
  asking "search NAICS 561210" and ask "show me the Army recompetes" — THAT shift is the product.
- **Internal name for the per-card story = "Opportunity Story"** (one story per card).

## The Decision Card Principles (Eric, 2026-08-03 — these outlive every badge + algorithm)
1. **Identity before value** — who is this, before how big.
2. **Story before estimate** — a card is remembered by its story ("the Army recompete"), not its number.
3. **A card tells one story** — one identity, never a wall of chips.
4. **A card never explains itself** — the card NAMES it; the listing (drawer) EXPLAINS it. (So NO
   "Why this? Army bought this 4×" line on the card — that's listing content.)
5. **Identity ≠ recommendation** — "Army recompete" (who it is, ABSOLUTE) and "Mindy Recommends"
   (should you care, RELATIVE to you) are DIFFERENT LAYERS. Never mix them in one slot.
6. **Agency is identity, not fallback** — the buyer is the strongest recognizable thing; every
   listing has an identity, none is blank.
- Governing UI test: **"what's the ONE sentence someone remembers?"** = "the Army recompete." If
  they can say it without reopening the card, it worked (Zillow: not "$843,271 3bd/2ba" — "the
  waterfront house").

## IDENTITY vs RECOMMENDATION — two layers, never mixed (Eric, 2026-08-03) — THE load-bearing split
- **Identity** = a BADGE on the identity line. ABSOLUTE — this opp IS an Army recompete regardless of
  who's looking. A fact. Priority within identity: `Agency (+insight) → 💎 Underwatched → 🔁 Repeat
  buyer → 🟢 SB-friendly`. Agency ranks HIGH (identity, not fallback); agency + one insight ride in
  ONE badge ("🪖 Army · Repeat Buyer").
- **Recommendation** = a corner RIBBON, a SEPARATE layer. RELATIVE — Mindy ranked it for YOU, today.
  An opinion. `⭐ Mindy Recommends` (was "🔥 Top Match" — renamed; it's a recommendation, not identity)
  + `⚡ Closes soon`. Most cards have NO ribbon, and that's correct — "Army recompete" means REMEMBER
  it, not BID it. Recommendation is the rare earned overlay.
- **RENAMES (Eric):** `🔥 Top Match → ⭐ Mindy Recommends` (moved to the recommendation ribbon).
  `💎 Hidden Gem → 💎 Underwatched` ("Hidden Gem" implies certainty + reads marketing; "Underwatched"
  describes reality — high win-fit × low views × low saves, real engagement data, NOT AI).
- **"Why this one?" one-liner** = drawer/LISTING only, NOT the card (principle #4).

## The three permanent systems (Eric, 2026-08-03)
**Identity** (who is this?) · **Estimate** (how big?) · **Decision** (should I care?) → together = the
Decision Card. The vocabulary IS the moat: a year out, "show me the Army recompetes / any Underwatched
today? / did anything become a Mindy Recommends?" — the product has its own LANGUAGE, harder to copy
than a model or MCP server. Approved design mockup: artifact `770f3a39` (this doc's visual spec).

## The design principle: IDENTITY FIRST, SIZE SECOND (Eric, 2026-08-03)
The hierarchy is **Identity → Estimate → Title** (not Estimate first). The product stack reordered:
**Identity → Estimate → Decision → Listing → Proposal.** The estimate is no longer first — that is
the whole change. The governing test for the card: **"what's the ONE sentence someone remembers
after a glance?"** — "that's a VA recompete," "that's the top match this week," "that's the hidden
gem." If they can say it without reopening the card, it succeeded (Zillow: nobody remembers
"$843,271, 3bd/2ba," they remember "the waterfront house").

## Two design decisions locked (Eric, 2026-08-03)
1. **Lifecycle is the CATEGORY, not a badge** — Open / Recompete / Forecast render as a Zillow-style
   category header (colored, above the card body), matching the pin color. It never spends a badge slot.
2. **ONE personality badge per card** — the highest-ranked TRUE signal. Priority order (agency is
   IDENTITY, ranked high — NOT a fallback): `🔥 Top match → 💎 Hidden gem → ⚡ Closes soon →
   🪖 Agency → 🔁 Repeat buyer → 🟢 SB-friendly`. When agency + an insight are both true, they ride
   in ONE badge ("🪖 Army · repeat buyer"), never two chips.
   - **💎 Hidden gem** is the one EMOTIONAL badge (everything else is factual): high M-Win × low
     views × low saves. Grounded in REAL engagement data (already instrumenting), NOT AI. The
     addictive one — the badge people chase.
   - **"Why this one?"** Spotify-style one-liner ("Because you listened to…" → "Army has re-bought
     this 4× · SB-friendly"). On the LISTING (drawer) for sure; card placement TBD (see open Qs).

## UNIFIED LIFECYCLE MAP (Eric, 2026-08-03) — the map half of DNA
**One map shows all three opportunity lifecycles AT ONCE — no dataset switching:** Open (green) /
Recompete (purple) / Forecast (amber), differentiated by **pin color = lifecycle only** (the decided
`map1_two_axis_pin_system` model). This is the map-level companion to the card badges: lifecycle color
on the pin === the category header on the card === consistent top to bottom.
- **Scope = the 3 OPPORTUNITY lifecycles only.** Contacts/Companies and Grants stay their own nav
  modes — a Contact pin (company HQ) means something geographically DIFFERENT from an opp pin (place
  of performance), so mixing them misleads. Grants pin at agency HQ (a 3rd distinct meaning).
- **Current state (grep before building):** within the "Open" mode the map ALREADY blends sources
  (`F.src=["SAM","RECOMPETE","DLA"]`, `pass()` filters `F.src.has(o.src)`). But Open ↔ Recompetes ↔
  Contacts ↔ Grants are separate `setMapMode()` corpora with different fetches/schemas today — so
  unifying Open+Recompete+Forecast into ONE simultaneous fetch+render is REAL work, not just a flag.
- Slice: a combined viewport fetch returning all 3 lifecycles with a shared pin schema (lat/lng +
  `src` + the card fields), lifecycle-color pins, and the lifecycle filter (already `F.src`) toggling
  each on/off. Forecasts already place (memory `grants_map_stored_source` pattern; forecasts have HQ
  coords). This is likely Slice 1 or 2 alongside the Tier-A card badges.

## DEFERRED (own epic): DNA as a UNIVERSAL identity layer — Companies/Contacts too (Eric, 2026-08-03)
Eric's insight: the DNA *mechanism* generalizes — a company/contact has as much personality as an opp
(`🔁 Repeat prime`, `🤝 Teams a lot` = teaming target, `👑 Incumbent here`, `🟢 Small biz`/`🎖 SDVOSB`,
`📈 Growing`/`📉 Shrinking`, `🆕 New to federal`). Same badge mechanism, same "identity first," same
one-story-per-card. So contacts CAN get the DNA treatment and live on ONE map with opps.
- **The trap to design around (why it's a separate epic, not a widening):** pin COLOR currently = a
  TIME axis (lifecycle Open→Recompete→Forecast). A company is NOT on that axis — a company pin (HQ)
  is a different KIND than an opp pin (place-of-performance). If green means "Open opp" in one spot and
  "small biz" in another, the map LIES. The honest fix (like Zillow's For-Sale vs Sold vs Agent): **pin
  FAMILY/shape = entity type** (opportunity vs company), **color = lifecycle WITHIN opps**, every card
  gets its one personality badge. Co-visibility (a firm next to the opps it could bid) is the teaming
  magic — but needs that shape/color discipline to stay legible.
- **DECISION (Eric 2026-08-03): keep the CURRENT epic to the 3 opportunity lifecycles.** Companies-DNA
  = its own later epic ("DNA is the universal identity layer across every entity on the map"). Records
  the insight without widening work in flight. When picked up: write `tasks/EPIC-companies-dna.md`.

## The thesis (Eric, 2026-08-03)

> The estimate should NOT make the cards unique. That asks one feature to carry the whole
> user experience. Zillow's ten $850k houses don't feel identical — because the price isn't
> their identity. Their identity is Victorian / Waterfront / Pool / 5 Acres / Downtown.
> **Our cards don't have identity yet.** What's missing is the *story* around each opportunity:
> why is this one recommended, a repeat buyer, a forecast, different from the five other $1.9M jobs?

Mindy is a **discovery** product, not a valuation product. The M-Estimate answers "is this a
BIG opportunity?" — not "what is the exact contract value?". It is **one dimension**, not the
card's identity. Two genuinely similar-sized opps having similar estimates is *fine*. The fix
for "all the cards look the same" is DNA, not decimal-place precision on the price.

**What this epic is NOT:** it is not "better estimates." The estimate is already as good as the
data allows — the sub-agency-narrowing fix (PR #827) was the real estimate improvement, and PSC
is too sparse (7.8% of comps) to help the estimate at all. Value extraction / ML estimate are
ranked #4/#5 below and deliberately deferred.

## Engineering priority ranking (Eric's, verbatim)

1. **Instrument everything** — ✅ DONE (PR #826: cards emit impression + click with variant/opp metadata).
2. **Ship the cards** — ✅ DONE (PR #826: estimate-leads Decision Card).
3. **Opportunity DNA** — ← THIS EPIC (the differentiation layer).
4. Opportunity value extraction — deferred (harder engineering; extraction errors).
5. ML estimate — deferred further.

> "Behavior data is more valuable than estimate precision. Six months from now the thing users
> remember won't be 'the estimate was more accurate.' It'll be 'every card felt different.'"

## The design principle

Each card carries a **DNA badge** (or a small set) that gives it a *personality* — placed with
the estimate, not replacing it. Example:

```
🏗 Recompete          🚀 New Buyer          🔥 Highest Win This Week
≈ $4.9M               ≈ $4.9M               ≈ $4.9M
```

The badge is the story; the estimate is the size. Together the card is memorable.

**Non-negotiables (same as every Mindy surface):**
- Every badge traces to REAL data — never an LLM guess, never fabricated. A badge shows ONLY
  when its signal is genuinely true for that opp (honest-null: no badge rather than a wrong one).
- DNA is a *system*, not one-off chips bolted on. Design the badge vocabulary + priority order
  (which badge wins when several are true — a card shouldn't wear ten badges) before shipping.
- Instrumented from day one: which badges drive clicks is the whole point (priority #1).

## The DNA vocabulary — ranked by DATA-READINESS (real, measured)

Fields ON the card object today (`o`): open opps carry `naics, cat, title, agency, set, loc,
close, sol, office, docs, pocs, posted, est`; recompetes carry `+ value, exp, uei, synced, src`.
So the readiness split below is grounded in what's actually on `o`, not wishful.

### 🟢 Tier A — ship-now (already on the card object, zero new query)
| Badge | Signal | Source on `o` |
|---|---|---|
| `🏗 Recompete` / `Open` / `🔮 Forecast` | horizon / dataset | `o.src` (RECOMPETE vs open vs forecast) — already the pin color axis |
| Agency glyph (`🏥 VA · 🪖 Army · 🚀 NASA · 🌲 Interior`) | the buyer | `o.agency` → a curated agency→glyph map |
| Industry (`Construction · IT · Healthcare · Research`) | what domain | `o.cat` (category) or NAICS→sector |
| `🟢 SB-friendly` | buyer's PO-share tier | `sapBuyerTier(o.agency)` — REAL precomputed PO-share (`src/lib/opportunities/sap-friendly-agencies.ts`), pure fn, no query. ONLY when tier==='most'. |
| `⚡ Urgent` / days-left | deadline window | `o.close` (already computed as `f.c==='hot'`) |
| `📎 Docs` | real solicitation package pulled | `o.docs` |
| `🏛 Large IDIQ` (recompete) | vehicle size | `o.value` band on recompetes |

### 🟡 Tier B — needs one small data thread each
| Badge | Signal | What it needs |
|---|---|---|
| `🔁 Repeat Buyer` / `🆕 First-Time Buyer` | has this office bought this NAICS before? | per-card award-history lookup (the drawer's incumbent/award spine reused) |
| `✓ Fits your NAICS` | matches the viewer's profile codes | thread the signed-in user's profile NAICS → client `cardHTML` (not available client-side today) |
| `👑 Existing Customer` | has the VIEWER won from this buyer before? | viewer's own win history vs `o.agency` |
| `🔥 Highest Win This Week` / relative rank | this opp's M-Win vs the current result set | cross-card ranking pass (relates to task #71) |
| `🏆 High / Low Competition` | typical offer count for this buyer/NAICS | award-history offer-count (USASpending `Number of Offers` is NULL from the recompete endpoint — needs another source) |

### 🔴 Tier C — deferred (real but expensive / model work)
- ML-derived "you'll likely win this" personality — needs the behavior data #1 is now collecting.
- Value-extraction-derived badges (Large/Small by extracted ceiling) — priority #4.

## Slice plan (design the system, then ship slices — NOT one chip at a time)

1. **Design pass** — the badge vocabulary + a PRIORITY ORDER (max 1–2 badges/card; which wins).
   Approve as a mockup (design-first, like every card round). This is the "system" step.
2. **Slice 1 (Tier A):** ship the highest-signal ready badges — likely `Recompete/Open/Forecast`
   + agency glyph, both from `o.src`/`o.agency` with zero query. Instrumented.
3. **Slice 2 (Tier A cont.):** SB-friendly (`sapBuyerTier`) + Urgent + Docs.
4. **Slice 3 (Tier B):** Repeat/First-Time buyer (the award-history thread) — the strongest B signal.
5. Measure (priority #1): which badges drive card clicks. Prune the dead ones; double down on winners.

## Open design questions for Eric
- **Badge budget per card:** 1 or 2? (Zillow shows ~2–3 tags but small.) A card wearing 5 badges
  is noise — the priority order decides which 1–2 show.
- **Placement:** above the estimate (as in the examples) or a chip row under the buyer line
  (where the fit-chips mockup put them)? Above-estimate reads as more of an "identity line."
- **Relative badges** (`🔥 Highest Win This Week`) are the most memorable but the most expensive
  (cross-card pass, per result set). Worth Slice 3+, not Slice 1.

## Related
- Task #70 (Decision Card) — DONE, the surface this rides on.
- Task #71 (Decision Card v1.1 — movement arrows + relative "why this ranks") — the relative-rank
  DNA badges (`🔥 Highest Win This Week`) ARE #71's "why this ranks"; fold #71 into this epic's Tier B.
- `sap-friendly-agencies.ts` — the one DNA signal already built (SB-friendly), the proof the pattern works.
