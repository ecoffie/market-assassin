# FMS Operations Runbook

Operational guide for running the Federal Market Scanner (FMS) continuously with minimal manual intervention.

---

## Purpose

This runbook defines:
- what should run automatically
- what should stay manual for now
- which data sources are trusted for production
- how briefings cohorts should behave
- how to protect conversions when a user upgrades during a cohort

---

## Operating Principle

FMS should run as an automated intelligence system, not as a human-triggered workflow.

That means:
- scheduled jobs own refresh and delivery
- source policies decide what is allowed to auto-run
- health checks decide when an operator should be alerted
- manual intervention is reserved for exceptions, not normal operation

---

## Core Systems

### 1. Scanner Core

These are production-worthy today:
- [market-scan/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/market-scan/route.ts)
- [agency-sources/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/agency-sources/route.ts)
- [federal-events/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/federal-events/route.ts)
- [recompete/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/recompete/route.ts)

### 2. Forecast Expansion Layer

These are not all equally production-ready.

Source policy is defined in:
- [source-policy.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/source-policy.ts)

Current policy:
- `production`: DHS, GSA
- `validate`: Treasury, EPA, USDA, HHS
- `disabled`: VA, DOD

---

## Briefing Program Cadence

### Brief Types

- `Daily Brief`
  - daily
  - cron: `/api/cron/send-briefings`
  - schedule: `7 AM UTC`

- `Weekly Deep Dive`
  - weekly
  - cron: `/api/cron/weekly-deep-dive`
  - schedule: `Sunday 10 AM UTC`

- `Pursuit Brief`
  - weekly
  - cron: `/api/cron/pursuit-brief`
  - schedule: `Monday 10 AM UTC`

Important:
- pursuit brief is **weekly**, not daily
- cohort design must reflect the real cadence of all 3 brief types

---

## Cohort Rules

The active cohort is a **program cohort**, not just a daily-brief audience.

Current rollout target:
- `cohortSize=250`
- `stickyDays=14`
- `cooldownDays=21`
- `maxFallbackPercent=15`
- `requiredDailyBriefs=2`
- `requiredWeeklyDeepDives=2`
- `requiredPursuitBriefs=2`

Normal rotation rule:
- keep the cohort active for at least 14 days
- do not rotate until users have had the full 3-brief experience twice

Admin control:
- [briefing-rollout/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/admin/briefing-rollout/route.ts)

---

## Upgrade / Upsell Continuity Rule

### Goal

The purpose of the cohort system is to convert users, not to interrupt them after they convert.

### Rule

If a user purchases or upgrades into briefing access during an active cohort:
- they should continue receiving briefings
- they should not be removed just because the cohort rotates later
- they should be treated as a sticky entitled user

### Current Implementation Direction

The rollout layer now prioritizes and preserves users with briefing entitlements:
- paid/entitled briefing users are always included in the active audience when present in the candidate pool
- this prevents a converting user from dropping out due to normal cohort rotation

Source of entitlement:
- `user_profiles.access_briefings`
- active briefing access should remain the product-level truth

Operational expectation:
- cohorts are for acquisition and testing
- entitlements are for retention and continuity

---

## Automation Model

### What Should Run Automatically

Daily:
- `send-briefings`
- health checks for briefing delivery
- scanner/source health checks

Weekly:
- `weekly-deep-dive`
- `pursuit-brief`
- forecast sync for scheduler-enabled sources
- recompete refresh

### What Should Remain Manual For Now

- validate-stage forecast sources
- force-rotating a cohort before completion
- disabled forecast sources

---

## Source Policy

### Production Sources

These are allowed into normal automated forecast operations:
- DHS
- GSA

### Validate Sources

These should be run manually or under supervised validation:
- Treasury
- EPA
- USDA
- HHS

### Disabled Sources

These should stay out of automated production runs:
- VA
- DOD

---

## Manual Commands

### Preview Rollout State

```bash
curl "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD"
```

### Save Recommended Rollout Config

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&mode=rollout&cohortSize=250&stickyDays=14&cooldownDays=21&maxFallbackPercent=15&requiredDailyBriefs=2&requiredWeeklyDeepDives=2&requiredPursuitBriefs=2&includeSmartProfiles=true"
```

### Rotate Completed Cohort

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&rotate=true"
```

### Force Rotate Only If Intentionally Overriding Guardrails

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/briefing-rollout?password=YOUR_PASSWORD&rotate=true&force=true"
```

---

## What We Still Need To Build

These are the next operational automation pieces:

1. `manage-briefing-rollout` cron
   - check cohort progress
   - rotate only when complete

2. `check-briefing-health` cron
   - validate daily/weekly/pursuit delivery health
   - alert on failures

3. `check-fms-health` cron
   - endpoint: `/api/cron/check-fms-health`
   - schedule: `12:45 UTC` daily
   - monitor source freshness
   - monitor zero-record runs
   - enforce source policy

4. source-policy-aware forecast scheduler
   - auto-run only `production` sources
   - skip `validate` and `disabled`

---

## Working Conclusion

The continuous-run model should be:
- automate the trusted core
- gate the uncertain sources
- protect converters with entitlement continuity
- let operators intervene only when health checks or source policy require it
