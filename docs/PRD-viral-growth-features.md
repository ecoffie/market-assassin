# PRD: Viral Growth Features for Market Intelligence

**Product:** GovCon Giants Market Intelligence
**Author:** Claude + Eric
**Date:** April 20, 2026
**Status:** Planning
**Priority:** P0 (Critical for Growth)

---

## Executive Summary

Implement viral growth mechanisms to enable user-driven acquisition. Goal: Each user brings 0.3+ new users (viral coefficient), reducing CAC and accelerating beta testing.

**Success Metrics:**
- Viral coefficient (K) > 0.3 within 30 days
- 20%+ of new signups from referrals within 60 days
- Share-to-signup conversion rate > 5%

---

## Feature 1: Share Opportunity Button + Public Page

### Overview
Allow users to share individual opportunities with teaming partners or colleagues via a public URL. The recipient sees the opportunity and a CTA to sign up for their own briefings.

### User Story
> As a contractor reviewing my daily briefing, I want to share a relevant opportunity with a potential teaming partner so they can see it and potentially join the platform.

### Requirements

#### 1.1 Share Button UI
| Requirement | Details |
|-------------|---------|
| Location | Each opportunity card in briefings dashboard |
| Button text | "Share" with share icon |
| Click action | Opens share modal with copy-able link |
| Fallback | Native share API on mobile if available |

#### 1.2 Share Link Generation
| Requirement | Details |
|-------------|---------|
| URL format | `tools.govcongiants.org/shared/opp/{shareId}` |
| Share ID | 8-character alphanumeric (e.g., `Ab3xK9mZ`) |
| Expiration | Never (opportunities may close but link persists) |
| Tracking | Store sharer email, opportunity ID, timestamp |

#### 1.3 Public Opportunity Page
| Requirement | Details |
|-------------|---------|
| Header | "Shared by [Company Name or 'a GovCon professional']" |
| Content | Full opportunity details (title, agency, NAICS, deadline, description) |
| CTA | "Get opportunities like this delivered to YOUR inbox" |
| CTA button | Links to `/briefings` with `?ref={shareId}` |
| Expired handling | Show "This opportunity has closed" + still show signup CTA |

#### 1.4 Database Schema
```sql
CREATE TABLE opportunity_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id VARCHAR(8) UNIQUE NOT NULL,
  sharer_email VARCHAR(255) NOT NULL,
  sharer_company VARCHAR(255),
  opportunity_id VARCHAR(255) NOT NULL,
  opportunity_title TEXT,
  opportunity_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  view_count INT DEFAULT 0,
  signup_count INT DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);

CREATE INDEX idx_shares_share_id ON opportunity_shares(share_id);
CREATE INDEX idx_shares_sharer ON opportunity_shares(sharer_email);
```

### API Endpoints

#### POST /api/share/opportunity
Create a share link for an opportunity.

**Request:**
```json
{
  "email": "user@company.com",
  "companyName": "ABC Consulting",
  "opportunity": {
    "id": "abc123",
    "title": "Cybersecurity Services",
    "agency": "Department of Defense",
    "naics": "541512",
    "deadline": "2026-05-15",
    "description": "..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "shareUrl": "https://tools.govcongiants.org/shared/opp/Ab3xK9mZ",
  "shareId": "Ab3xK9mZ"
}
```

#### GET /api/share/opportunity/{shareId}
Retrieve opportunity data for public page.

