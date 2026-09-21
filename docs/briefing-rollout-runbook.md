# Briefing Rollout Runbook

Operational guide for scaling the full briefing program from beta to larger lead cohorts without hurting user experience.

## Why This Exists

The briefing program can no longer assume "send to everyone" once the audience moves from hundreds to thousands of leads.

This rollout layer gives us:
- stable cohorts instead of random daily churn
- a cap on how many users get the product at once
- protection against overexposing fallback/generic briefings
- a cooldown so the same user is not recycled too quickly
- a way to keep a cohort active long enough to experience all 3 brief types twice

## Rollout Modes

### `beta_all`

Use for broad internal beta testing.

Behavior:
- send to the full briefing audience
- includes all active `user_notification_settings`
- includes `smart_user_profiles` when enabled in config
- no cohort limit

### `rollout`

Use for controlled conversion testing.

Behavior:
- selects a sticky cohort from the full candidate pool
- keeps that cohort active for at least `stickyDays`
- avoids reselecting the same user during `cooldownDays`
- prioritizes users with real NAICS/agencies over fallback users
- limits fallback users to `maxFallbackPercent` of the cohort when possible
- only rotates when the active cohort has completed the full program experience

## Full Program Experience

Rollout mode is now based on the entire briefing program, not just the daily brief.

Each active cohort is expected to receive:
- `daily brief` at least 2 times
- `weekly deep dive` at least 2 times
- `pursuit brief` at least 2 times

Rotation should not happen until:
- the cohort has been active for at least `14` days
- and each member has received all 3 brief types at least twice

## Candidate Pool

The rollout system builds candidates from:
- `user_notification_settings` where `is_active = true`
- `smart_user_profiles` when `includeSmartProfiles = true`

Candidates are deduped by email and scored so that better-profiled users are chosen first.
For rollout mode, users with NAICS codes are prioritized because they can fully experience daily, weekly, and pursuit briefings.

Priority order:
1. Users with real NAICS or agency data
2. Users from `user_notification_settings`
3. Users who would not require fallback defaults

## Default Launch Settings

Recommended first conversion cohort:

```text
mode=rollout
cohortSize=250
stickyDays=14
cooldownDays=21
maxFallbackPercent=15
requiredDailyBriefs=2
requiredWeeklyDeepDives=2
requiredPursuitBriefs=2
includeSmartProfiles=true
```

Why:
- `250` is large enough to learn from but small enough to protect runtime and inbox quality
- `14` days gives each cohort enough time to receive both weekly deep dives
- `21` days reduces repeat exposure fatigue
- `15%` fallback keeps most trial users on a personalized experience
- `2` touches per brief type means users get the full program twice before rotation

## Admin Endpoint

Path:

```text
/api/admin/briefing-rollout
```

Authentication:

```text
?password=ADMIN_PASSWORD
```

### Preview Current State

```bash
curl "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD"
```

Shows:
- current config
- total candidate count
- profile-ready vs fallback counts
- active cohort
- active cohort progress toward completion
- recommended next cohort sample

### Enable Controlled Rollout

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&mode=rollout&cohortSize=250&stickyDays=14&cooldownDays=21&maxFallbackPercent=15&requiredDailyBriefs=2&requiredWeeklyDeepDives=2&requiredPursuitBriefs=2&includeSmartProfiles=true"
```

### Rotate to a Fresh Cohort

Use when:
- the current cohort has completed the full 14-day / 3-brief experience
- you want to manually move to the next batch

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&rotate=true"
```

If you intentionally need to override the completion guardrail:

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&rotate=true&force=true"
```

To rotate and update settings in one step:

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&mode=rollout&cohortSize=250&stickyDays=14&cooldownDays=21&maxFallbackPercent=15&requiredDailyBriefs=2&requiredWeeklyDeepDives=2&requiredPursuitBriefs=2&rotate=true"
```

### Revert to Broad Beta Mode

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&mode=beta_all"
```

## Daily Operating Flow

### Before a New Cohort

1. Preview the current rollout state.
2. Confirm profile-ready users materially outnumber fallback users.
3. Confirm the active cohort progress shows all members completed the required daily, weekly, and pursuit sends.
4. Confirm the previous runs completed cleanly in metrics, `briefing_log`, and `pursuit_brief_log`.
5. Rotate only if you actually want a new test cohort.

### After the Morning Run

Check:
- `briefingsSent`
- `briefingsSkipped`
- `briefingsFailed`
- selected users vs total candidates
- selected profile-ready vs selected fallback
- active cohort progress and members remaining
- failure reasons in `briefing_log`

## Success Metrics To Watch

For user experience:
- send success rate
- skip rate from "no opportunities"
- fallback share of selected users
- retry volume

For conversion testing:
- clickthrough to briefings settings or offer pages
- reply rate or engagement from emailed users
- percentage of fallback users who later add NAICS/agencies
- paid conversions from the active cohort

## Quality Guardrails

Do not expand the cohort yet if:
- failures spike
- too many users are skipped for no opportunities
- fallback users make up too much of the selected audience
- the cron runtime starts pushing too close to execution limits

Preferred adjustment order:
1. lower `cohortSize`
2. lower `maxFallbackPercent`
3. improve user profiling before expanding
4. only then increase cohort size

## Runtime Notes

The briefing cron still generates user briefings sequentially and pauses between users to protect AI generation and delivery stability.

This rollout system improves scale by controlling audience size and quality.
It does not remove the need for future batching or queue-based fanout if briefing volume grows far beyond the current target cohorts.

## Files

Primary code:
- `src/app/api/cron/send-briefings/route.ts`
- `src/app/api/admin/briefing-rollout/route.ts`
- `src/lib/briefings/delivery/rollout.ts`

Related references:
- `docs/briefings-system.md`
