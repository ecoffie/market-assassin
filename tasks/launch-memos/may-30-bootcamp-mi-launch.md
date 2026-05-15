# Launch Memo: May 30 Bootcamp + MI Launch

**Date:** May 15, 2026
**Launch Date:** May 30, 2026
**Owner:** Eric Coffie
**Type:** Bootcamp + Market Intelligence Product Launch

---

## 1. Story So Far

### What changed in the business
- Transitioned from training-led monetization to **Market Intelligence software + high-touch services**
- Unified all tools under `/briefings` dashboard (Atlassian sidebar pattern)
- Simplified pricing: **MI Free ($0) → MI Pro ($149/mo)** only two public tiers
- Domain consolidation underway: `mi.govcongiants.com` → `getmindy.ai` (DNS pending)

### What the data says
- **9,647 total users** in notification system
- **14 "10-10" candidates** identified (score 85+) — ready for founder calls
- **65 unique purchasers** across all products
- Top spenders: Ultimate Bundle ($1,000-$1,546) customers showing high engagement
- Users with saved opportunities and positive feedback scoring highest

### What customers are telling us
- Daily briefings highly valued ("finally relevant intel, not generic training")
- Profile completion correlates with retention
- Ultimate Bundle buyers are most engaged (avg 110 engagement score)

### What has been shipped
- Customer Qualification Agent (purchase-based scoring)
- MI Growth Brief (behavioral signals)
- Launch Command Center (unified dashboard)
- Pre-computed briefing architecture (49 templates → 927 users)
- Unified sidebar navigation

### What problem is now urgent
- **Convert engaged free users to MI Pro** before bootcamp
- **Activate dormant bundle buyers** who haven't used their included MI access
- **Book founder calls** with 10-10 candidates before May 30

---

## 2. Strategic Thesis

> GovCon Giants is evolving from a training company to a **Market Intelligence platform**. The May 30 bootcamp marks the public transition where customers see how MI helps them find, evaluate, and pursue federal contracts — not just learn about them.

The bootcamp is the **conversion event**, not a training session. Every attendee should leave with:
1. An active MI profile
2. First briefing received
3. Understanding of Free → Pro upgrade path

---

## 3. Customer Segment

### Primary (for this launch)
| Segment | Count | Action |
|---------|-------|--------|
| **10-10 Candidates** | 14 | Eric founder calls before May 30 |
| **Activation Candidates** | 614 | Annelle/Sikander outreach |
| **Ultimate Bundle buyers** | 19 | Ensure MI access activated |

### Secondary
- MI Free users (show upgrade path at bootcamp)
- Bootcamp registrants (convert to MI Free minimum)
- Email list (awareness campaign)

### Excluded
- Comp/testimonial accounts (not paying customers)
- Unsubscribed users

---

## 4. Core Outcome

After May 30, customers should be able to:

1. **Find qualified opportunities** using their personalized NAICS profile
2. **Receive daily briefings** with AI-scored opportunities
3. **Track pursuits** in the Pipeline board
4. **Understand the value difference** between Free and Pro
5. **Know their upgrade path** and next step

---

## 5. Offer / Ask

### Before Bootcamp (May 15-29)
| Audience | Ask |
|----------|-----|
| 10-10 Candidates | Book founder call with Eric |
| Activation Candidates | Complete MI profile |
| Bundle Buyers | Activate included MI access |

### At Bootcamp (May 30)
| Audience | Ask |
|----------|-----|
| All attendees | Create MI Free account |
| Engaged attendees | Upgrade to MI Pro ($149/mo) |
| Enterprise prospects | Book white-glove consultation |

### Post Bootcamp (May 31+)
| Audience | Ask |
|----------|-----|
| Free users | Upgrade after 7-day trial |
| Pro users | Complete profile, refer partners |

---

## 6. Proof

### Customer Evidence
- **founder@siemable.com** (Score 110): $1,546 spent, multiple purchases, active briefings
- **hello@eganrose.com** (Score 110): Saved/tracked opportunities, positive feedback
- **sylwiak@hjgovcontractingcorp.com** (Score 110): Daily engagement with platform

