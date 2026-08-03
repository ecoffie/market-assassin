# Mindy Brand & Growth Strategy — Make GovCon *Fun*

**Status:** Direction approved by Eric, 2026-07-18 ("YES YES YES this is perfect I love it").
**Owner:** Eric Coffie. **This is the north star for getmindy.ai's public presence, in-app experience, and content.**

---

## 1. The thesis — the thing the whole industry is missing

Government contracting is sold as **stale, boring, bureaucratic, and intimidating**. Every
competitor reinforces it: dense enterprise dashboards, jargon, walls of data, "analyst" tools that
feel like homework. Nobody is doing the obvious thing.

> **We promote *fun* in doing government contracts.** We turn the grind of federal BD into a game
> people actually want to open every morning — and into data so interesting they *share* it.

This is the opening. Not "a better search box" (a feature war we lose against bigger engineering
teams), but a different *feeling* about the whole category. Fun is the wedge nobody else will take,
because the incumbents are too corporate to try it.

Reference feel: **Robinhood × Higgsfield** — bold, playful, big numbers, progress, streaks,
leaderboards, rewards, celebration. Not Payoneer-clean-corporate (tested → rejected as *stale*).

---

## 2. Two engines

Everything we build serves one of two engines. Keep them distinct and feed both.

### Engine 1 — DISCOVER: shareable federal data as content (GROWTH)

**"Things people want to share, not 'here's what we do.'"** We already hold the live SAM.gov /
USASpending data; nobody packages it as *content*. Each surface is a **public, embeddable,
screenshot-friendly, SEO** page **and** a bottomless well for the social persona.

Launch surfaces (all live-data-driven, auto-updating):

| Surface | What it is | Why it's shared |
|---|---|---|
| **📊 NAICS Leaderboard** | Top codes by federal spend, with ▲▼ rank movement (stock-board style) | People argue about rankings; "my industry moved up" |
| **⏳ Up For Grabs** | Biggest contracts expiring soon + countdown | Urgency + opportunity; "$1.8B is up for recompete" |
| **🧐 Weird Awards** | Oddly-specific real awards ("your tax dollars at work") — a **weekly drop** | Curiosity/viral; the internet loves this format |
| **🎯 Underserved Markets** | High spend, few bidders — where to point your next pursuit | "Real money, barely any competition" = valuable + shareable |

Every Discover surface: a **Share** button, an OG/embed card, its own SEO page. The **weekly Weird
Awards drop** doubles as a newsletter + LinkedIn engine for the persona.

Grounding rule: **every number traces to real SAM/USASpending data** — a fabricated figure kills
trust (and, for a customer, loses a bid). Discover is the moat doc's *"federal data as content /
creative monopoly"* made real.

#### Demand-driven — build what people already search (GSC, not guesses)
The Discover roadmap is **prioritized by real Google Search Console demand for getmindy.ai**, not a
hunch. Run `npx tsx scripts/seo-report.ts` (GCP_SA_JSON already in `.env.local`; property
`sc-domain:getmindy.ai`) to refresh. Trailing-28d snapshot (measured 2026-07-18) that set this order:

1. **Contract-number (PIID) searches dominate impressions** — people search a specific contract to
   find *the award amount, the incumbent, the subcontract plan* (one PIID `19aqmm19f2232` = 134
   impressions; a whole `"<piid>" "current award amount"` pattern). → a PIID-keyed "notable contracts"
   Discover feed + **award pages whose title/snippet LEAD with the contract number + "award amount ·
   incumbent."**
2. **`/top/sdvosb-contractors` is already a top page AND a top gainer.** The **"Top [category]
   contractors" leaderboard format already ranks in production**, and **veteran/SDVOSB is a proven
   organic winner** — real-data validation of the Veteran hub. → **lead Discover with `/top/*`
   leaderboards**: veteran/SDVOSB, 8(a), women-owned, HUBZone, by-NAICS.
3. **Company-name lookups** (MetroStar, Miquin, Anduril, HRL…) — contractor-intel demand → contractor
   leaderboards / profile pages.
4. **Fixable leak:** contractor-contract pages pull 300+ impressions at **~0% CTR** at position ~3-4 —
   we rank for the contract-number searches and nobody clicks. Title/snippet rewrites = free traffic.

