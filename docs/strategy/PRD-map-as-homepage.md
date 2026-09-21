# PRD — The Opportunity Map as the getmindy.ai homepage (the Zillow model)

> # ⛔⛔ OFF THE TABLE — DO NOT IMPLEMENT ⛔⛔
> **Eric (Jul 26): "take the homepage flip off the table so we don't accidentally flip it."**
> This PRD is a PARKED PROPOSAL only. **DO NOT** change the getmindy.ai root rewrite in `next.config.ts`
> (it points to `/mindy-landing` — leave it). **DO NOT** build the free-browse/Pro-gating flip. No agent
> or session should act on this doc until **Eric explicitly says "flip the homepage" AFTER his QC pass.**
> If you're reading this while planning work: this is NOT a task — skip it. The map stays at
> `/opportunity-map`; getmindy.ai stays on the landing page until Eric personally green-lights the flip.



**Vision (Eric, Jul 26):** getmindy.ai's homepage becomes the **opportunity map**, exactly like
Zillow. You arrive and immediately browse federal opportunities for FREE — no signup wall. You only
hit "sign in" when you want to **save** (heart / alerts / pursuits) or use a **paid** feature (AI
Should-I-Bid, drafting). Browse free → save triggers a warm signup → paid features are the gated pull.

**Status:** scoped, PARKED. ⛔ **DO NOT BUILD/FLIP until Eric explicitly gives the go after his QC
pass.** (Eric, Jul 26: "the homepage flip is after I do all my QC work on the features — then we can
flip it. At least 2 days out.") Sequence: (1) 4-dataset parity finishes (buyer drawer ✅ + Awarded
section backfill), (2) **Eric QCs all the features himself**, (3) Eric says "flip it" → only THEN
build the homepage flip + free-browse/Pro-gating. The map must be feature-complete AND Eric-verified
before it becomes the front door. This is a hard gate on Eric's sign-off, not just a build sequence.

## THE MOAT: the incumbents STRUCTURALLY CAN'T copy this (Eric, Jul 26)

**This is the strongest reason to do it.** Every GovCon incumbent — GovWin, SweetSpot, Govly,
HigherGov, even SAM.gov's UX — **gates everything behind logins and paywalls.** Their entire business
model IS the gate: they sell access to data they keep locked. So a free, open, Zillow-style browsable
map of federal opportunities is something they **will not and cannot copy** — opening up would
cannibalize their own pricing. Eric: *"not only do other GovCon firms not have this, they won't do it
because it takes away their value. They like to gate everything."*

This is a classic **innovator's-dilemma moat** — the advantage isn't "we're better," it's **"they're
structurally unable to respond."** The entrenched players can't follow without destroying their own
revenue model. That's the most durable kind of competitive advantage. It's exactly how **Zillow won
real estate**: it made the data free/browsable when the incumbents (agents, MLS) guarded it — and the
guardians couldn't match it without giving away the thing they charged for.

Maps onto the GOS thesis directly: *"make the intimidating domain open + shareable; public data =
content; distribution is a moat."* The free-browse map is the wedge. Then the moat compounds: the
private "what changed" history + the contact/relationship intel (Companies + Gov Buyers, Pro-gated)
is where we monetize — the incumbents gate the OPPORTUNITIES (which we give away free), while we gate
the harder-to-replicate ANSWERS. We invert their model: **free where they charge, paid where the real
value is.**

## Why this is right (it's the existing thesis, made concrete)
- **Zillow's genius: the map IS the front door.** No login wall — land, browse, get hooked on the data.
  GovCon has never had this (GovWin/SAM.gov are login-walled + intimidating). An open, browsable map
  of federal opportunities WITH dollar values is a genuine "I can just SEE this" moment.
- **Aligns with `mindy_product_principles`:** low-floor/high-ceiling, **free = the signal that gets
  them in, paid = the answers.** The map-homepage makes the free floor irresistibly low.
- **Aligns with CLAUDE.md rule #13 "data behind glass":** browse everything (read-only preview), the
  ACTION is the gated pull — cap the action, not the view. Mature-SaaS pattern (Zillow/HubSpot).
- **The gate is WARM, not a wall:** login only triggers when the user tries to SAVE — i.e. after they've
  already found something they want. Best possible conversion moment. (Line-881 comment already says
  "GOS thesis: capture the customer.")

## ✅ Most of this ALREADY EXISTS (grounded — this is smaller than it sounds)
Measured in `next.config.ts` + `src/app/opportunity-map/route.ts`:
1. **Homepage routing:** getmindy.ai root currently host-rewrites → `/mindy-landing` (next.config.ts
   ~line 96). The homepage swap is essentially a ONE-LINE change: rewrite root → `/opportunity-map`.
2. **The map is ALREADY viewable logged-out** — no auth gate to VIEW the map page (no requireAuth /
   redirect on the route). Free browsing already works.
3. **Save/AI ALREADY gate per-action** — the map already does "Sign in to save/run AI" prompts at 6+
   sites (save-search, favorite heart, pursuit save, AI analysis). The mechanism exists.