### Platform Evidence
- 7,764 forecasts from 11 agencies
- 24,000+ cached SAM.gov opportunities
- 927 users receiving AI briefings
- Pre-computed templates reduce delivery to ~100ms/user

### Market Evidence
- $82B federal spend unclaimed in FY2025
- Small business set-aside targets increasing
- Competitors charge $500-2,000/mo for similar intel

---

## 7. Success Metrics

### Launch Week (May 30 - June 6)
| Metric | Target | Measurement |
|--------|--------|-------------|
| Bootcamp attendance | 500+ | GHL registration |
| MI Free signups | 200+ | Supabase `user_notification_settings` |
| MI Pro upgrades | 25+ | Stripe subscriptions |
| Profile completions | 150+ | Custom NAICS selected |
| Founder calls booked | 10+ | Calendly bookings |

### First 30 Days (June)
| Metric | Target | Measurement |
|--------|--------|-------------|
| Active MI Pro subscribers | 50+ | Stripe MRR |
| Daily briefing opens | 40%+ | Email analytics |
| Pipeline items created | 100+ | `user_pipeline` table |
| Positive feedback | 30+ | `briefing_feedback` table |

---

## 8. Team Roles

| Owner | Responsibility | Due |
|-------|---------------|-----|
| **Eric** | Founder calls with 10-10 candidates | May 29 |
| **Eric** | Bootcamp presentation and live demo | May 30 |
| **Branden** | Sales outreach to activation candidates | May 29 |
| **Branden** | Pro upgrade follow-up post-bootcamp | June 1 |
| **Annelle** | Profile completion outreach | May 25 |
| **Sikander** | Customer success follow-up | May 27 |
| **Zach** | Email sequence deployment | May 20 |
| **Ryan** | Social media campaign | May 22 |

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **getmindy.ai domain not ready** | HIGH | Use `mi.govcongiants.com` as fallback, update after launch |
| **Email deliverability issues** | MEDIUM | Test send 48 hours before, warm up domain |
| **Login/signup flow breaks** | LOW | QA all flows May 28 |
| **Attendees don't convert** | MEDIUM | Clear upgrade CTA, limited-time offer |
| **Founder calls not booked** | MEDIUM | Direct calendar links in outreach |

---

## 10. Decisions Needed

| Decision | Options | Owner | Due |
|----------|---------|-------|-----|
| Launch domain | `getmindy.ai` vs `mi.govcongiants.com` | Eric | May 20 |
| Bootcamp-only pricing? | $99 first month vs standard $149 | Eric | May 22 |
| Who sends founder call invites? | Eric direct vs Annelle warm-up | Eric | May 16 |
| White-glove pricing | $997/mo vs $1,497/mo | Eric | May 25 |

---

## 11. Next Actions

| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| Send founder call invites to 14 10-10 candidates | Eric | May 16 | Open |
| Export Annelle/Sikander outreach list | Claude | May 15 | **DONE** |
| Deploy email sequence for activation candidates | Zach | May 20 | Open |
| QA all signup/login flows | Branden | May 28 | Open |
| Prepare bootcamp slides with MI demo | Eric | May 27 | Open |
| Configure `getmindy.ai` DNS | Eric | May 20 | Blocked |
| Update email templates with correct domain CTAs | Claude | — | Blocked on DNS |
| Create bootcamp follow-up email sequence | Zach | May 25 | Open |
| Brief sales team on 10-10 strategy | Eric | May 18 | Open |

---

## Appendix: Qualified Customer Lists

### Eric's Founder Call List (14 contacts)
See: `data/eric-founder-calls-20260515.csv`

Top 3:
1. founder@siemable.com (Score 110, $1,546 spent)
2. hello@eganrose.com (Score 110, $1,000 spent)
3. sylwiak@hjgovcontractingcorp.com (Score 110, $1,000 spent)

### Annelle/Sikander Outreach List (14 contacts)
See: `data/annelle-sikander-outreach-list-20260515.csv`

All 14 contacts are 10-10 candidates with score 85+ recommended for deep investment.

---

*Generated: May 15, 2026*