**Reordered build priority:** (1) `/top/*` contractor leaderboards [proven], (2) contract-number
surfaces + award-title fix, (3) contractor intel, then Weird Awards / Underserved / Expiring.

#### Supplementary source — the DoW/DoD "$7M list" (cross-check only)
DoD publicly announces every contract **$7M+** each business day (defense.gov). Mindy already holds
that award data via USASpending, so it is **NOT** a primary source (and is not wired into the repo as
of 2026-07-18). Keep it only for: (a) a **same-day freshness cross-check** (DoD announces before
USASpending fully ingests — catches awards, occasionally ones not yet elsewhere), and (b) a "Today's
big defense awards" Discover feed candidate. Low priority vs the GSC-proven work above.

### Engine 2 — THE GAME: personal progress (ENGAGEMENT / RETENTION)

Turn using Mindy into a game with visible progress:

- **First-Contract Quest** — a stepped quest (set up profile → read a match → run a report → save a
  pursuit → submit a bid) with **XP** and a **progress ring**.
- **XP + Levels / Ranks** — **Recruit → Hunter → Closer → Prime**. *The ranks ARE the paid tiers,
  reframed* (Free → Pro → Teams → Enterprise). You "level up" by doing real BD.
- **Streaks** — a daily "hunt streak" for checking matches (🔥 in the nav).
- **Achievements / badges** — First Fit, Market Maker, On a Roll, First Bid, First Win… collect them.
- **Weekly leaderboard** — "Top hunters on the board" with a personal "you" card + rank.
- **Rewards** — refer-a-contractor (both earn credits), Grant Giveaway, Demo Day contest.
- **Celebration** — confetti / level-up moments on First Fit, First Bid, First Win.

---

## 2b. The distribution engine — news-tied content (be *the source*)

