# Mindy Onboarding Video Scripts (3 Guided Journeys)

**Purpose:** Fill the empty `vimeoUrl` slots in `src/lib/journeys/definitions.ts`.
These are the three walkthrough videos shown in the **Getting Started** panel (the
guided-journey home a new free user lands on after profile setup).

**House rules (grounded, per CLAUDE.md):**
- Every number is REAL: *obvious NAICS ≈ 28% of the market; ~72% hides elsewhere*
  (FY2025 USASpending). *Drones = 42 NAICS codes, a $243M/year market.* Source:
  `src/lib/mindy/upgrade-drip.ts`, `src/lib/alerts/email-promo.ts`.
- Screen-record the REAL app on screen. Say only what's actually visible.
- Voice = the email-drip voice: value-first, plain language, NO jargon (no
  TAL/ABM/ICP/GTM). "Target Market Research", "profile", "BD outreach".
- Mindy on screen, contractor's-eye view. NOT a feature tour — one workflow, one win.
- Real panel labels (from `UnifiedSidebar.tsx`): **Today's Intel**, **My Pursuits**,
  **My Target List**, **Market Research**, **Proposal Assist**, **My Vault**,
  **Expiring Contracts**, **Relationships**, **Contractors**.

**Format each video:** cold hook (≤8s) → the workflow (screen-recorded) → the win
(the artifact) → one-line "your turn." Target length in each script.

---

## VIDEO 1 — "Set up your Market Profile"
**Journey key:** `profile` · **Deep-links to:** My Vault · **Target: 4–5 min**
**The win (artifact):** *A complete profile → real matched opportunities start flowing.*
**The lesson:** the obvious NAICS code misses ~72% of your real market.

### Cold hook (0:00–0:08)
> "Most contractors set up their alerts on one NAICS code — and quietly miss 72%
> of the work they could win. Let me show you how Mindy finds your *whole* market
> in about five minutes."

### Beat 1 — Describe your business (not a code) (0:08–1:15)
**On screen:** Onboarding / Profile — the "describe what you do" input.
**Say:**
> "You don't need to know your NAICS codes. Just tell Mindy what you actually do —
> in plain English. I'll type: *'we install and service commercial HVAC systems for
> federal buildings.'*"
>
> "Watch what happens. Mindy doesn't stop at the one obvious code. It maps the FULL
> set of codes the government actually buys this under — because a single word like
> 'drones' sprawls across 42 different NAICS codes, a $243 million-a-year market.
> That one obvious code? It's only 28% of it. Mindy finds the other 72%."

**On screen:** the scan animation — *Crosswalking NAICS ↔ PSC codes*, *Loading agency
forecasts 12–18 months out*, *Indexing agency pain points* — then the derived code set.

### Beat 2 — Confirm your keywords (1:15–2:20)
**On screen:** the keywords chips.
**Say:**
> "Codes aren't enough on their own. Half of federal opportunities are titled badly —
> the right work with the wrong label. Keywords catch those. Mindy suggests keywords
> from what you told it; you just confirm the ones that fit and drop the ones that
> don't."
>
> "Keep them specific. 'HVAC controls' will pull the right work; 'services' alone is
> too broad and drags in noise. These keywords are exactly what your daily alerts run on."

**Callout on screen:** *These chips are what your alerts actually search.*

### Beat 3 — Add identity + past performance (My Vault) (2:20–4:00)
**On screen:** My Vault — UEI field, certifications, "add past performance."
**Say:**
> "Last piece — your Vault. This is Mindy's memory of your company. Drop in your UEI
> and Mindy pulls your registration. Add your certifications — 8(a), SDVOSB, WOSB,
> HUBZone — so set-aside work gets flagged for you."
>
> "Then add a couple of real past-performance projects. Even two. This isn't busywork —
> it's what powers your bid/no-bid scoring later, and what Mindy weaves into your
> proposal drafts. The more real detail here, the smarter every downstream tool gets."

### The win (4:00–4:30)
**On screen:** Today's Intel with fresh matched opportunities.
**Say:**
> "That's it. Your profile is live — and your daily feed just filled with real
> opportunities matched to your full market, not one code. This is Today's Intel,
> and it refreshes every day. You built the profile once; Mindy works it every morning."

### Your turn (4:30–end)
> "Go describe your business now — the 'Do it now' button below drops you right into it.
> Five minutes here changes what you see every single day."

---

## VIDEO 2 — "Find your customers"
**Journey key:** `customers` · **Deep-links to:** Market Research · **Target: 4–5 min**
**The win (artifact):** *A target list — the buying agencies + the people to reach.*
**The lesson:** stop guessing who to call; see who actually spends on your work.

### Cold hook (0:00–0:08)
> "You know WHAT you sell. The question that wins contracts is WHO buys it — which
> agencies, which offices, which people. Let me show you how Mindy answers that in
> a couple of minutes."

