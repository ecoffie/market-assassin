# smart-profile / user_briefing_profile — dead-table investigation (2026-07-11)

## TL;DR
The entire `src/lib/smart-profile/` system is built on a table — **`user_briefing_profile`** — that **does not exist in the database and is in NO migration**. Its DDL (`src/lib/supabase/smart-profile-migration.sql`, shipped in commit `d170aec9`, Mar 2026) uses `ALTER TABLE user_briefing_profile` (assumes the table pre-exists) and was **never hand-run** (this DB has no in-app DDL). So the feature has been **dead since it shipped**. `briefing_interactions` (also in that SQL, via `CREATE TABLE`) DID get created, which is why interaction *recording* works.

Confirmed against the live DB:
- `user_briefing_profile` — **DOES NOT EXIST**
- `user_alert_settings` — **DOES NOT EXIST** (dropped earlier; see memory `project_mindy_deadletter_automation`)
- `briefing_interactions` — EXISTS (works)
- `user_notification_settings` — EXISTS, holds the REAL per-user profile (naics_codes, keywords, agencies, business_type, set_aside_preferences, watched_companies, naics_weights…) — **but no smart-profile/briefing code ever queries it.**

Mechanic: a missing-table query returns `{ data: null, error }` (does NOT throw), so every call silently degrades instead of crashing.

## Impact, ranked

### 1. 🔴 `POST /api/profile` returns HTTP 500 — VERIFIED LIVE ON PROD
`updateProfile` upserts to the dead `user_briefing_profile` → error → returns null → route returns `500 {"error":"Failed to update profile"}` (`api/profile/route.ts:79-81`, `service.ts:196-199`). Tested on getmindy.ai: **confirmed 500.**
- **Mitigating:** the `/profile/setup` ↔ `/profile/complete` pages only link to each other; nothing in the main `/app` links into `/profile/setup`. It's a **legacy/orphaned onboarding flow**, largely superseded by the `/app` onboarding. So few/no live users likely hit it — but any who do are hard-blocked on step 1.

### 2. 🟠 ALL briefings, ALL users, silently de-personalized to hardcoded generic defaults
The 3 briefing generators (`market-assassin`, `contractor-db`, `recompete`) each have a 3-level fallback chain — and **every level queries a dead table**:
- Level 1: `getBriefingProfile` → `user_briefing_profile` (dead)
- Level 2: direct `.from('user_briefing_profile')` (dead)
- Level 3: `.from('user_alert_settings')` (dead)
- Level 4: hardcoded generic (NAICS 541511/2/9, DHS/DOD/VA, Leidos/CACI/Booz…)

**None ever reads `user_notification_settings`** where the real profile lives. So every MA/Contractor-DB/Recompete briefing goes out with the same generic IT/DHS/big-prime defaults regardless of the recipient's saved NAICS/agencies. Silent (no error surfaced). Lines: `market-assassin/generator.ts:176-237`, `contractor-db/generator.ts:185-240`, `recompete/generator.ts:168-220`+`60-66`.

### 3. 🟡 Click-based personalization learning is silently dead
`learnFromClick`, `updateEngagementScore`, `calculateProfileCompleteness`, `completeOnboarding`, `getSmartProfile`, `getBriefingProfile` all read/write only the missing table → no-op. Even if #1/#2 were fixed, nothing reads this back.

### 4. ✅ Working: `recordInteraction` → `briefing_interactions` (real table). Open/click pixels still log.

## Options (need Eric's call — these are very different amounts of work)

**A. Run the missing migration** — hand-run a corrected `user_briefing_profile` CREATE TABLE (the shipped SQL only ALTERs it, so it needs the base CREATE authored) in Supabase. Revives the whole smart-profile/click-learning feature as designed. But: it's a NEW table that duplicates much of `user_notification_settings`; you'd then have two profile tables to keep in sync. **Most work, revives the most.**

**B. Rewire briefings to the REAL table (`user_notification_settings`)** — point the 3 generators' profile read at `user_notification_settings` (the data users actually save). Fixes #2 (the high-impact one — real briefing personalization) without a migration. Leaves click-learning (#3) dead. **Best impact-per-effort for the briefings.**

**C. Fix the `/api/profile` 500 (#1)** — either point `updateProfile` at `user_notification_settings`, or (if `/profile/setup` is truly dead) remove/redirect the legacy route so it can't 500. Small, isolated.

**D. Remove the dead smart-profile system** — if the `/app` onboarding fully replaced it, delete `smart-profile/` + the legacy `/profile/*` pages and the dead fallback levels. Cleanup, no revival.

**Recommendation:** B + C. B restores real briefing personalization for every user (the actual damage) by reading the table that already has the data; C stops the 500. A (revive click-learning) is optional polish; D (delete) only if the legacy onboarding is confirmed replaced. All should also add the `{ error }` check so the next dead-table is loud (per the swallowed-error audit).

---

## ✅ DONE — B + C shipped & verified on prod (`a36e835e`, 2026-07-11)

- **B:** all 3 briefing generators (market-assassin / contractor-db / recompete) now read `user_notification_settings` instead of the two dead tables. Verified: chris.ford's generator profile read returns naics=5 keywords=10 (was generic defaults).
- **C:** `updateProfile` + `getSmartProfile` + `getOrCreateProfile` now read/write `user_notification_settings` (only columns that exist there; legacy fields like cage_code/annual_revenue dropped, not failed-on). Verified on prod: `POST /api/profile {email, naicsCodes:["541512","541611"], targetAgencies:["DHS"]}` → **200**, returns the saved values (was **500**). Test rows cleaned up.
- All swallowed-error reads in these paths now surface `{ error }`.

**Still open (deferred, not done):**
- **A** — click-learning (`learnFromClick`, `updateEngagementScore`, `recordInteraction`'s side effects, `calculateProfileCompleteness`, `completeOnboarding`) still targets the nonexistent `user_briefing_profile` and silently no-ops. `briefing_interactions` (the write target for raw interactions) DOES exist and works, but nothing reads the learned weights back. Revive only if click-weighted personalization is wanted — needs a real `user_briefing_profile` table (author a proper CREATE, hand-run) OR move the weight columns onto `user_notification_settings`.
- **D** — the legacy `/profile/setup` ↔ `/profile/complete` pages still exist (now functional via C, but superseded by `/app/onboarding`). Retire if confirmed dead. The health-check cron still pings `/profile/setup` expecting 200 (still passes).
- `mapDbToProfile` reads some fields that don't exist on `user_notification_settings` (weights, engagement_score) → they map to defaults; harmless but worth a cleanup pass if A is done.
