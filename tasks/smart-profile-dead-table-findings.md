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

## ✅ DONE — A shipped & verified on prod (2026-07-11)

- **A:** click-learning revived on the REAL profile row instead of forking a duplicate table. Migration `20260711_smart_profile_click_learning.sql` (hand-run, all 6 cols verified live) added `clicked_naics/agencies/contractors/opportunities`, `last_click_at`, `engagement_score` to `user_notification_settings` — next to the `naics_weights/agency_weights/company_weights` JSONB that already lived there and are already read by the generators.
- `learnFromClick`, `updateEngagementScore`, `completeOnboarding` in `service.ts` now read/write `user_notification_settings` (was the nonexistent `user_briefing_profile`).
- **Verified on prod DB:** two simulated clicks on NAICS 541512 → `naics_weights: {"541512":2}` (incremented), agencies VA+DHS → `agency_weights: {"VA":1,"DHS":1}`; `clicked_naics` deduped to `["541512"]`. Read back through `getSmartProfile` → flows into `topNaics`/`topAgencies` → into every briefing (B). Test rows cleaned. `/app` 200.
- `mapDbToProfile` now reads real columns (`clicked_naics`, `engagement_score`, weights) — the earlier "maps to defaults" gap is closed.

## ✅ DONE — live-path sweep shipped & verified on prod (`da999f6d`, 2026-07-11)

Found the dead-table class was wider than this doc first said: **5 LIVE user-path files** (not just admin) still queried `user_briefing_profile`. All repointed at `user_notification_settings`, real columns only, each now surfaces `{ error }`:

- **`workspace/route.ts`** — `profile.briefing` feeds the **Contractors / Recompetes / Forecasts / MarketResearch** panels' default naics+agency filters. Was always null → **those 4 panels ran UNFILTERED for every user** (ignored saved NAICS). Now reads real table (mapped `company_name/zip_code/certifications`, which don't exist there, → `location_zip`/`set_aside_certifications`). **Highest-impact find of the sweep.**
- **`search-capture/route.ts`** — the real-time "learn my search" append (read + update + GET) no-op'd → searched terms never saved to profile. Repointed; dropped the `zip` column map (no array zip col on the real table).
- **`lindy/intelligence/route.ts`** — `profile_summary` always empty → repointed.
- **`briefings/chat/engine.ts`** — chat briefing context always empty → repointed.
- **`access-codes.ts` `grantBriefingAccess`** — default-profile seed upsert no-op'd → seeded users got generic briefings until they searched. Repointed with `ignoreDuplicates` so a re-grant never clobbers an existing richer profile.

**Verified on prod DB:** `c.jacksonbey@yahoo.com` read now returns **52 real NAICS + 5 agencies** (VA/DHS/ARMY/DOD/NASA) — was `null`. Build + 43 tests green, pre-push gate passed, prod deploy Ready, `/app` 200, `/api/search-capture` alive.

## ✅ DONE — admin sweep shipped (2026-07-11) — dead-table class FULLY CLOSED

Split into two classes and handled each correctly (NOT a blind table swap):

**Class 1 — read/diagnostic routes → repointed to `user_notification_settings`:**
- `check-access` — `hasProfile` was always false → now truthful.
- `user-breakdown` — `users_with_alert_config`/`users_with_ma_alerts` were always 0 → reads real table; MA-alerts count derived from `alerts_enabled=true` (read-only, NOT reviving the subsystem).
- `debug-profile` — dead `user_briefing_profile` diagnostic slot (always `present:false`, duplicated the `notification` slot) **removed** so the tool reflects reality; NAICS_NCOL entry dropped.
- `service.ts calculateProfileCompleteness` — the missed straggler: wrote `profile_completeness` to the dead table (a col that doesn't even exist on the real table). Value is recomputed on every call + `getSmartProfile` defaults it to 10 → **dropped the dead write** (no migration for a recomputed-on-read value).

**Class 2 — the retired `user_alert_settings` subsystem → loud 410, NOT revived:**
Per memory `project_mindy_deadletter_automation` ("sync-*-to-alerts routes are DEAD — never re-schedule"), `user_alert_settings` was dropped **on purpose**. Confirmed **none of these routes are scheduled or called from anywhere** (grep of cron/dispatcher/lib = empty). Repointing them would revive retired machinery — so instead they return a **410 Gone** behind the existing admin/cron auth, via new shared helper `src/lib/retired-route.ts`:
- `sync-naics-to-alerts`, `sync-alert-profiles`, `sync-alert-to-notification` (source table gone), `enroll-leads-to-alerts`, `enroll-ma-alerts`, `seed-alerts`, `send-catch-up-alerts` (email-SENDER — 410 doubly prevents an accidental blast), `alert-status`.

**Deliberately left as-is:** `delete-mindy-user` keeps both dead tables in its PII-purge array (over-inclusive by design — `deleteRows` catches the per-table error and continues; purges orphaned PII if a table is ever recreated). Comment tightened. `.sql` schema files = harmless docs.

**Result:** `grep "from('user_briefing_profile'|'user_alert_settings')"` across `src/` = **ZERO live queries** (only the delete-sweep string array + comments remain). tsc 0 errors, 43 tests, build clean.

**Verified NOT broken:** `stripe-webhook` — its only `user_alert_settings` mention is a *comment* confirming it already writes the real `user_notification_settings`. Never a bug; left untouched.

## ✅ DONE — D (legacy pages) retired — ENTIRE dead-table class COMPLETE (2026-07-11)

Confirmed dead first: **nothing in the app links to `/profile/setup` or `/profile/complete`** (only the health-check cron pinged setup). Retired via **301 redirect** (not delete-and-404):
- `next.config.ts redirects()`: `/profile/setup` + `/profile/complete` → `/app/onboarding`, `permanent: true` — so any stale bookmark/email link lands on the REAL onboarding, no dead form, no lost work.
- **Deleted** both `page.tsx` files (nothing imported them; no shared layout).
- **health-check cron** repointed from `/profile/setup` → `/app/onboarding` (still `critical`, expects 200; `/app/onboarding` verified 200 on prod) so the retirement doesn't page.
- tsc 0 (after clearing stale `.next/dev/types` that referenced the deleted routes), build clean.

**Nothing left in the dead-table class.** Both dead tables have zero live queries; the smart-profile system, briefings, panels, chat, admin routes, and legacy pages are all resolved.