### Beat 1 — Run a market (0:08–1:30)
**On screen:** Market Research panel — the search input.
**Say:**
> "This is Market Research. I'll search my work the same plain-English way — 'commercial
> HVAC installation.' Mindy runs it against real federal spending, not a guess."
>
> "What comes back is the agencies actually spending money on this — ranked by dollars.
> You're not looking at a list of everyone; you're looking at where the budget genuinely
> is for what you do."

**Callout on screen:** *Ranked by real FY spend — USASpending, not estimates.*

### Beat 2 — See the buyers (1:30–2:45)
**On screen:** drill into a buying agency → offices → Decision Makers / contacts.
**Say:**
> "Click into an agency and you go one level deeper — the specific buying offices, and
> the decision-makers and contacts tied to that work. This is the difference between
> 'the VA buys HVAC somewhere' and 'here is the office and the person who signs for it.'"
>
> "That's your BD outreach list, built from real award data instead of cold guessing."

### Beat 3 — Save a target list (2:45–3:45)
**On screen:** save agencies/contacts → My Target List.
**Say:**
> "When something's worth pursuing, save it to your Target List. Agencies, offices,
> contacts — they land in one place you come back to."
>
> "Your Target List isn't just a bookmark. Mindy keeps it live — flagging when one of
> your targets has a new pain point, an upcoming buy, or an event worth showing up to."

### The win (3:45–4:15)
**On screen:** My Target List populated.
**Say:**
> "There it is — a real list of who buys your work and who to talk to, built in minutes.
> No more staring at a blank page wondering where to start your outreach."

### Your turn (4:15–end)
> "Run your first market now — the button below opens Market Research. Search the thing
> you actually sell and see who's been buying it."

---

## VIDEO 3 — "Create your first bid"
**Journey key:** `bid` · **Deep-links to:** My Pursuits · **Target: 5–6 min**
**The win (artifact):** *A submission-ready response (.docx) that covers the solicitation.*
**The lesson:** don't burn days on a bid you can't win — and when you do bid, cover every requirement.

### Cold hook (0:00–0:08)
> "The two ways contractors lose on proposals: bidding on work they were never going to
> win, and missing a requirement that disqualifies them. Mindy fixes both. Let me walk
> the whole thing — pursuit to a finished .docx."

### Beat 1 — Pick a pursuit + bid/no-bid (0:08–1:40)
**On screen:** My Pursuits — a tracked opportunity → open it → bid/no-bid scoring.
**Say:**
> "Everything you Track from your feed lands in My Pursuits. I'll open one. Before you
> write a single word, Mindy scores the fit — bid or no-bid — against your profile and
> your past performance from the Vault."
>
> "This is the discipline most small businesses skip. Mindy tells you where you're strong,
> where the gaps are, and records the decision so you're not re-litigating it later. If
> it's a no-bid, you just saved yourself a week."

**Callout on screen:** *Scored against YOUR Vault — real fit, not a coin flip.*

### Beat 2 — Build the compliance matrix (1:40–3:15)
**On screen:** compliance matrix — extracted shall/must requirements.
**Say:**
> "Say it's a bid. Mindy reads the solicitation and pulls out every requirement — every
> 'shall,' every 'must' — into a compliance matrix. This is the checklist evaluators
> actually grade you against."
>
> "Each requirement becomes a row you can assign and track — who owns it, is it covered.
> Miss one of these and you can get thrown out before anyone reads your technical approach.
> Mindy makes sure none of them slip."

### Beat 3 — Draft, scan, export (3:15–5:00)
**On screen:** draft sections → disqualifier scan → export .docx.
**Say:**
> "Now Mindy drafts to those requirements — pulling real evidence from your Vault, your
> past performance, your capabilities. Not generic filler; your actual story mapped to
> what they asked for."
>
> "Then it scans the draft for disqualifiers — missing requirements, red flags — before
> you submit, not after. And when it's clean, you export a submission-ready .docx. Open
> it in Word, final polish, send it."

### The win (5:00–5:30)
**On screen:** the finished .docx open.
**Say:**
> "From a tracked opportunity to a compliant, submission-ready response — covering every
> requirement, built on your real evidence. That's the whole loop. That's how you go from
> 'I found an opportunity' to 'I submitted a real bid.'"

### Your turn (5:30–end)
> "Open one of your pursuits and run the bid/no-bid — the button below takes you there.
> Even if you don't submit today, you'll know in two minutes whether it's worth your week."

---

## Production notes
- **Record order:** 1 → 2 → 3 (they build the arc: know yourself → find who buys → win).
- **Reuse one demo company** across all three (e.g. the HVAC example) so the Vault,
  Target List, and bid all reference the same story — continuity sells it.
- **Loom → Vimeo → paste URL** into `vimeoUrl` in `src/lib/journeys/definitions.ts`
  (`profile` / `customers` / `bid`). The `GettingStartedPanel` renders it automatically.
- Keep each under the target length — new users bail on long videos. Cut the "your turn"
  hard if you're over.
- **Do NOT** use "Eric Coffie" on screen or in narration (exit-strategy brand rule) —
  it's Mindy / the GovCon Giants curriculum.
