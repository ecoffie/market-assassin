# Plan: Mindy Guided Journeys — "I signed up, then what?"

The free-signup experience today ends in a blank Vault form with no "then what."
This plan replaces that dead-end with **task-based guided journeys** built into the
app — the product teaches itself through the real workflows, each ending in a
concrete win, with Pro revealing itself as the obvious ceiling (value-first, not a
wall). Short Looms ride alongside each step.

> Decisions locked: (1) build the journeys IN-APP; (2) free teaches, paid does it
> at scale. Grounded in docs (current flow mapped June 2026).

---

## The problem (from the code, not assumption)

Current journey: **Signup → 5-step profile setup → dumped in the Vault (UEI form) →
silence.** The user hands over NAICS and gets a data form, no payoff, no next step.
Education exists only in the day-1+ email drip (good lessons, wrong place — after
they've left). Tooltips explain what each *section* does; nothing teaches the
*workflow* that wins a contract.

## The reframe: 3 journeys = the SMB arc

Know yourself → find who buys → respond and win. Each maps to workflows that already
exist in the product, and each ends in a real artifact:

| Journey | Teaches (workflow) | Ends in (the win) | Tools (panels) | Free vs Pro |
|---|---|---|---|---|
| **1. Set up your Market Profile** | Onboarding + Vault: identity, past performance, real NAICS + keywords | A complete profile → real matched alerts start flowing | `vault`, onboarding | Fully free (build the habit) |
| **2. Find your customers** | Market Research → agency buyers → contractor/contact search | A target list: who buys your work + who to call | `research`, `contacts`, `contractors` | Free preview; Pro = unlimited research |
| **3. Create your first bid** | Pursuit → bid/no-bid → compliance matrix → draft → scan → export | A submission-ready response (.docx) | proposal flow (`pipeline` → ProposalsPanel) | Free walks it; Pro = AI drafting + at scale |

## The in-app surface

A **"Getting Started" journey panel** (new `MIPanel: 'start'` or a dismissible
home card), shown to new free users after onboarding instead of the silent Vault:

- A **3-step path** (the journeys above), each a card with: a one-line "why it
  matters," a **short Loom** (60–120s), and a **"Do it now →" button** that deep-links
  to the real panel pre-scoped to their profile.
- **Progress that persists** (reuse the pattern from the compliance roll-up / profile
  completeness): check off each journey as done; show "1 of 3 complete."
- **Value-first paid reveal:** each journey is genuinely useful free. At the natural
  ceiling — "see this opportunity analyzed" / "generate the full briefing" /
  "draft all sections" — the existing `UpgradeModal` fires with the feature-specific
  pitch. The course *created the intent*; the modal closes it.

## The Looms (your recordings)

Short, task-based, Mindy-on-screen — NOT feature tours. Each = one workflow, one
artifact, value-first (matches the email-drip voice). Working titles:

1. **"Set up your GovCon profile in Mindy (5 min)"** — describe your business →
   Mindy derives your NAICS coverage (the "drones = 70+ codes" lesson, live) →
   keywords → first alerts. Lesson: *the obvious NAICS misses 72% of your market.*
2. **"Find who actually buys what you sell (Market Research)"** — run a market →
   see the buying agencies + contacts → save a target list. Lesson: *stop guessing
   who to call.*
3. **"Create your first bid with Mindy (bid → matrix → draft → submit)"** — open a
   pursuit → bid/no-bid → compliance matrix → draft → scan → export the .docx.
   Lesson: *don't spend days on a bid you can't win; cover every shall.*

(Stretch: a 30–60s intro "What Mindy does in 60 seconds" as the home-card header.)

## "Remake the free course" — how this absorbs it

The existing free course is generic GovCon education. These 3 Looms ARE the new free
course — but Mindy-native: every lesson is a thing you *do in the product*. The
funnel and the product become one (marketing's standing goal). Sequencing:
- Phase 1 (this plan): the 3 in-app journeys + Looms.
- Phase 2 (later): point the public free-course funnel at these (the course = the
  onboarding = the product). Decide after Phase 1 proves the in-app flow.

## Build sequence (Phase 1)

1. **Journey data model** — a small `journey_progress` per user (3 steps, done/not),
   workspace-aware like the other persistence. (Migration, hand-run.)
2. **Getting Started panel/card** — the 3-step path UI, deep-links to real panels,
   Loom embeds (placeholder until recorded), progress + dismiss.
3. **Wire onboarding exit → the journey** (instead of the silent Vault landing).
4. **Value-reveal hooks** — ensure each journey's "ceiling" step triggers the
   existing UpgradeModal with the right feature pitch.
5. **Record the 3 Looms** (Eric) → drop the URLs in.
6. **Measure** — track journey-step completion + journey→upgrade-modal→checkout
   (reuse `upgrade-intent` events) so we know it converts.

## What we are NOT doing (scope guard)

- Not rebuilding the tools — journeys *link to* the real panels.
- Not gating the free workflows behind a wall — value-first; Pro is the ceiling.
- Not building a video platform — simple embeds (Vimeo/Loom), like the existing demo.
- Phase 2 (public free-course remake) is deferred until Phase 1 proves out.

---

## Open questions for Eric

- **Where does the journey live** — a new sidebar item ("Getting Started"), a
  dismissible home card on the dashboard, or both?
- **Gate or not for new users** — show the journey panel as the default landing for
  the first N days, or always-available-but-not-forced?
- **Loom vs Vimeo** — you already use Vimeo for reels; reuse that, or Loom for the
  screen-share tutorials?
