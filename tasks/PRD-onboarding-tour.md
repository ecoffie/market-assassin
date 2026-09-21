# PRD: First-Time User Onboarding Tour

**Status:** Planning, May 22 2026
**Owner:** Eric / Claude
**Trigger:** Eric, May 22 2026:
> "Add the final phase to build an onboarding module for first time
> users to show them the sidebar step by step and they have to click to
> do something as a way of training them how to use the features. When
> I sign up for new tools it walks me through this (forcefully) before
> I can start so I can click the feature and unlock or explains what it
> does."

---

## The problem

Mindy has ~12 sidebar surfaces. A first-time user lands on Today's
Intel or Source Feed and has no idea that:
- Market Research has charts + an agency table they can save to a
  target list
- My Target List is a workspace they should return to weekly
- Estimating contains Pricing Intel + Proposal Assist
- Source Feed differs from Market Dashboard in purpose
- The "+ Track" button on opportunities sends them to My Pursuits

So they bounce out, or they discover one feature and live there
forever, missing 80% of the product. Power users won't churn — but
new-to-Pro conversion stalls because nobody knows what they're
paying for.

## The solution

A **forced, click-to-progress guided tour** on first login. Same
pattern as Linear, Notion, Spotify, Cal AI, Apple Tips. The user
can't skip past unless they explicitly opt out, and even then we
expose a "Re-run tour" link in Settings.

### Behavior

1. User signs in for the first time after sign-up (or first time
   on `/app` post-onboarding-form)
2. Spotlight effect dims everything except the **first sidebar item**
3. Tooltip pops up explaining what it does + asks them to **click it**
4. The click advances the tour to step 2
5. Continues through ~6-8 key surfaces
6. Ends with a "You're all set" screen + a `[ Start with Today's Intel ]` CTA

The user **must click each surface** to progress. We don't allow
"Next" buttons — clicking the actual feature is the learning. This
is the "forceful" part Eric flagged.

