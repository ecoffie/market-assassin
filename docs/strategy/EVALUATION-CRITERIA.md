# Evaluation Criteria

Every feature ships with evaluation criteria. Define success before building, verify against it before shipping.

---

## Template

```markdown
## [Feature Name] - Evaluation Criteria

**Ship Date:** YYYY-MM-DD
**Status:** Draft | Testing | Passed | Failed

### Functional Requirements
- [ ] [Core functionality works as specified]
- [ ] [Edge cases handled]
- [ ] [Error states handled gracefully]

### Integration Requirements
- [ ] [Connects to required services]
- [ ] [Data flows correctly between systems]
- [ ] [No breaking changes to existing features]

### Security & Access
- [ ] [Access control enforced correctly]
- [ ] [No sensitive data exposed]
- [ ] [Rate limiting in place (if applicable)]

### User Experience
- [ ] [Clear feedback on success/failure]
- [ ] [Mobile responsive (if UI)]
- [ ] [Loading states present]

### Monitoring & Logging
- [ ] [Errors logged with context]
- [ ] [Key actions trackable]
- [ ] [Alerting configured (if critical path)]

### Verification Steps
1. [Step-by-step test procedure]
2. [Expected outcomes]
3. [How to verify in production]
```

---

## Saved Search Alerts - Evaluation Criteria

**Ship Date:** 2026-03-14
**Status:** Testing

### Functional Requirements
- [ ] MA Premium user runs report → alert profile saved automatically
- [ ] Weekly cron executes every Sunday at 6 PM ET
- [ ] SAM.gov query returns opportunities from last 7 days
- [ ] Only actionable types queried: presolicitation, sources sought, combined, solicitation
- [ ] Opportunities filtered by user's NAICS codes
- [ ] Opportunities filtered by user's business type (set-aside)
- [ ] Top 15 opportunities ranked by relevance score
- [ ] Email sent with opportunity list
- [ ] Email contains Briefings upgrade CTA
- [ ] Unsubscribe link works (one-click, CAN-SPAM compliant)
- [ ] Preferences endpoint allows pausing/resuming alerts

### Integration Requirements
- [ ] SAM.gov API returns valid data (SAM_API_KEY configured)
- [ ] Supabase tables created (user_alert_settings, alert_log)
- [ ] Email sends via nodemailer (SMTP credentials configured)
- [ ] Vercel cron triggers correctly
- [ ] Alert log records delivery status

### Security & Access
- [ ] Only MA Premium users get alerts (access_assassin_premium = true)
- [ ] Save-profile endpoint verifies Premium access
- [ ] Unsubscribe works without authentication (CAN-SPAM requirement)
- [ ] No PII exposed in logs

### User Experience
- [ ] Email renders correctly in Gmail, Outlook, Apple Mail
- [ ] Opportunity links go to correct SAM.gov pages
- [ ] Urgency badges show for opportunities due soon
- [ ] Unsubscribe page confirms action clearly

### Monitoring & Logging
- [ ] Cron logs: users processed, sent, skipped, failed
- [ ] Individual send errors logged with user email
- [ ] alert_log table tracks delivery_status per email

### Verification Steps

**1. Manual Test - Save Profile**
```bash
curl -X POST https://shop.govcongiants.org/api/alerts/save-profile \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","naicsCodes":["541511"],"businessType":"SDVOSB","targetAgencies":["DoD"]}'
```
Expected: 403 (no Premium access) or 200 with profile saved

**2. Manual Test - Check Profile**
```bash
curl "https://shop.govcongiants.org/api/alerts/save-profile?email=test@example.com"
```
Expected: Profile data or null

**3. Manual Test - Trigger Cron (Dry Run)**
```bash
curl "https://shop.govcongiants.org/api/cron/weekly-alerts?email=YOUR_EMAIL"
```
Expected: User profile details

**4. Manual Test - Unsubscribe**
```bash
curl "https://shop.govcongiants.org/api/alerts/unsubscribe?email=test@example.com"
```
Expected: HTML confirmation page

**5. Production Verification (After Sunday Cron)**
- Check alert_log table for new entries
- Verify email received by test user
- Check email renders correctly
- Verify links work

### Sign-Off

| Check | Verified By | Date |
|-------|-------------|------|
| All functional requirements pass | | |
| Email renders correctly | | |
| Cron executes successfully | | |
| Unsubscribe works | | |

---

## [Next Feature] - Evaluation Criteria

*Copy template above for each new feature*

---

*Last Updated: March 14, 2026*
