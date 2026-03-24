# GovCon Giants - Current Tasks

## Session State (March 23, 2026)

### Just Completed - Alerts & Briefings System Overhaul

Made daily alerts and briefings FREE FOR EVERYONE during beta. Complete system improvements:

#### Alerts System
- [x] Removed paywall - all users get daily alerts free
- [x] Added deduplication (won't resend same opp in 7 days)
- [x] Added retry logic (3 attempts for failed emails)
- [x] Added timezone-aware delivery (~6 AM local time)
- [x] Added keywords search (catch mislabeled opportunities)
- [x] Added PSC crosswalk (auto-generate related PSC codes from NAICS)
- [x] Cleaned NAICS display (filter out non-numeric values)
- [x] Removed state filter (always search nationwide)
- [x] Added FREE PREVIEW banners to emails

#### Briefings System
- [x] Made free for everyone (pulls from both user_briefing_profile AND user_alert_settings)
- [x] Added deduplication (check briefing_log before sending)
- [x] Added retry logic (3 attempts within 3 days)
- [x] Added timezone-aware delivery (6-10 AM local time)
- [x] Added FREE PREVIEW banner to emails

#### Preferences Page Redesign
- [x] New frequency radio buttons: Daily / Weekly / Paused
- [x] New briefings section with opt-in checkbox
- [x] New keywords field for catching mislabeled opps
- [x] Clean NAICS codes (numeric only)
- [x] Removed state filter (nationwide by default)
- [x] FREE PREVIEW banners on both sections
- [x] Clear unsubscribe option

#### SQL Migrations Run
- `alerts-schema-update.sql` - timezone, retry_count, alert_type columns
- `briefings-schema-update.sql` - retry_count column
- `keywords-schema-update.sql` - keywords column

#### Cron Schedule (vercel.json)
| Job | Schedule (UTC) | Description |
|-----|----------------|-------------|
| send-briefings | 9 AM | Daily briefings |
| daily-alerts | 11 AM, 12 PM, 2 PM, 4 PM | Timezone coverage |
| weekly-alerts | 11 PM Sunday | Weekly digest |

### Pending
- [ ] Create JTED landing page with downloadable handout (`/jted`)
- [ ] Record demo video for /opp page
- [ ] Test profile tracking with real click interactions

---

## Previous Session Work

### Session 31 - Earlier (Mar 23, 2026)
- JTED Conference Presentation - Final Polish
- Full-size screenshots (hero treatment)
- A/E/C IDIQ restructure with Recompete Tracker data
- "What You'll Walk Away With" slide added

### Session 30 (Mar 20, 2026)
- Win Probability Scoring for Daily Briefings (0-100%)
- Rate Limiting & Abuse Detection (complete)
- Usage API Fix (real KV data)

### Session 29 (Mar 18, 2026)
- Alerts Signup Bug Fix
- Daily Health Check System (12 tests, 100% pass rate)
- Content Reaper Length Optimization

---

## Health Check Access
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

## Test URLs
```
Daily Alerts: https://tools.govcongiants.org/api/cron/daily-alerts?email=eric@govcongiants.com&test=true
Briefings: https://tools.govcongiants.org/api/cron/send-briefings?email=eric@govcongiants.com&test=true
Preferences: https://tools.govcongiants.org/alerts/preferences?email=eric@govcongiants.com
```

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume command:** `/continue`

**Last updated:** March 23, 2026 (Session 31)