**Response:**
```json
{
  "success": true,
  "opportunity": { ... },
  "sharedBy": "ABC Consulting",
  "sharedAt": "2026-04-20T10:00:00Z"
}
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| SH-001 | Click share button on opportunity | Modal opens with share link | P0 |
| SH-002 | Copy link to clipboard | Link copied, toast confirmation | P0 |
| SH-003 | Open share link (not logged in) | Public page loads with opportunity | P0 |
| SH-004 | Open share link (logged in) | Public page loads, no duplicate signup CTA | P1 |
| SH-005 | Click "Get opportunities" CTA | Redirects to /briefings?ref={shareId} | P0 |
| SH-006 | Share link for expired opportunity | Shows "closed" message + signup CTA | P1 |
| SH-007 | Same opportunity shared twice by same user | Returns same share link | P1 |
| SH-008 | View count increments on page load | view_count increases by 1 | P1 |
| SH-009 | Mobile: Native share API works | Native share sheet opens | P2 |
| SH-010 | Invalid shareId in URL | 404 page with signup CTA | P1 |

---

## Feature 2: Referral Link Tracking

### Overview
Track when shared links result in new user signups. Attribute conversions to the referrer for rewards program.

### User Story
> As a user who shared opportunities, I want to see how many people signed up from my shares so I can track my impact and earn rewards.

### Requirements

#### 2.1 Referral Attribution
| Requirement | Details |
|-------------|---------|
| URL parameter | `?ref={shareId}` or `?ref={userRefCode}` |
| Cookie duration | 30 days |
| Attribution model | First-touch (first referrer gets credit) |
| Storage | Store ref code in localStorage + cookie |

#### 2.2 User Referral Codes
| Requirement | Details |
|-------------|---------|
| Code format | 6-character alphanumeric tied to user |
| Generation | Auto-generated on first share or profile view |
| Uniqueness | Unique per user, never changes |

#### 2.3 Conversion Tracking
| Requirement | Details |
|-------------|---------|
| Conversion event | User completes signup (adds NAICS codes) |
| Attribution window | 30 days from click |
| Data captured | Referrer email, referred email, source (share/direct link) |

#### 2.4 Database Schema
```sql
CREATE TABLE user_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_email VARCHAR(255) NOT NULL,
  referrer_code VARCHAR(8) NOT NULL,
  referred_email VARCHAR(255) NOT NULL,
  source_type VARCHAR(50), -- 'opportunity_share', 'direct_link', 'email'
  source_id VARCHAR(255), -- shareId if from opportunity share
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  signed_up_at TIMESTAMPTZ,
  converted BOOLEAN DEFAULT FALSE,
  reward_granted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_notification_settings
ADD COLUMN referral_code VARCHAR(8) UNIQUE,
ADD COLUMN referred_by VARCHAR(255),
ADD COLUMN referral_count INT DEFAULT 0;
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| RF-001 | Visit /briefings?ref=ABC123 | Ref code stored in localStorage | P0 |
| RF-002 | Sign up after clicking ref link | Referral attributed to referrer | P0 |
| RF-003 | Sign up 31 days after clicking ref link | No attribution (expired) | P1 |
| RF-004 | Click multiple ref links, then sign up | First referrer gets credit | P1 |
| RF-005 | View own referral code in settings | Code displayed with share link | P1 |
| RF-006 | Referral count updates on conversion | referral_count increments | P0 |

---

## Feature 3: "Shared by [Company]" Branding

### Overview
Display attribution on shared opportunity pages to build trust and encourage sharing.

### Requirements

#### 3.1 Branding Display
| Requirement | Details |
|-------------|---------|
| Location | Top of public opportunity page |
| Format | "📤 Shared by {Company Name}" or "📤 Shared by a GovCon professional" |
| Fallback | If no company name, use generic text |
| Optional | User can opt-out of name display in settings |

#### 3.2 Company Name Collection
| Requirement | Details |
|-------------|---------|
| Source | user_notification_settings.company_name |
| Prompt | Ask for company name in onboarding wizard |
| Update | Editable in settings panel |

