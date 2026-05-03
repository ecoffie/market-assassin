# Autonomous Agents

These agents should run with bounded autonomy, strong dry-run behavior, and clear reporting.

## 1. Daily Briefings Operations Agent

**Trigger:** every morning after briefing send windows; on-demand during incidents.

**Inputs:** date, environment, optional tool filter.

**Workflow:**
1. Check precompute runs and template freshness.
2. Count eligible audience from `user_notification_settings`.
3. Count sent/skipped/failed rows in `briefing_log`.
4. Check `tool_errors`, provider health, and dead-letter queue.
5. Identify gaps and recommend catch-up actions.

**Output:** daily health report with severity and next commands.

**Autonomy limits:** read-only by default; repair/catch-up requires explicit execute flag.

## 2. Campaign Launch Agent

**Trigger:** before, during, and after customer activation campaigns.

**Workflow:**
1. Validate source segments.
2. Verify access and suppress unsafe recipients.
3. Generate templates and activation URLs.
4. Stage send batches.
5. Track opens/clicks/signups/replies.
6. Produce end-of-day report.

**Output:** campaign packet, send manifest, daily report, exceptions list.

**Autonomy limits:** never sends emails without explicit approval or configured send window.

## 3. Entitlement Repair Agent

**Trigger:** access audit, support complaint, Stripe migration, revocation campaign.

**Workflow:**
1. Compare Stripe, KV, Supabase, and notification flags.
2. Classify mismatch type.
3. Generate repair preview.
4. Execute approved repairs.
5. Verify post-repair login/setup URL.

**Output:** before/after state and customer-facing note.

**Autonomy limits:** dry-run first; destructive revokes require explicit confirmation.

## 4. Opportunity Matching QA Agent

**Trigger:** after matcher changes, onboarding updates, SAM cache refresh, or user complaint.

**Workflow:**
1. Run fixed prompt suite: roofing, cyber, janitorial, construction, healthcare, logistics.
2. Check inferred NAICS and top ranked samples.
3. Verify extraction writes expected codes/agencies.
4. Flag weak inference or irrelevant top results.
5. Generate regression report.

**Output:** matching QA report and failing examples.

**Autonomy limits:** read-only unless asked to patch matcher.

## 5. Scraper/Data Freshness Agent

**Trigger:** daily/weekly data freshness schedule; on-demand before campaign/briefing launch.

**Workflow:**
1. Check SAM cache, forecasts, grants, SBIR, recompetes, budget intel, agency intel freshness.
2. Compare row counts to historical baselines.
3. Detect zero-result or stale-source failures.
4. Trigger approved scrapers/imports if configured.
5. Report coverage and gaps.

**Output:** freshness dashboard and source-specific repair commands.

**Autonomy limits:** scraper execution requires configured allowed sources and rate-limit safeguards.

