# The GovCon Operating System (Mindy Operating Thesis) — the spine every build draws from

**Read this before starting any new Mindy build.** This is the OPERATING SYSTEM doc: the one place
that holds the thesis (*why* we build), the guardrail principles, the engineering invariants (*how* we
build correctly), and the knowledge-architecture rule (*where* things live). Every other strategy doc,
PRD, and memory is an *instance* or *detail* of this one — so we trace direction back to one source
instead of re-deriving it each time. It points to the deep docs; it does not duplicate them.

---

## The one thesis

> Government contracting is **bulletproof but boring** — a huge, guaranteed market, gatekept and sold
> as intimidating homework. Mindy's job is to make it **fun, open, and shareable**, and to become the
> **best-of-breed platform and the cited source everyone builds on** — turning the public data nobody
> packages into **content, games, and agent-native infrastructure**, while the **private history
> compounds into the real moat**.

Everything below is a lens on that sentence.

---

## The paradigm bucket — who to channel, and when

| Paradigm | The lesson we take | Draw from it when building… |
|---|---|---|
| **AWS** | Platform / infrastructure posture; best-of-breed, **not** cheapest; free-tier → **Enterprise** ladder; an API / agent-native layer (our **MCP**); the deep capability runs *internally* before it's sold to the world. | Pricing & tiers, MCP, positioning, the moat's eventual M&A / financial-firm productization. |
| **Robinhood** | Gamify an intimidating domain; **big bold numbers**; streaks / levels / leaderboards; **data-as-content** (popularity lists people screenshot); frictionless one-tap onboarding. | Discover feeds, leaderboards, the in-app game, onboarding. |
| **Higgsfield** | Dark, bold, premium look; **credits / metering**; contests + community; **capture-first** (Google One Tap) but never a hard login wall. | Visual design, MCP credits, community / contests, the home. |
| **Gamification** | Quests, ranks, badges, rewards mapped to **real GovCon actions**; **ranks = the paid tiers** reframed. | Onboarding, retention, the in-app home, community hubs. |
| **News-as-source** | Tie data to newsworthy events; be the **citable** source (the Tucker / Rogan *"did you see what they spent last week"*); distribution = moat. | Content, the persona, "This Week in Government Spending", press. |
| **Payoneer** | Clean conversion **skeleton** (Products / Benefits / Pricing). | Marketing-site *structure* only — the skin stays dark / gamified, never corporate-clean. |

---

## The load-bearing principles (guardrails)

1. **Fun beats stale.** The whole industry is boring; fun is the uncontested wedge. Never ship the
   corporate-clean default (it tested → rejected as "stale").
2. **Public data = content; private history = moat.** Package public data freely (leaderboards, weird
   awards, news tie-ins). Keep the append-only *"what changed"* log **private** until scale — the
   M&A / financial-firm play. *"AWS before Amazon sold it."*
3. **Grounded, never fabricated.** Every dollar figure real and traceable to SAM / USASpending.
   Credibility is the entire asset — the moment a number is wrong, "the source" dies.
4. **Best-of-breed, never bottom-of-barrel.** Sell the platform and the outcome; never anchor on price.
5. **In their own words.** Audience hubs (veterans / university / SBIR): own color, own language, own
   challenge — not one generic small-business voice.
6. **Agent-native is the wedge.** MCP is the AWS-style API layer — the only GovCon layer an AI agent
   can call. Treat it as core infrastructure, not a feature.
7. **Distribution is a moat.** Shareable data + news + community compound into reach the paywalled
   incumbents (GovWin, SweetSpot, Govly, HigherGov) don't have.

---

## Instances of this thesis (applied)

- **`MINDY-FUN-GAMIFIED-STRATEGY.md`** — the gamified public site + Discover engine + community hubs +
  the news-tied distribution engine.
- **The Mindy Moat artifact** — public data as content vs the private "what changed" history.
- **The competitive-positioning artifact** — best-of-breed (agent-native + win-knowledge) vs
  GovWin / SweetSpot / Govly / HigherGov; don't chase data breadth or analyst intel.