#### 3.3 Database Update
```sql
ALTER TABLE user_notification_settings
ADD COLUMN company_name VARCHAR(255),
ADD COLUMN share_attribution BOOLEAN DEFAULT TRUE;
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| BR-001 | Share with company name set | "Shared by {Company}" shows | P0 |
| BR-002 | Share without company name | "Shared by a GovCon professional" shows | P0 |
| BR-003 | User opts out of attribution | Generic text shows | P1 |
| BR-004 | Update company name in settings | Future shares use new name | P1 |

---

## Feature 4: Public Weekly Insights Pages (SEO)

### Overview
Auto-generate public, SEO-indexed pages showing weekly opportunity summaries by NAICS code. Drives organic traffic and signups.

### User Story
> As a contractor searching Google for "541512 government contracts this week", I want to find a summary page that shows me opportunities and encourages me to sign up for alerts.

### Requirements

#### 4.1 Page Generation
| Requirement | Details |
|-------------|---------|
| URL format | `/insights/{naics}-{slug}-{week}` (e.g., `/insights/541512-cybersecurity-2026-w16`) |
| Frequency | Generated weekly on Sunday |
| Content | Top 10 opportunities for that NAICS code |
| SEO | Meta title, description, schema markup |

#### 4.2 Page Content
| Section | Details |
|---------|---------|
| Header | "{NAICS Name} Federal Opportunities - Week of {Date}" |
| Stats | "X new opportunities this week, $Y total value" |
| List | Top 10 opportunities (title, agency, deadline) |
| CTA | "Get these delivered to your inbox - FREE" |
| Footer | Related NAICS pages, signup form |

#### 4.3 SEO Requirements
| Requirement | Details |
|-------------|---------|
| Title tag | "{NAICS Code} Government Contracts - Week {N} 2026 \| GovCon Giants" |
| Meta description | "View {X} new federal opportunities for {NAICS Name}. Contracts from {agencies}. Deadlines {date range}." |
| Schema | JobPosting or Government service schema |
| Sitemap | Auto-add new pages to sitemap.xml |
| Canonical | Self-referencing canonical URL |

#### 4.4 Database Schema
```sql
CREATE TABLE public_insights_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  naics_code VARCHAR(10) NOT NULL,
  naics_name VARCHAR(255),
  week_number INT NOT NULL,
  year INT NOT NULL,
  slug VARCHAR(255) NOT NULL,
  opportunities JSONB NOT NULL,
  stats JSONB,
  meta_title VARCHAR(255),
  meta_description TEXT,
  view_count INT DEFAULT 0,
  signup_count INT DEFAULT 0,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(naics_code, week_number, year)
);
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| SEO-001 | Visit insights page | Page loads with opportunities | P0 |
| SEO-002 | Check meta tags | Title, description present | P0 |
| SEO-003 | Google can crawl page | No noindex, robots.txt allows | P1 |
| SEO-004 | Click signup CTA | Redirects to /briefings with NAICS pre-filled | P0 |
| SEO-005 | View count increments | view_count increases | P2 |
| SEO-006 | Old week pages still accessible | Historical pages work | P1 |
| SEO-007 | Invalid NAICS in URL | 404 or redirect to search | P1 |

---

## Feature 5: Referral Rewards Program

### Overview
Incentivize sharing by rewarding users who bring new signups with premium features.

### User Story
> As an active user, I want to earn rewards for referring colleagues so I get premium features for free.

### Requirements

#### 5.1 Reward Tiers
| Referrals | Reward |
|-----------|--------|
| 1 | "Referral Champion" badge |
| 3 | 1 month FREE Market Intelligence ($49 value) |
| 5 | 2 months FREE Market Intelligence |
| 10 | Lifetime BD Assist access ($199/mo value) |
| 25 | Lifetime ALL tools access |

#### 5.2 Reward Mechanics
| Requirement | Details |
|-------------|---------|
| Qualification | Referred user must complete profile (add NAICS) |
| Notification | Email when referral converts |
| Dashboard | "Your Referrals" section in settings |
| Progress | Show "3 of 5 referrals for next reward" |

#### 5.3 Reward Fulfillment
| Requirement | Details |
|-------------|---------|
| Auto-apply | Free months auto-extend subscription |
| Manual | Lifetime rewards require admin approval |
| Tracking | Log all rewards granted |