**The proof (Eric's own data, 2026-07-18):** one LinkedIn post — *"Navy just posted a
$345M cybersecurity contract for small businesses only"* — did **34,737 impressions,
23,431 members reached, 205 new followers, 395 clicks** off a SINGLE contract framed as
news. Contract data tied to a news hook is the highest-leverage distribution we have —
and it's the same Discover data, pointed at a mass audience instead of only contractors.

**The goal:** make Mindy **the official data source people cite** when they talk about
government spending — the place a journalist, creator, or podcaster (Tucker Carlson, Joe
Rogan) quotes: *"did you see what the government spent last week — it was insane."* Be
the citation, not the commentary.

**Connect the data to what's already in the news:**
- **War / conflict** → the defense contracts that just landed (Ukraine/Israel aid,
  munitions, shipbuilding, drones). *"As the war in X escalates, here's what the Pentagon
  just bought."*
- **Shocking / big-ticket** → the biggest or most surprising awards this week (the $345M
  format; "Weird Awards," but newsworthy).
- **Trending topics** → AI, the border, disaster response — whatever's cycling — mapped to
  the contracts that fund it.

**Surfaces:**
- **"This Week in Government Spending"** — a weekly, auto-drafted recap of the biggest /
  most newsworthy awards. The "did you see what they spent last week" format, built to be
  screenshot + shared.
- **News tie-in cards** — headline + $ amount + agency + hook + **"Source: Mindy ·
  getmindy.ai"** + a stable **citable public URL** backed by the raw contract
  (PIID/agency/amount) so it verifies when someone checks. Screenshot-ready like the $345M
  post. Lives under Discover; the persona posts it (proven), linking back → followers +
  traffic + SEO, and over time journalists/creators find and cite it.

**Why it compounds:** the moat doc's "creative monopoly / a new room" — the SAME federal
data, aimed at the public and the media, not just contractors. **Distribution becomes the
moat: be the source everyone quotes.**

**⚠️ Non-negotiable — every figure real and verified.** Authority as "the source" dies the
first time a number is wrong. Fact-check rule applies hard: the $345M, the agency, the
PIID — all real, all traceable to SAM/USASpending, framed accurately and never falsely
sensationalized. Credibility is the entire asset.

## 3. Audience categories — *in their own words*

Don't speak one generic "small business" voice. Give each core segment **its own category/hub, in
its own language**, with tailored Discover feeds, challenges, and recognition. Our audience skews
heavily one way, so lead there.

### 🎖️ Veterans — the flagship community (biggest following)
- **A dedicated veteran hub, in veteran language** — not "SDVOSB set-aside eligibility," but how
  veterans actually talk about serving, mission, teams, getting the job done.
- Veteran-relevant feeds: **veteran-owned set-asides (SDVOSB/VOSB)**, **grants for veterans**,
  veteran-heavy agencies (VA, DoD).
- **The Hero Award** — public recognition for veteran contractors (a spotlight / award program; a
  reason to share, apply, and be celebrated). Community-building, not a feature.
- A **veteran challenge** — a themed First-Contract or pursuit challenge for the veteran cohort.

### 🎓 University / academic / researchers
- **SBIR/STTR** and **research grants** framed for university people — *"fund your research,"* not
  "non-dilutive capital instruments."
- "Contracts for people in University" as its own lane.

### 🔬 SBIR & innovators
- Interesting/curious **SBIR** opportunities as a Discover feed (cool tech the government is buying).

*(Future lanes as the audience grows: women-owned, 8(a), HUBZone, first-time bidders — same pattern:
own hub, own words, own challenge.)*

---

## 4. Challenges & recognition (the community layer)

Recurring, shareable events that create belonging and FOMO:

- **Mindy Demo Day** — watch contractors pitch live; Mindy finds their next award on stage.
- **Demo Day Pitch Contest** — winner takes a year of Prime + a founder call.
- **$10K Grant Giveaway** — monthly working-capital grant draw.
- **First-Contract Challenge** — 30 days, guided by Mindy, profile → first submitted bid.
- **The Hero Award** — veteran-contractor recognition (see §3).
- **Refer & earn** — bring a contractor, both get credits, no cap.

---

## 5. Why this wins (defensibility)

- **Fun is uncontested.** Incumbents (GovWin, SweetSpot, Govly, HigherGov) are too corporate to
  copy the tone; it's a positioning moat, not a feature.
- **Data-as-content = creative monopoly.** We own the packaging of public data nobody else makes
  shareable (moat doc). It compounds into SEO + social distribution.
- **Community + veterans = built-in distribution.** A recognized, named community (Hero Award,
  challenges, leaderboards) shares on our behalf.
- **The game drives the metrics** — streaks/quests/ranks map directly to activation & retention.

**Keep the deep moat quiet publicly** (the append-only "record of what changed" history) until we
scale — sell the *fun* and the *outcome*, not the trade secret.

---

## 6. Surfaces & where this shows up

| Surface | Role |
|---|---|
| **Public home** (getmindy.ai/) | Gamified: Discover + the game, hero = "winning contracts, turned into a game" |
| **Discover pages** | Public, shareable, SEO, auto-updating from live data — the growth engine |
| **Category hubs** | Veterans / University / SBIR — own words, own feeds, own challenges |
| **Login** | OAuth (Google/MS) + email-password fallback; Google One Tap for frictionless capture |
| **In-app home** (dark) | The game surfaces: quest, XP, streaks, weekly leaderboard, achievements + real leaderboards |
| **Academy** | Public catalog (SEO/lead magnet) → lessons gated behind free signup |
| **Persona content** | Weekly Weird Awards drop, leaderboard movers, underserved-market finds |

---

## 7. Design language

Dark ground (`#08060f`), **Mindy violet** (`#8b5cf6`/`#a855f7`) as the single bold accent, **emerald**
(`#22e08a`) reserved as the "win / gain" signal (Robinhood-green semantic). **Big bold tabular
numbers**, progress rings, badges, leaderboard rows, playful rounded cards, celebration moments.
Energy over polish.

---

## Reference mockups (design phase, 2026-07-18)

- **Gamified home (the approved direction):** claude.ai artifact `3c1ac291-5997-45f1-b76a-43b6ed3551ca`
- Superseded-as-look but structure/content carried over: public home `f7b2a7db…`, marketing pages
  `8527f8eb…`, dark in-app home `47d2489f…`.

*Next: (1) build the Discover pages against live data — the growth engine; (2) roll the gamified
style across Products/Benefits/Pricing/Academy + the in-app home; (3) stand up the Veteran hub +
Hero Award. See memory `getmindy-home-redesign`.*