So this is NOT a from-scratch build — it's: (a) flip the homepage rewrite, (b) audit + polish the
free-browse/gating consistency, (c) handle the logged-out entry experience.

## What to build
1. **Flip the homepage** — getmindy.ai root rewrites to `/opportunity-map` (was `/mindy-landing`).
   DECISION NEEDED at build time: does `/mindy-landing` (the current SEO/marketing landing) go away,
   move to a `/about` or `/welcome`, or stay reachable? (SEO implications — the landing page has SEO
   value; don't just delete it. Likely: map = homepage for humans, keep the landing content at a path
   + ensure the SEO pages/sitemap still resolve.) Grep `getmindy_url_routing` memory + the SEO setup.
2. **TWO gating axes (DECIDED — not everything is free):**

   **AXIS A — which DATASETS are free to browse (Eric, Jul 26):**
   - **FREE (the hook, browse with no login):** **Open opportunities** + **Awarded / Recompetes**. The
     OPPORTUNITY data is the Zillow-style free front door — browse all pins, open the full detail
     drawers (bid facts, M-Estimate, task-order spend), search, filter. This is what gets them hooked.
   - **PAID / Pro-gated:** **Companies** + **Gov Buyers**. The CONTACT/RELATIONSHIP data — who to team
     with, who to call, contractor award profiles, buyer contacts — is the premium pull (highest-value,
     most-monetizable "who to contact" layer). A logged-out / free user selecting Companies or Gov
     Buyers hits a **"data behind glass"** upsell: a blurred/preview tease of the pins + an "Unlock
     contractor & buyer intelligence — upgrade to Pro" CTA (NEVER a blank wall — CLAUDE.md rule #13).
     Show enough to prove the value (e.g. the count, a few teaser pins), gate the detail.

   **AXIS B — which ACTIONS require login (on the FREE datasets):**
   - Logged-out CAN browse Open + Awarded freely (map, drawers, search, filter, value-tag pins).
   - Logged-out MUST sign in to: ♥ save (favorites/pursuits), set up alerts (save-search), run AI
     (Should-I-Bid), draft — the ACTIONS. Already prompts at 6+ sites; audit for consistency + a
     friendly "Sign in to save" (not a hard wall), returning to the map (`?next=%2Fopportunity-map`).

   **So THREE tiers:** (1) anonymous → browse Open + Awarded, no save; (2) free login → browse Open +
   Awarded + save/alerts/AI-preview; (3) Pro → Companies + Gov Buyers + paid answers (drafting, chat,
   full AI). Keep the dataset-gate (Pro) and the action-gate (login) distinct — a free login does NOT
   unlock Companies/Buyers.
3. **Logged-out entry experience** — a logged-out visitor should see the map immediately with a light,
   non-blocking "Sign in" affordance (the app-shell avatar already shows a "Sign in" state when no
   token — reuse it). NO interstitial, NO modal-on-load. Maybe a subtle one-time "Browse free · save
   what you like — sign in when you're ready" hint, dismissible.
4. **The account/nav** already built (avatar, menu, settings, map nav entry — #475) works logged-in;
   ensure it degrades gracefully logged-out (Sign in CTA, no broken /me call — already handled).

## Honest considerations / open decisions (resolve at build)
- **SEO:** `/mindy-landing` and the SEO subpages drive organic traffic. Making the map the homepage
  must NOT tank SEO. The map is JS-heavy (Leaflet) — not crawler-friendly as a landing. LIKELY:
  serve a crawlable hero/summary above or alongside the map, OR keep SEO landing content reachable +
  linked. Measure current organic before flipping. (GOS #7: research how Zillow keeps SEO with a map
  homepage — they have server-rendered content + the map.)
- **Performance:** the map + BigQuery/SAM fetches on the homepage for every anonymous visitor — cost +
  speed. Cache the default (national) view heavily; rate-limit anonymous fetches; the value-tag pins
  for a default viewport should be cheap/cached.
- **Rate-limit / abuse:** anonymous browsing at homepage scale — reuse the existing KV rate-limit
  (`src/lib/rate-limit.ts`) so anon map fetches degrade gracefully.
- **Bot/crawler view:** what a crawler sees at getmindy.ai (SEO content) vs what a human sees (the map).

## Success criteria
- getmindy.ai homepage = the opportunity map. A logged-out visitor browses the FREE datasets (**Open +
  Awarded**) — all pins, drawers, search, filter — with zero signup. First forced login = a save/alert/
  AI action (on those free datasets), returning to the map.
- **Companies + Gov Buyers are Pro-gated** — a free/anon user sees a "data behind glass" preview + a
  clear upgrade CTA (never a blank wall), not the full contact/profile data.
- Three tiers work cleanly: anon (browse Open+Awarded) → free login (+save/alerts) → Pro (Companies +
  Buyers + paid answers). Dataset-gate (Pro) and action-gate (login) are distinct.
- SEO organic traffic not regressed (measured before/after).

## Sequence
4-dataset parity done (buyer drawer + Awarded backfill) → then: flip homepage rewrite + free-browse
gating audit + logged-out entry + SEO/perf handling. Measure SEO + anon-fetch cost before flipping.