Optional second pass: when they hit a feature for the first time
post-tour, a small "Lightbulb" tooltip appears with deeper context
("This is where you save agencies for your BD outreach. Try clicking
a row in the agency table."). Once dismissed, never reappears.

### Steps (proposed v1 — 7 stops)

| # | Surface | What we say | What they do |
|---|---|---|---|
| 1 | **Today's Intel** | "Your daily 5 opportunities, AI-prioritized. Start every morning here." | Click the panel |
| 2 | **Source Feed** | "The full SAM.gov firehose. Use this when Today's Intel isn't enough." | Click the panel |
| 3 | **Market Research** | "Plan your BD outreach. Find agencies, see signals, save targets." | Click the panel |
| 4 | **My Target List** | "Where your saved agencies live. Track status, log outreach, work them over months." | Click the panel |
| 5 | **My Pursuits** | "Opportunities you're actively working. Track stage, pipeline value, win/loss." | Click the panel |
| 6 | **Pricing Intel** | "Labor rates and price-to-win guidance for any NAICS." | Click the panel |
| 7 | **Proposal Assist** | "AI helps you parse RFPs and draft compliance matrices." | Click the panel |

7 stops × ~10 seconds each = ~70 seconds total. Tight enough that
no one rage-quits, dense enough that they get the mental model.

### Skip / re-run

- An "× Skip tour" link is visible top-right throughout. Skipping
  sets `onboarding_tour_completed = true` on the profile so we
  don't re-prompt.
- Settings → "Re-run product tour" link starts it fresh. Useful for
  users coming back after a long break, or sharing with new team
  members.
- Team Access invitees get the tour the first time THEY log in
  (not the inviter's experience).

---

## Tech approach

### Library choice

Three reasonable React-friendly tour libraries:

| Lib | Pros | Cons |
|---|---|---|
| **shepherd.js** (with react-shepherd wrapper) | Mature, lots of theming, no React-specific lock-in | Heaviest (~50KB), needs CSS overrides |
| **driver.js** | Lightweight (~20KB), modern API | Less React-native, you handle React state yourself |
| **react-joyride** | React-native, well-tested, MIT, ~30KB | Older API, theming via JS config |

Recommend **react-joyride** for the v1 — React-native, well-
maintained, easy to dress in our Tailwind tokens. Bundle size
acceptable since it's only loaded on routes where the tour might
run (lazy-import with dynamic).

### Data model

Need ONE new column on `mi_beta_user_settings`:

```sql
ALTER TABLE mi_beta_user_settings
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at TIMESTAMPTZ;
```

Set when:
- User clicks Skip → `NOW()`
- User completes step 7 → `NOW()`
- User clicks "Re-run tour" → reset to `NULL`

### Trigger logic

In `src/app/app/page.tsx`, after we resolve email + tier:

```typescript
useEffect(() => {
  if (!email) return;
  fetch(`/api/app/workspace?email=${email}`)
    .then(r => r.json())
    .then(profile => {
      if (!profile?.user?.onboarding_tour_completed_at) {
        setShowTour(true);
      }
    });
}, [email]);
```

Show `<OnboardingTour onComplete={...} />` when `showTour === true`.

### Component structure

```
src/components/app/OnboardingTour.tsx
  - TOUR_STEPS array: { target_selector, title, body, action }
  - Wrap children in <Joyride steps={...} run={running} continuous showSkipButton />
  - Each step targets a DOM selector (data-tour-id="dashboard" on each nav item)
  - On step completion (click event on target), POST to mark complete

src/components/app/UnifiedSidebar.tsx
  - Add data-tour-id="<panel>" to each nav item button
```

---

## Success metrics

The growth-ops team should track:

- **Tour completion rate**: of users who saw step 1, what % finished step 7?
  Target: 60%+ in v1. If lower, tour is too long.
- **Skip rate**: of users who saw step 1, what % clicked Skip?
  Target: <25%. If higher, tour is annoying.
- **Activation correlation**: do users who completed the tour have
  higher 7-day return rate vs. skippers?
  Target: +30% return rate for completers.
- **Feature discovery**: % of completers who use 3+ surfaces in
  their first week vs. skippers. Should be 2-3x higher for completers.

Wire these into the Launch Command Center analytics (`/api/admin/
mi-growth-brief`).

---

## What we DON'T do in v1

- **Skip the dimmed backdrop / spotlight on mobile.** Mobile tour
  is its own design problem. v1 ships desktop-only; mobile gets a
  "view on desktop for the guided tour" hint.
- **Video walkthroughs.** Text-only popovers. Video is a different
  product surface (e.g. a separate "Demo" link), not the in-app
  forcefunnel.
- **Conditional steps based on tier.** Free users see the same 7
  steps as Pro — that's how they discover the value of upgrading.
  Showing "Pricing Intel" with an upgrade chip on the tooltip is
  fine; hiding it entirely from free users would defeat the
  discovery goal.
- **Branching paths.** No "Are you a BD director or an owner-
  operator?" forks. Same tour for everyone in v1.
- **A/B testing.** Ship v1, instrument the metrics, iterate based
  on data. Don't fork the tour before we have a baseline.

---

## Implementation sequencing

When this ships, it's a 3-slice build:

| Slice | Time | Ships |
|---|---|---|
| **Tour-A** | 2 hrs | Migration + onboarding_tour_completed_at column, GET/PATCH on workspace endpoint, react-joyride installed |
| **Tour-B** | 3 hrs | OnboardingTour component with 7 steps, data-tour-id wiring on sidebar, Skip + completion handlers |
| **Tour-C** | 1 hr | Settings "Re-run tour" link, analytics events fire on each step transition |

Total: ~6 hours of focused work. Land between Slice 4 (event radar)
and Slice 5 (AI data layer) — i.e. once the surfaces being toured
actually exist. Doing this before Slice 4 ships would be premature
(the tour would skip past Event Radar, which is one of the killer
features).

---

## What happens AFTER the tour

The first time a user reaches **My Target List** post-tour and
clicks any saved target, a one-time "Lightbulb" tooltip explains
the outreach log section. Same for the first time they hit Source
Feed (explains filter chips), Today's Intel (explains the Mindy
Analyst card), etc.

These second-pass nudges live in a separate `feature_nudges` table
keyed by `(user_email, feature_id)` so each nudge fires exactly once
per user per feature.

This pattern (forced tour + just-in-time second-pass) is what
makes Linear / Notion / Cal AI feel "well-designed" even though
each individual surface is dense. Discovery is layered.

---

## Why this matters

Mindy's #1 risk isn't competition — it's "users sign up, can't
find the value in their first 90 seconds, churn, and never see
how good the workspace gets at month 2."

Today: most users probably use 2-3 surfaces and never touch the
other 9. The product appears thinner than it is. Pro conversion
hits a ceiling because nobody knows what they'd be paying for.

A forced first-time tour fixes that without adding any new
features — it just makes the existing features discoverable.

Per Eric's framing: "the way I learn new tools is being walked
through forcefully." Build the product for that user, because that
user is everyone who hasn't onboarded a SaaS tool before. That's
the federal BD audience Mindy is targeting.
