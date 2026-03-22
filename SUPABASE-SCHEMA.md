# Market Assassin - Supabase Schema Reference

Complete database schema documentation for the Market Assassin platform.

---

## Overview

- **Instance:** Separate from govcon-shop (they do NOT share tables)
- **URL:** Set in `NEXT_PUBLIC_SUPABASE_URL`
- **Auth:** Service role key for webhooks/admin, anon key for client

---

## Core Tables

### `user_profiles`

Primary user table with access flags for all products.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `email` | TEXT | User email (unique, primary lookup) |
| `name` | TEXT | User display name |
| `stripe_customer_id` | TEXT | Stripe customer ID |
| `access_hunter_pro` | BOOLEAN | Opportunity Hunter Pro access |
| `access_content_standard` | BOOLEAN | Content Reaper (Engine) access |
| `access_content_full_fix` | BOOLEAN | Content Reaper (Full Fix) access |
| `access_assassin_standard` | BOOLEAN | Market Assassin Standard access |
| `access_assassin_premium` | BOOLEAN | Market Assassin Premium access |
| `access_recompete` | BOOLEAN | Recompete Tracker access |
| `access_contractor_db` | BOOLEAN | Federal Contractor Database access |
| `access_daily_briefings` | BOOLEAN | Daily briefing access (default: TRUE) |
| `access_briefing_chat` | BOOLEAN | Briefing AI chat access |
| `briefing_tier` | TEXT | Tier: free, paid, ma_standard, ma_premium |
| `license_key` | TEXT | License key (XXXX-XXXX-XXXX-XXXX format) |
| `license_activated_at` | TIMESTAMPTZ | When license was activated |
| `bundle` | TEXT | Bundle name if purchased |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Auto-updated timestamp |

**Indexes:** `email`, `license_key`

---

### `purchases`

Stripe transaction records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to auth.users (optional) |
| `email` | TEXT | Customer email |
| `stripe_session_id` | TEXT | Stripe checkout session ID (unique) |
| `stripe_customer_id` | TEXT | Stripe customer ID |
| `product_id` | TEXT | Stripe price ID |
| `product_name` | TEXT | Product description |
| `tier` | TEXT | Product tier (hunter_pro, assassin_premium, etc.) |
| `bundle` | TEXT | Bundle name if bundle purchase |
| `amount` | DECIMAL | Amount paid |
| `currency` | TEXT | Currency code (default: usd) |
| `status` | TEXT | Purchase status |
| `purchased_at` | TIMESTAMPTZ | Purchase timestamp |
| `metadata` | JSONB | Additional Stripe metadata |

**Indexes:** `email`, `user_id`, `stripe_session_id`, `product_id`, `tier`, `(email, product_id)`

---

## Briefings Tables

### `user_search_history`

Captures all user searches across tools for auto-building watchlists.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email |
| `tool` | TEXT | Tool name (market_assassin, recompete, etc.) |
| `search_type` | TEXT | Type: naics, agency, keyword, company, zip, contract |
| `search_value` | TEXT | The search value |
| `search_metadata` | JSONB | Full search params |
| `created_at` | TIMESTAMPTZ | Search timestamp |

**Indexes:** `user_email`, `tool`, `search_type`, `created_at DESC`, `(user_email, search_type)`

---

### `user_briefing_profile`

Aggregated watchlist from search history + user preferences.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email (unique) |
| `aggregated_profile` | JSONB | Full aggregated profile |
| `naics_codes` | TEXT[] | Watched NAICS codes |
| `agencies` | TEXT[] | Watched agencies |
| `zip_codes` | TEXT[] | Watched ZIP codes |
| `keywords` | TEXT[] | Watched keywords |
| `watched_companies` | TEXT[] | Watched companies |
| `watched_contracts` | TEXT[] | Watched contracts |
| `naics_weights` | JSONB | NAICS search frequency weights |
| `agency_weights` | JSONB | Agency search frequency weights |
| `company_weights` | JSONB | Company search frequency weights |
| `preferences` | JSONB | Delivery preferences |
| `timezone` | TEXT | User timezone (default: America/New_York) |
| `email_frequency` | TEXT | daily, weekly, or none |
| `sms_enabled` | BOOLEAN | SMS notifications enabled |
| `phone_number` | TEXT | Phone number for SMS |
| `preferred_delivery_hour` | INTEGER | Hour in user's timezone (0-23) |
| `manual_naics` | TEXT[] | Manually added NAICS |
| `manual_agencies` | TEXT[] | Manually added agencies |
| `manual_companies` | TEXT[] | Manually added companies |
| `last_search_sync` | TIMESTAMPTZ | Last aggregation time |
| `search_count` | INTEGER | Total searches |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Updated timestamp |