#### 5.4 Database Schema
```sql
CREATE TABLE referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email VARCHAR(255) NOT NULL,
  reward_tier VARCHAR(50) NOT NULL,
  reward_description TEXT,
  referral_count_at_grant INT,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ
);
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| RW-001 | 1st referral converts | Badge granted, email sent | P0 |
| RW-002 | 3rd referral converts | 1 month free granted | P0 |
| RW-003 | View referral progress | Shows current/next tier | P0 |
| RW-004 | Referral dashboard shows history | All referrals listed | P1 |
| RW-005 | Free month auto-applied | Subscription extended | P0 |
| RW-006 | Lifetime reward requires approval | Not auto-applied | P1 |

---

## Feature 6: Find Teaming Partners (Network Effect)

### Overview
Allow users to discover other contractors for teaming opportunities, creating network effects that drive signups.

### User Story
> As a small business looking for an 8(a) teaming partner with cybersecurity capabilities, I want to find matching contractors on the platform so we can team on opportunities together.

### Requirements

#### 6.1 Profile Fields for Discovery
| Field | Details |
|-------|---------|
| Company name | Required for discovery |
| NAICS codes | From existing profile |
| Certifications | 8(a), WOSB, SDVOSB, HUBZone, etc. |
| Capabilities | Free text or tags |
| Teaming interest | "Open to teaming" toggle |
| Contact preference | Email, phone, or in-app message |

#### 6.2 Search/Discovery
| Requirement | Details |
|-------------|---------|
| Search by | NAICS, certification, keywords |
| Results | Company name, certifications, NAICS overlap |
| Contact | "Request to Connect" button |
| Privacy | Only show users who opt-in to discovery |

#### 6.3 Connection Flow
1. User A searches for teaming partners
2. User A clicks "Request to Connect" on User B
3. User B receives email: "{Company A} wants to team with you"
4. User B clicks to view request (if not a user, prompted to sign up)
5. User B accepts/declines connection

#### 6.4 Database Schema
```sql
ALTER TABLE user_notification_settings
ADD COLUMN open_to_teaming BOOLEAN DEFAULT FALSE,
ADD COLUMN certifications TEXT[],
ADD COLUMN capabilities TEXT,
ADD COLUMN contact_phone VARCHAR(20);

CREATE TABLE teaming_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email VARCHAR(255) NOT NULL,
  target_email VARCHAR(255) NOT NULL,
  opportunity_id VARCHAR(255), -- optional, specific opp context
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, declined
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
```

### QA/QC Test Cases

| Test ID | Test Case | Expected Result | Priority |
|---------|-----------|-----------------|----------|
| TM-001 | Enable "Open to teaming" | Profile discoverable | P0 |
| TM-002 | Search by NAICS | Matching profiles shown | P0 |
| TM-003 | Search by certification | Filtered results | P0 |
| TM-004 | Send connection request | Email sent to target | P0 |
| TM-005 | Accept connection | Both parties notified | P0 |
| TM-006 | Decline connection | Requester notified | P1 |
| TM-007 | Non-user receives request | Signup CTA in email | P0 |
| TM-008 | Disable "Open to teaming" | Profile hidden from search | P1 |

---

## Implementation Priority

| Phase | Features | Effort | Impact |
|-------|----------|--------|--------|
| **Phase 1** | Share Button + Public Page | 3-4 hours | High |
| **Phase 2** | Referral Link Tracking | 2 hours | High |
| **Phase 3** | "Shared by" Branding | 1 hour | Medium |
| **Phase 4** | Public Insights Pages (SEO) | 4-5 hours | High |
| **Phase 5** | Referral Rewards Program | 3 hours | High |
| **Phase 6** | Teaming Partner Discovery | 6-8 hours | Very High |

---

## Success Metrics

| Metric | Target (30 days) | Target (90 days) |
|--------|------------------|------------------|
| Share button clicks | 100 | 500 |
| Public page views | 300 | 2,000 |
| Signups from shares | 30 | 200 |
| Viral coefficient (K) | 0.2 | 0.4 |
| Organic traffic (SEO pages) | 100 | 1,000 |
| Teaming connections | - | 50 |

---

## Open Questions

1. Should we allow sharing entire briefings or just individual opportunities?
2. What's the minimum profile completion for referral to "count"?
3. Should SEO pages be generated for all NAICS or only popular ones?
4. How do we handle teaming requests for non-users (privacy)?
5. Should we gamify with leaderboards for top referrers?

---

## Appendix: Competitor Analysis

| Product | Viral Mechanism | Notes |
|---------|-----------------|-------|
| Calendly | Every meeting link is product exposure | Built into core use case |
| Dropbox | Storage rewards for referrals | 4M users in 15 months |
| Slack | Team invites required for value | Network effect |
| Loom | Every video has "Make your own" CTA | Passive exposure |

---

*Last Updated: April 20, 2026*