- **M-Estimate™ + its self-improving loop** (`PRD-m-estimate-self-improving-loop.md`) — the clearest
  instance of "private history compounds into the moat": we log every estimate we make, harvest the
  realized award, and tighten over time. Backtestable against 54M historical awards *today*; the live
  loop keeps it honest forward. Branded as OURS (not the government's number) — principle #3 made legal.
- **Dense-map rendering** (`DENSE-MAP-RENDERING-RESEARCH.md`) — show ALL points, never a $-ranked
  subset (that's the rank-then-filter bug). Viewport-bounded fetch + clustering + zoom-to-resolve.

## Map rendering rule — VALUE-ON-THE-PIN (Zillow price tags), NOT clustering (Eric, Jul 26)

**Zillow does NOT cluster — it shows a dense field of PRICE-TAG pins overlapping each other, on
purpose. The number ON the pin IS the pin, and the wall of numbers triggers the emotion/comparison
($4.5M next to $335K). That is the model. We initially reached for marker clustering (the generic
"too many dots" answer) — that was an OVER-CORRECTION. The right answer is to make each pin carry its
VALUE.**

- **The pin shows the number, not a plain dot.** A value-tag pin stays legible and comparison-inducing
  even when pins overlap — which is exactly why Zillow lets them overlap instead of clustering. Overlap
  is the FEATURE (a scannable wall of numbers), not a bug to de-clutter.
- **What number per dataset (the emotion trigger):**
  - **Opportunities / Awarded** → the **M-Estimate™** or contract value ("$222K", "$1.3M") — "I could win that."
  - **Companies** → **$ won** ("$65.7B", "$25.8B") — instant sense of the big players.
  - Pick the metric that makes the user FEEL something; the value-on-pin is the model, per Eric:
    "I like using the price on top as a factor."
- **Clustering is demoted to the EDGE case only** — a light count-bubble ("340 here" / Zillow's
  "9 New Homes") ONLY at far-out country/region zoom where even tags can't fit; it releases to
  value-tag pins as you zoom to metro/street. Do NOT cluster-first. (The `markercluster` added in the
  Phase-0 PR is being replaced by value-tag pins; keep only the far-zoom count-bubble.)
- **Density is still viewport-based, not dataset-size-based** — the map loads the viewport's pins
  (bbox-bounded, ~1,000 cap), so a 9K and a 317K dataset both render a viewport's worth. But the fix
  for "too many" is value-tag legibility + overlap (Zillow), not collapsing to dots/bubbles.
- **Prerequisite: pins at REAL locations.** Value tags in a fake state-centroid ring is a wall of
  numbers in the wrong place. Real-city geocoding (the board-wide `geocodeCity` lib) must land first.
- **Approximate-location honesty lives in the DETAIL DRAWER only — one place, board-wide (Eric, Jul 26).**
  Pins are ALWAYS solid (no dashed/approximate pin styling — it clutters and makes pile-ups look worse).
  List cards + popups show the location WITHOUT an "approx." tag (don't crowd compact surfaces). The
  single honest disclosure — "(approximate — based on state, not a confirmed address)" — appears ONLY in
  the drawer's location section, when precision is state-level. Same treatment across ALL datasets. The
  honesty is in ONE authoritative place (the drawer), not scattered on every surface.

## Standard protocol — EVERY dataset/dropdown item gets a detail drawer (Eric, Jul 26)

**Any item in a dataset dropdown (or any clickable card/pin/row) MUST open a detail drawer.** A
dataset a user can see but can't drill into is INCOMPLETE — clicking it dead-ends, which reads as
broken. This is a build standard, not a per-feature decision: when you add a dataset/mode, you add
its drawer in the same pass.
- The opportunity map has 4 datasets: Open · Awarded · Companies · Gov Buyers. Open + Awarded have
  drawers; **Companies + Gov Buyers were shipped without one** (click = dead-end) — that's the gap
  this rule closes.
- The drawer shows the RICH profile for that entity, reusing data that already exists (don't rebuild):
  a **Company** → its contractor profile (awards won, top agencies, NAICS, location, set-asides, award
  history — reuse `getRecipientBySlug`/`/contractors/[slug]` data); a **Gov Buyer** → their office/role
  + the opps they run; an **Opportunity** → the bid facts + intel; an **Award/Recompete** → incumbent +
  task-order spend. Same drawer shell (`openXDrawer`), entity-specific content.
- Sibling of "one fix = every surface": a new dataset without a drawer is a half-built surface.
- This drawer rule is one instance of the COMPOUND invariant (#9 below) — replicate the opp drawer,
  then modify for accuracy.

---

## Engineering invariants (the guardrails that must FIRE, not just be remembered)

Principles above shape *what* we build; these are correctness laws for *how*. A written rule "was read
and violated by the same session that quoted it" — so each of these is (or is becoming) an **automated
pre-push gate** (`scripts/audit-*.mjs`), not a hope. If you touch the relevant code, the gate checks you.

1. **Filter to scope BEFORE you rank — never rank globally then filter to the view.** A query that
   ranks by $ (`ORDER BY amount LIMIT N`) and is shown on a scoped surface (viewport / state / NAICS /
   agency) MUST apply the scope filter before the limit. Global-top-N-then-filter shows only national
   whales and starves every local/segment view. Hit 3× on the map (companies-map, value-range, initial
   zoom). Gate: `audit-rank-then-filter.mjs`. Memory: `rank_then_filter_starves_local`.
2. **`count ?? 0` is data fabrication.** A missing table returns `count=null, error=null` — no error.
   Coalescing to 0 turns "unknown" into "zero" and erased 190 emails once. Bind `{count,error}`, surface
   it. Gate: `audit-supabase-errors.mjs` (rule B). Bug-prevention rule #11 in the project CLAUDE.md.
3. **A multi-column `.select()` that ignores `error` is a silent-degrade.** PostgREST nulls the WHOLE
   query when one named column drifts. Bind `error`. Gate: `audit-supabase-errors.mjs` (rule A).
4. **Every gated `/app` fetch sends `getMIApiHeaders(email)`.** Else the 2FA gate throws a 401. Gate:
   `audit-client-auth.mjs`. Memory: `authed_fetch_401_class`.
5. **Ground every fact in real data.** Every dollar / code / agency / name traces to SAM / USASpending /
   our DB — never an LLM guess. This is principle #3 above, enforced at every AI call site.
6. **One fix = every surface.** When a value/label/rule appears on N surfaces (drawer, popup, favorites,
   dashboard, MCP), fix all N in the same pass. The tool-catalog-drift gate exists because this kept
   slipping. Memory: `update_marketing_on_push` sibling discipline.
7. **Never say "can't" — go find who already solved it.** Before declaring a limit ("the map can't show
   all 317K points", "you can't get X-accurate estimates"), RESEARCH how best-in-class products solved
   it — Google, Zillow, Mapbox, Airbnb, the top SaaS in the space. These are almost always solved
   problems (dense-map rendering → clustering / vector tiles; price estimates → Zestimate). Come back
   with *how they did it* + a concrete implementable recommendation, not a wall. A stated limit must be
   a researched conclusion, never a first instinct. (Eric, Jul 26: "go research what a top SaaS firm
   does; Google has already figured this out.")
8. **Fix data at the ROOT, then re-fetch — never just hide the symptom.** When source data is bad
   (hollow rows, missing fields, garbled values): (a) a fast RENDER GUARD to stop the bad data reaching
   the user now, THEN (b) diagnose the ROOT CAUSE (bad import batch? dropped field in the sync? source
   changed?), (c) fix the pipeline, (d) RE-FETCH to repopulate correctly. Hiding a ghost card is triage,
   not the fix — the data must come back *right*. (Eric, Jul 26, on the 82K hollow federal_contacts.)
   Any bulk write still follows measure → scope → ask-before-write.
9. **COMPOUND, don't restart — replicate the proven build, then modify for accuracy. (Applies to
   EVERYTHING — every surface, not just drawers: cards, lists, panels, pages, APIs, data models,
   libs.)** When building a new instance of something we already built and like:
   (a) **Replicate wholesale** — copy the existing proven version (its shell, card conventions, SECTION/
   FIELD ORDER, styles, structure) verbatim onto the new thing. Start from the SAME order/layout. Never
   design from a blank page when a good version exists.
   (b) **Then modify for accuracy — AFTER the features are built, not before.** Adjust ONLY what is
   provably wrong/inaccurate for the new case (a field that doesn't apply, a literally-incorrect label).
   Determine what's genuinely unique from the working copy, not by re-deriving the design upfront.
   (c) **Consistency is the DEFAULT; divergence must be JUSTIFIED.** "If something doesn't align, we
   question it" — a difference between two surfaces is a bug until proven intentional.
   We COMPOUND on what works; we never go backwards and rebuild what's already good. This is why the
   codebase has ONE opp-drawer shell, ONE card format, ONE geocoder, ONE market query — each new thing
   inherits the proven one. Re-deriving from scratch is the anti-pattern (it's how the map got 3 placement
   schemes + 2 dashboards before consolidation). (Eric, Jul 26: "compound not go backwards — take what we
   built, replicate it on the new list, then modify for accuracy after all features are built. Not just
   drawers, everything.")
10. **SAME FORMAT even when the data doesn't exist — sections/fields NEVER vanish, they show a
    placeholder. (Eric, Jul 26: "all the cards should be exact format even if the data does not exist.")**
    A card/drawer must have the IDENTICAL skeleton every time — the same set of sections in the same
    order, whether or not each has data. A section with no data still renders its HEADER + a muted
    placeholder ("— too few comparables" / "No incumbent found" / "Not available" / "—") in its normal
    slot. It does NOT collapse/disappear. This REPLACES the old "fail-soft → collapse silently" pattern
    (that made drawers look different opp-to-opp — the M-Estimate section vanishing on the 11% of opps
    with no comparables is the example that surfaced it). Rationale: a constant skeleton reads as
    trustworthy + complete (Zillow/Salesforce do this); a vanishing section reads as broken or makes the
    user wonder "why is this one different." Still NO fabrication — an empty section says "not available"
    honestly, never a made-up value. (Genuinely-N/A sections for a dataset — e.g. SOW facts on a company —
    may still be omitted; the rule is: any section that COULD have data always renders, empty-with-
    placeholder.) Applies to all 4 dataset drawers + list cards + fields within sections (label + "—").

**Standing directive (Eric, Jul 26):** when we hit ANY problem, name it as a problem and either solve
it or put a measure in place so it can't recur — don't just patch the instance. A recurring bug becomes
a gate; a recurring decision becomes a doc; a recurring procedure becomes a skill.

---

## Knowledge architecture — where each kind of thing lives (so we stop re-deriving)

Four stores, four jobs. Putting a thing in the wrong store is why knowledge gets lost or ignored.

| Store | Holds | Loaded when | Rule |
|---|---|---|---|
| **CLAUDE.md** (global + project) | The operating rules + doc index | EVERY session (auto) | Keep tight — it costs budget every turn. Rules + pointers, not depth. |
| **MEMORY.md + topic files** | Facts to *recall* (one-liner index → a topic `.md`) | EVERY session (auto) | Index stays < 17KB. One fact per file. Detail in the file, hook in the index. |
| **Reference docs** (`docs/**`, this file, PRDs, `~/docs/*`) | *Depth* on a domain / framework / decision | On demand — opened when the domain comes up | This is the "multi-MD" library. THIS doc is the spine; it points to the rest. |
| **Gates** (`scripts/audit-*.mjs`) + **Skills** (`.claude/skills`, `~/.claude/commands`) | Invariants that must *fire* + procedures to *invoke* | Gate: every push. Skill: when its trigger matches | A rule you can't rely on being remembered → a GATE. A repeatable how-to → a SKILL. |

**The failure mode this fixes:** dumping everything into the always-on files (they bloat + dilute) OR
leaving a framework doc unmerged/​unindexed (invisible — this very doc sat unmerged 8 days). The fix:
right store per thing, and CLAUDE.md indexes the reference layer so a session knows *which* doc to open.

---

## Invariant #11 — every field is a signal; reveal the pattern, tell the story

**Eric, 2026-07-26:** *"For me every piece of data is an insight we can capture… Go back to our GOS —
we are simply revealing the patterns and telling the story."*

The moat is not the raw data (it's public). The moat is **packaging a buyer's behavior into an answer a
small business can act on.** So no field is ever "just metadata to filter on" — every column on a
contract/notice describes *how this buyer behaves*, and behavior is what tells a small firm **"you can
win here"** or **"don't waste your time."** Translate the field → the plain-English tell:

| Field we already hold | The signal (the story to a small business) |
|---|---|
| `contract_type = PURCHASE ORDER` (18% of recompetes) | 🟢 **Buys small — SAP lane** (≤ simplified-acq threshold; low past-perf wall). SB-friendly. |
| `contract_type = DELIVERY ORDER` (54%) | 🔒 **Vehicle-gated** — must be on the IDIQ first → teaming/sub play, not a direct bid. |
| `contract_type = DEFINITIVE CONTRACT` (14%) | 🟡 Standalone open award — often larger. |
| set-aside present (`awards.set_aside` / SAM opp) | 🎖️ **Set-aside friendly** — % reserved for small / 8(a) / SDVOSB / WOSB / HUBZone. |
| award $ size / distribution | 📏 **Too-big tell** — a buyer whose median award dwarfs your ceiling is a non-fit. |

**The rule for any new surface:** don't just show the value, show *what it means*. A "🟢 Small-business
friendly — this office buys small (18% purchase orders)" badge is worth more than the raw type column.
This composes with #9 (COMPOUND) and #10 (constant skeleton): the behavior-profile section renders on
every buyer/awarded drawer, with an honest placeholder when a signal genuinely isn't in the data.

**Honest-data caveat (learned same day):** the signal must come from a field that source *actually
carries*. The recompete/USASpending sync returns `set_aside_type = NULL` on every row (the endpoint
omits it — CLAUDE.md), so set-aside-friendliness must be computed from **BQ `awards.set_aside`** or the
**SAM opp**, never fabricated onto a recompete row. Reveal what's there; say "not available" for what
isn't (#ground-in-real-data).

---

*New build? Start here. Say which paradigm(s) it draws from and which guardrails apply — then build.*