---

### `briefing_subscriptions`

Stripe subscription tracking for $19/mo briefings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email (unique) |
| `stripe_subscription_id` | TEXT | Stripe subscription ID |
| `stripe_customer_id` | TEXT | Stripe customer ID |
| `status` | TEXT | trialing, active, cancelled, past_due, unpaid |
| `tier` | TEXT | free, paid, ma_standard, ma_premium |
| `trial_started_at` | TIMESTAMPTZ | Trial start |
| `trial_ends_at` | TIMESTAMPTZ | Trial end |
| `current_period_start` | TIMESTAMPTZ | Current billing period start |
| `current_period_end` | TIMESTAMPTZ | Current billing period end |
| `cancel_at_period_end` | BOOLEAN | Canceling at period end |
| `cancelled_at` | TIMESTAMPTZ | Cancellation timestamp |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Updated timestamp |

---

### `briefing_log`

Tracks every briefing sent (for analytics + chatbot context).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email |
| `briefing_date` | DATE | Briefing date |
| `briefing_content` | JSONB | Full structured briefing data |
| `briefing_html` | TEXT | Rendered email HTML |
| `briefing_sms` | TEXT | SMS text version |
| `email_sent_at` | TIMESTAMPTZ | Email send timestamp |
| `sms_sent_at` | TIMESTAMPTZ | SMS send timestamp |
| `delivery_status` | TEXT | pending, sent, delivered, bounced, failed |
| `email_opened_at` | TIMESTAMPTZ | Email open timestamp |
| `email_clicked_at` | TIMESTAMPTZ | Email click timestamp |
| `click_count` | INTEGER | Total clicks |
| `items_count` | INTEGER | Items in briefing |
| `tools_included` | TEXT[] | Tools included in briefing |
| `error_message` | TEXT | Error message if failed |
| `retry_count` | INTEGER | Retry attempts |
| `created_at` | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** `(user_email, briefing_date)`

---

### `briefing_snapshots`

Daily data snapshots per user per tool for change detection.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email |
| `snapshot_date` | DATE | Snapshot date |
| `tool` | TEXT | Tool name |
| `raw_data` | JSONB | Raw data from source |
| `diff_data` | JSONB | Diff vs previous day |
| `item_count` | INTEGER | Items in snapshot |
| `diff_count` | INTEGER | Changed items |
| `processed_at` | TIMESTAMPTZ | Processing timestamp |
| `created_at` | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** `(user_email, snapshot_date, tool)`

---

### `web_intelligence_cache`

Shared cache for web search results (expires after 24 hours).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `cache_key` | TEXT | MD5 hash of query (unique) |
| `query` | TEXT | Search query |
| `query_type` | TEXT | agency_naics, competitor, contract, teaming, budget, newsroom |
| `raw_results` | JSONB | Raw search results |
| `filtered_results` | JSONB | AI-filtered results |
| `relevance_scores` | JSONB | Scores per result |
| `source` | TEXT | serper, playwright, rss |
| `result_count` | INTEGER | Number of results |
| `fetched_at` | TIMESTAMPTZ | Fetch timestamp |
| `expires_at` | TIMESTAMPTZ | Expiration time (default: +24 hours) |
| `hit_count` | INTEGER | Cache hits |
| `created_at` | TIMESTAMPTZ | Created timestamp |

---

## Alerts Tables

### `user_alert_settings`

