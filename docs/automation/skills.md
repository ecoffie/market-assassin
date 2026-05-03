# Reusable Skills

These are the top internal workflows to turn into Codex skills. Each skill should be concise, triggerable by name, and backed by references only when needed.

## 1. Campaign Packet Builder

**Use when:** launching activation, reactivation, onboarding, upsell, beta, or access campaigns.

**Inputs:** source CSV/JSON, cohort definitions, launch date, offer/access rules, exclusions.

**Workflow:**
1. Verify source files and counts.
2. Segment audience into cohorts and variants.
3. Generate send schedule and suppression notes.
4. Draft templates with `{{activation_url}}` or relevant CTA variables.
5. Add QA checklist, metrics plan, and rollback notes.

**Output:** campaign markdown packet plus CSV/JSON source references.

## 2. Access Entitlement Audit Writer

**Use when:** checking whether users should have alerts, briefings, bundles, preview access, or revoked status.

**Inputs:** email list, product/cohort, access intent, available Stripe/KV/Supabase data.

**Workflow:**
1. Resolve email identity and billing email assumptions.
2. Check Stripe status, KV access, `user_profiles`, and `user_notification_settings`.
3. Compare expected tier to actual flags.
4. Classify: active, setup-needed, missing-access, over-entitled, revoked-safe.
5. Produce repair commands or dry-run instructions.

**Output:** audit table and customer-safe explanation.

## 3. Briefings Launch QA Checklist

**Use when:** changing `/briefings`, activation links, onboarding, preferences, or entitlement sync.

**Workflow:**
1. Test `/briefings?email={{email}}&setup=true`.
2. Confirm email prefill, local storage, entitlement verification, onboarding/settings open behavior.
3. Confirm `user_notification_settings` writes `is_active=true`, `briefings_enabled=true`, NAICS/preferences.
4. Confirm cron audience uses the same table/flags.
5. Run focused lint/build and document blocked live tests.

**Output:** pass/fail checklist with exact file/API references.

## 4. Alert And Briefing Incident Triage

**Use when:** alerts or briefings fail, send counts drop, users report missing email, or health checks degrade.

**Workflow:**
1. Identify affected tool: daily alerts, weekly alerts, daily briefings, weekly deep dive, pursuit.
2. Check schedule/day guards, recent deploys, provider health, logs, `alert_log`, `briefing_log`, `tool_errors`.
3. Compare eligible audience to sent/skipped/failed counts.
4. Identify likely cause and immediate containment.
5. Recommend repair/catch-up route and verification query.

**Output:** incident summary, severity, cause hypothesis, next commands.

## 5. GovCon Email Copy Generator

**Use when:** writing Eric-style activation, reminder, upsell, correction, profile-completion, or personal customer emails.

**Rules:**
- Plainspoken, direct, low-drama.
- No unnecessary apology language unless explicitly needed.
- Always include access/setup CTA and what happens next.
- Mention bootcamp/context only when relevant.

**Output:** subject lines plus final email body by cohort.

## 6. NAICS/Profile Matching Debugger

**Use when:** a phrase like "roofer in south florida" returns poor opportunities or wrong NAICS.

**Workflow:**
1. Infer expected NAICS and geography.
2. Check explicit codes, prefix fallbacks, title/description keywords, and state filters.
3. Inspect sample picker, preferences, and alert matching behavior.
4. Explain why examples were ranked.
5. Propose matching/ranking changes and regression prompts.

**Output:** expected classification, observed behavior, fix plan, test cases.

## 7. Cron Endpoint Implementation Pattern

**Use when:** adding or modifying `/api/cron/*` routes.

**Workflow:**
1. Put job work in a standalone function.
2. Support GET with `x-vercel-cron: 1`.
3. Support manual auth via `CRON_SECRET`.
4. Include dry-run/test mode where safe.
5. Add dedupe, timeout budget, structured result, and logs.
6. Add verification commands.

**Output:** route checklist and code-review rubric.

## 8. Product Architecture Summarizer

**Use when:** docs disagree or a product flow has become hard to reason about.

**Workflow:**
1. Identify canonical source of truth.
2. Summarize tiers, routes, tables, endpoints, access gates, crons, and non-goals.
3. Mark current state vs target state.
4. List contradictions and migration path.

**Output:** architecture section ready to paste into docs.

## 9. Lessons-To-Runbook Builder

**Use when:** repeated mistakes in `tasks/lessons.md` need operational guardrails.

**Workflow:**
1. Extract the lesson, cause, affected files, and fixed pattern.
2. Turn it into a repeatable checklist.
3. Add "how to test" and "known traps."
4. Link to routes/scripts.

**Output:** runbook section with commands and acceptance criteria.

## 10. PRD/Spec Refinement Skill

**Use when:** converting rough feature ideas into implementation-ready docs.

**Required sections:** problem, audience, user flows, data model, endpoints, UI states, metrics, risks, rollout, test plan.

**Output:** concise PRD or technical spec with clear first milestone.

