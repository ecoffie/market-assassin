# PRD: Interactive Product Tour (in-app "click here" walkthrough)

> A guided, click-through walkthrough that runs INSIDE Mindy after the user is
> past profile setup — spotlighting each tab and having them DO things ("add
> your first pursuit", "run your first proposal", "add an agency to your target
> list"). The hands-on "show me how to use this" tour, NOT the profile-setup
> wizard.

**Status:** Draft / scoping — 2026-06-06. Build after sign-off.
**Trigger:** Eric: "Whatever happened to the onboarding mode for new users? The
step-by-step click-here instructions on how to use each tab. NOT the profile
setup — after you're inside Mindy, it makes you click through each section and
do things: add your first pursuit, run your first proposal, select your first
agency for the target list, go to Vault and add a cap statement / resume / past
performance / key team member; in Today's Intel show how to collapse the bar,
track, review fit, share; Contractors how to search/add; Expiring Contracts how
to toggle all vs yours."

---

## 0. What exists vs. what's missing

- **Exists:** `/app/onboarding` — the PROFILE SETUP wizard (NAICS → agencies →
  geography → delivery). This is step 0, not the tour.
- **Exists:** the panel system — `setActivePanel`/`handlePanelChange(panel,
  context)` drives navigation; a tour can call it to move the user between tabs.
  21 panels (chat, dashboard/Today's Intel, alerts, pipeline/My Pursuits,
  target-list, contacts/Relationships, proposals, contractors, decision-makers,
  recompetes/Expiring Contracts, vault, knowledge-base, coach, …).
- **Missing:** any interactive walkthrough, any tour library (no driver.js/
  Shepherd/joyride installed), and a "tour_completed" flag (only
  `onboarding_completed` exists for profile setup).

So this is a NET-NEW feature: a tour engine + step definitions per tab + a
completion flag + an entry trigger.

---

## 1. The experience

After a new user finishes profile setup and lands in Mindy:
- A **welcome card**: "Want a 2-minute tour? I'll show you the ropes." [Start] [Skip]
- On Start, a **spotlight overlay** dims the app and highlights ONE element at a
  time with a tooltip: a short instruction + a Next button. It DRIVES the app —
  switching tabs, opening the right panel — so the user follows along.
- Steps mix "here's what this is" with "now YOU do it" (add a pursuit, etc.).
- A progress indicator (Step 4 of 18) + Skip / Back / Next. Resumable.
- On finish (or skip): set `tour_completed` so it never auto-shows again. A
  "Replay tour" entry in Settings / the help menu for later.

---

## 2. The tour script (per-tab steps — v1)

Walk the core daily-workflow tabs in order. Each step = {panel, target element,
copy, optional action}.

1. **Today's Intel (dashboard)** — "This is your daily feed." Show: collapse the
   sidebar, the opportunity card actions → **Review Fit**, **+ Track**, **Share**.
2. **My Pursuits (pipeline)** — "Everything you're tracking lives here." Have
   them **add their first pursuit** (or track one from Today's Intel). Show the
   Kanban stages (tracking → pursuing → bidding).
3. **Proposal Assist (proposals)** — "Draft a response in one click." Have them
   **run their first proposal** (the Auto "Draft my response"); mention Manual/
   Sport mode.
4. **My Target List (target-list)** — "Pick the agencies you're going after."
   Have them **add their first agency**.
5. **My Vault (vault)** — "Your company profile that powers every draft." Show
   how to **add a capability statement, past performance, key personnel, resume**.
6. **Contractors** — "Find primes to team with or competitors to beat." Show
   **search + add**.
7. **Expiring Contracts (recompetes)** — show the **All vs Yours toggle**.
8. **Relationships** — "Build relationships at your target agencies" (ties to the
   target-list hub).
9. **Knowledge Base / Mindy Chat** — "Ask Mindy anything; sources link here."
10. **Finish** — "You're set. Replay anytime from Settings."

(v1 can ship the first ~6 and add the rest; order = the daily flow.)

---

## 3. Build approach

**Tour engine — recommendation: a lightweight library, not custom.**
- Options: `driver.js` (tiny, no deps, framework-agnostic, spotlight + popover —
  best fit), `react-joyride`, `shepherd.js`.
- **Recommend driver.js**: ~5KB, simple API, easy to drive programmatically
  (we call `.moveNext()` after switching panels), styleable to Mindy's theme.
- Custom overlay is possible but reinvents spotlight/positioning/scroll-into-view
  — not worth it for v1.

**Driving the app between steps:**
- Each step that lives on a different tab calls `onPanelChange(panel)` BEFORE
  highlighting, then waits for the panel to mount (the panels are lazy-loaded —
  the tour must wait for the target selector to exist, e.g. a short retry/poll).
- Target elements need stable `data-tour="..."` attributes added to the key
  controls (Share button, + Track, Draft my response, Add agency, etc.).

**Completion flag:**
- localStorage `mindy_tour_completed` for instant gate; mirror to
  `user_notification_settings.tour_completed` (new column) so it persists across
  devices. Mirrors the existing `onboarding_completed` pattern.

**Entry trigger:**
- Auto-start once, after profile setup completes, when `!tour_completed`.
- Manual "Replay tour" button in Settings + the help menu.

---

## 4. Scope / phasing

- **v1:** driver.js engine + `data-tour` anchors + the ~6 core-workflow steps
  (Today's Intel, Pursuits, Proposal, Target List, Vault, Contractors) + auto-
  start-once + completion flag + Replay in Settings.
- **v2:** the remaining tabs (Relationships, Expiring toggle, Knowledge Base,
  Coach), "do it yourself" interactive checkpoints that verify the user actually
  performed the action, per-persona tour variants (free vs pro vs coach),
  analytics (which step users drop off at).
- **Out:** changing profile setup; gamification/badges.

---

## 5. Risks / gotchas

- **Lazy-loaded panels:** the target element won't exist the instant we switch
  tabs — the tour must wait/poll for the selector (or the panel's ready signal)
  before highlighting, or steps will point at nothing.
- **Responsive/mobile:** the collapsed sidebar + mobile layout move targets;
  driver.js handles repositioning but copy like "collapse the sidebar" may not
  apply on mobile. Gate or adapt mobile steps.
- **Empty states:** a brand-new user has no pursuits/vault entries — "add your
  first X" steps must work against empty panels (they're the point), but
  "show the Share button on a card" needs at least one card. Seed or branch.
- **Don't trap the user:** Skip always available; Esc closes; never block real
  work. Re-entrant (resume mid-tour).
- **Anchor drift:** `data-tour` attributes must survive refactors — keep them on
  durable wrappers, document them.

---

## 6. Success criteria

- A new user, after setup, is offered a tour that walks them tab-by-tab and has
  them perform the core actions (add a pursuit, run a proposal, add an agency).
- The tour drives navigation itself (switches tabs), never dead-ends, is
  skippable/resumable, and only auto-shows once.
- "Replay tour" works from Settings.

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-06 | Scope the interactive in-app tour as a PRD first. It's NET-NEW (distinct from the profile-setup wizard). Recommend driver.js as the engine, data-tour anchors, drive nav via onPanelChange, tour_completed flag (localStorage + DB column), auto-start once + Settings replay. v1 = ~6 core-workflow tabs; v2 = rest + interactive checkpoints + analytics. | Eric (PRD requested) |