Alert preferences for MA Premium users.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email (unique) |
| `naics_codes` | TEXT[] | NAICS codes for alerts |
| `business_type` | TEXT | SDVOSB, 8a, WOSB, HUBZone, etc. |
| `target_agencies` | TEXT[] | Target agencies |
| `location_state` | TEXT | State filter |
| `location_zip` | TEXT | ZIP filter |
| `alert_frequency` | TEXT | weekly or paused |
| `alert_day` | TEXT | Day of week for weekly alerts |
| `subscription_status` | TEXT | active, canceled |
| `last_alert_sent` | TIMESTAMPTZ | Last alert timestamp |
| `last_alert_count` | INTEGER | Opportunities in last alert |
| `total_alerts_sent` | INTEGER | Total alerts sent |
| `is_active` | BOOLEAN | Alert active status |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Updated timestamp |

---

### `alert_log`

Delivery tracking for weekly opportunity alerts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | User email |
| `alert_date` | DATE | Alert date |
| `opportunities_count` | INTEGER | Opportunities included |
| `opportunities_data` | JSONB | Opportunity summaries |
| `sent_at` | TIMESTAMPTZ | Send timestamp |
| `delivery_status` | TEXT | pending, sent, delivered, bounced, failed |
| `opened_at` | TIMESTAMPTZ | Open timestamp |
| `clicked_at` | TIMESTAMPTZ | Click timestamp |
| `upgraded_to_briefings` | BOOLEAN | User upgraded to briefings |
| `error_message` | TEXT | Error message if failed |
| `created_at` | TIMESTAMPTZ | Created timestamp |

**Unique constraint:** `(user_email, alert_date)`

---

## Action Planner Tables

### `user_plans`

User task tracking for Action Planner.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | TEXT | User identifier |
| `phase_id` | INTEGER | Phase number |
| `task_id` | TEXT | Task identifier |
| `completed` | BOOLEAN | Task completed |
| `notes` | TEXT | User notes |
| `due_date` | TIMESTAMPTZ | Due date |
| `title` | TEXT | Task title |
| `description` | TEXT | Task description |
| `priority` | TEXT | high, medium, low |
| `sort_order` | INTEGER | Display order |
| `is_custom` | BOOLEAN | User-created task |
| `link` | TEXT | External link |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Updated timestamp |

**Unique constraint:** `(user_id, task_id)`

---

### `planner_gamification`

Gamification tracking for Action Planner.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | TEXT | User identifier (unique) |
| `current_streak` | INTEGER | Current completion streak |
| `longest_streak` | INTEGER | Longest streak achieved |
| `last_completion_date` | DATE | Last task completion |
| `badges` | JSONB | Earned badges |
| `onboarding_completed` | BOOLEAN | Onboarding walkthrough done |
| `created_at` | TIMESTAMPTZ | Created timestamp |
| `updated_at` | TIMESTAMPTZ | Updated timestamp |

---

## Database Functions

| Function | Description |
|----------|-------------|
| `get_user_briefing_tier(email)` | Returns effective tier (considers subscription + tool ownership) |
| `get_user_briefing_sections(email)` | Returns accessible briefing sections based on owned tools |
| `aggregate_search_to_profile(email)` | Aggregates search history into briefing profile |
| `clean_expired_web_cache()` | Cleans expired web cache entries |
| `update_user_profiles_updated_at()` | Trigger function for updated_at |
| `update_briefing_profile_updated_at()` | Trigger function for updated_at |
| `update_alert_settings_updated_at()` | Trigger function for updated_at |
| `update_updated_at_column()` | Generic updated_at trigger |

---

## Analytics Views

| View | Description |
|------|-------------|
| `briefing_delivery_stats` | Daily briefing delivery metrics (sent, opened, clicked, rates) |
| `user_briefing_engagement` | Per-user engagement stats |

---

## Row Level Security (RLS)

All tables have RLS enabled with these standard policies:
- **Service role:** Full access (for webhooks and admin)
- **Public insert:** Allowed (for webhook creating records)
- **Public select:** Allowed by email match
- **Public update:** Allowed by email match

---

## Schema Files

Located in `src/lib/supabase/`:

| File | Tables |
|------|--------|
| `user-profiles-schema.sql` | `user_profiles` |
| `purchases-schema-v2.sql` | `purchases` |
| `briefings-schema.sql` | All briefing tables + functions |
| `alerts-schema.sql` | `user_alert_settings`, `alert_log` |
| `planner-schema.sql` | `user_plans`, `planner_gamification` |

---

*Last Updated: March 20, 2026*
