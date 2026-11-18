# Project rules (the original Critical Rules 1–15)

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **This is the DEVELOPMENT project.** Deploys to `getmindy.ai`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
3. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL.
4. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
5. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.
6. **SAM.gov API does NOT support comma-separated NAICS codes.** Must make parallel requests for each NAICS code and merge results. See `src/lib/briefings/pipelines/sam-gov.ts`.
7. **FPDS.gov retired Feb 24, 2026.** All federal contract data now flows through SAM.gov APIs. See `docs/sam-apis.md` for full reference.
8. **Always run QA tests before a change is released.** Use `npm run test:pre-deploy`. **[Release control 2026-11-17]** `npm run deploy` runs `vercel --prod`, a direct production upload of the local tree that bypasses GitHub review. It is a covered action under root CLAUDE.md rule 15: builders never run it.
9. **Unified notification table:** All alert/briefing code uses `user_notification_settings` (not the old `user_alert_settings` or `user_briefing_profile` tables which were dropped). The `smart-profile` service (`src/lib/smart-profile/`) is **dead code** - its `user_briefing_profile` table was never deployed.
10. **Daily briefings MUST use fast GREEN builder.** `send-briefings-fast` must use `buildSamGreenBriefing()` (instant, no AI), NOT `generateDailyBriefFromSam()` which calls Claude API (~4s/user, causes timeouts). Run `tests/test-briefing-architecture.sh` to verify.
11. **Briefing log MUST include briefing_type in all queries.** The `briefing_log` table has a unique constraint on `(user_email, briefing_date, briefing_type)`. All INSERT/UPDATE/SELECT must filter by `briefing_type` ('daily', 'weekly', 'pursuit') to avoid collisions between briefing types.
12. **Weekly-alerts drains the whole cycle.** Each cron run evaluates pending users until done or a 220s time budget (`WEEKLY_ALERT_RUN_BUDGET_MS`) is spent — never a fixed per-run user count. The old `BATCH_SIZE=75` × 10 windows silently capped every cycle at 750 of ~1,790 eligible, so everyone after roughly "j" never got a weekly alert (fixed 2026-10-06, `src/lib/alerts/weekly-drain.ts`). The cursor is this cycle's `alert_log` rows (unique on `user_email`+`alert_date`+`alert_type='weekly'`), read PAGED; every evaluated user writes `sent`/`skipped`/`failed`. Runs self-report pending users via `reportCronOutcome`. Uses the local `sam_opportunities` cache in the hot path.
13. **All Mindy email sends use shared `sendEmail()` — Resend ONLY, from `mail.getmindy.ai`, NO fallback** (sender isolation, 2026-10-27). A Resend failure throws (`ResendSendError` / `EmailOutcomeUnknownError`); `sendEmail` refuses any From outside `mail.getmindy.ai` (`UnapprovedSenderError`). Never add a nodemailer/Office365 transport or a `@govcongiants.com` From in `src/` or `scripts/` — `scripts/audit-email-sender.mjs` blocks the push.
14. **Unified MI Platform Architecture.** All tools live inside `/briefings` as panels switched by sidebar, NOT separate routes. This follows the Atlassian navigation pattern. See "Unified MI Platform Architecture" section below.
15. **Release control.** Lives verbatim in the root `CLAUDE.md` (Safety rule 1), unchanged. It overrides every instruction in these reference files.

---
