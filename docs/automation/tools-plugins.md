# Tools And Plugins

These are the top integrations needed to make the skills and agents reliable.

## 1. Supabase Ops Tool

**Purpose:** safely inspect and repair operational state.

**Capabilities:**
- Query `user_notification_settings`, `user_business_profiles`, `alert_log`, `briefing_log`, `briefing_templates`, `briefing_precompute_runs`, `tool_errors`, `briefing_dead_letter`.
- Return audience counts, missing profiles, send totals, recent failures, stale templates.
- Support dry-run repair previews before writes.

**First endpoints:**
- `get_user_notification_profile(email)`
- `get_delivery_summary(date, tool)`
- `find_profile_gaps(tier)`
- `preview_access_repair(email, expectedTier)`

## 2. Stripe Entitlement Tool

**Purpose:** resolve paid status and compare it to app access.

**Capabilities:**
- Lookup customer by email.
- List active subscriptions/products.
- Map Stripe products to expected tier.
- Compare Stripe to KV and Supabase flags.
- Produce repair plan without writing by default.

**First endpoints:**
- `lookup_customer(email)`
- `get_entitlement_expectation(email)`
- `compare_entitlement_state(email)`

## 3. Resend/Email Metrics Tool

**Purpose:** measure campaign and operational email delivery.

**Capabilities:**
- Retrieve send/open/click/bounce/complaint by tag, campaign, or email.
- Summarize daily campaign metrics.
- Identify deliverability problems.
- Feed campaign end-of-day reports.

**First endpoints:**
- `get_campaign_metrics(campaignIdOrTag, dateRange)`
- `get_email_delivery(email, dateRange)`
- `summarize_bounces(dateRange)`

## 4. SAM/NAICS Matching Tool

**Purpose:** debug and explain opportunity matching.

**Capabilities:**
- Infer NAICS from free-text business descriptions.
- Search SAM cache by exact NAICS, prefix, keyword, state, notice type.
- Score and explain why opportunities ranked.
- Produce regression fixtures for onboarding/sample picker.

**First endpoints:**
- `infer_naics(description)`
- `search_ranked_samples(description, state?)`
- `explain_match(profile, opportunityId)`

## 5. GitHub/Vercel Deployment Health Tool

**Purpose:** connect code/deploy state to operational incidents.

**Capabilities:**
- Check latest deployment status.
- Fetch failed build/check logs.
- Confirm production env vars are present by name.
- Smoke test public/admin endpoints.
- Compare recent deploy timestamp against incident window.

**First endpoints:**
- `get_latest_deploy()`
- `check_endpoint(url, expectedStatus)`
- `summarize_recent_changes(pathOrArea)`

