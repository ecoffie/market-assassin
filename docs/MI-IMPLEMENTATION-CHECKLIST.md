# MI Unified Product Implementation Checklist

**Created:** May 4, 2026
**Status:** Active
**Reference:** `docs/strategy/DOMAIN-BRAND-CONSOLIDATION.md`, `docs/strategy/MI-UNIFIED-PRODUCT-ARCHITECTURE.md`

---

## Overview

This checklist tracks all work needed to consolidate to the unified MI product model:
- MI Free: Opportunity Hunter + Daily Alerts ($0)
- MI Pro: Full intelligence stack ($149/mo, $49/mo grandfathered)
- MI Team: 5 seats, shared pipeline ($499/mo)
- MI Enterprise: 15+ seats, API, white-label ($2,500+/mo)

---

## Phase 1: MI Free Integration

### Opportunity Hunter in MI Free
- [ ] Add OH link in `/briefings` sidebar for Free users
- [ ] Create OH panel component for unified dashboard (`src/components/bd-assist/OpportunityHunterPanel.tsx`)
- [ ] Wire OH API calls to work within `/briefings` context
- [ ] Update UnifiedSidebar to show OH for `tier: 'free'` users
- [ ] Test: Free user can access OH from sidebar

### Daily Alerts in MI Free
- [ ] Update free signup flow to create `treatment_type: 'alerts'` (not 'briefings')
- [ ] Verify Daily Alerts cron triggers for MI Free users
- [ ] Add "Upgrade to Pro" CTA in Daily Alert emails
- [ ] Test: Free user receives daily alerts email

### Free Tier Dashboard Access
- [ ] Create limited dashboard view for Free users (no AI briefings, no archive)
- [ ] Show upgrade prompts where Pro features would be
- [ ] Test: Free user sees dashboard with upgrade CTAs

---

## Phase 2: Legacy Product Migration

### Alert Pro ($19/mo) Users
- [ ] Identify all Alert Pro subscribers in Stripe
- [ ] Cancel subscriptions (with notice email)
- [ ] Migrate to MI Free with same profile settings
- [ ] Send migration email: "You now get Daily Alerts free"
- [ ] Remove Alert Pro from Stripe products (archive)
- [ ] Update KV keys: `alertpro:{email}` → no longer needed (all users get free)

### Briefings ($49/mo) Users
- [ ] Identify all $49/mo Briefings subscribers in Stripe
- [ ] Update their records: `treatment_type: 'briefings'`, keep $49/mo price
- [ ] Document as "MI Pro Grandfathered" in Stripe metadata
- [ ] Send email: "You're grandfathered at $49/mo for MI Pro"
- [ ] Create Stripe product variant: "MI Pro (Grandfathered)" at $49/mo

### Tool Bundle Buyers
- [ ] Query Stripe/Supabase for all bundle purchasers (Starter, Pro Giant, Ultimate)
- [ ] Grant lifetime MI Pro access in `user_notification_settings`
- [ ] Update KV: `briefings:{email}: true`
- [ ] Send email: "Your bundle includes lifetime MI Pro access"

### OH Pro ($19/mo) Users
- [ ] Identify OH Pro subscribers
- [ ] Keep them on OH Pro (separate from alerts)
- [ ] Future: Consider merging OH Pro into MI Pro

---

## Phase 3: Domain Migration

### DNS Setup (Day 1)
- [ ] Add `govcongiants.com` to Vercel (govcon-funnels project)
- [ ] Add `mi.govcongiants.com` to Vercel (market-assassin project)
- [ ] Configure SSL certificates for both
- [ ] Test: Both domains respond with HTTPS

### Redirects (Day 2)
- [ ] `govcongiants.org/*` → `govcongiants.com/*` (301)
- [ ] `tools.govcongiants.org/*` → `mi.govcongiants.com/*` (301)
- [ ] `shop.govcongiants.org/*` → `govcongiants.com/pricing` (301)
- [ ] Test: All old URLs redirect correctly

### Vercel Configuration
- [ ] Update `vercel.json` in govcon-funnels for new domain
- [ ] Update `vercel.json` in market-assassin for mi subdomain
- [ ] Remove shop.govcongiants.org from Vercel (or redirect)

---

## Phase 4: Email Migration

### Sender Domain
- [ ] Verify `@govcongiants.com` in Resend
- [ ] Update all email templates to use `hello@govcongiants.com`
- [ ] Test deliverability with seed list
- [ ] Monitor bounce rates for 7 days

### Email Templates to Update
- [ ] Daily Alerts email (`api/cron/daily-alerts`)
- [ ] Daily Briefings email (`api/cron/send-briefings-fast`)
- [ ] Weekly Deep Dive email (`api/cron/send-weekly-fast`)
- [ ] Pursuit Brief email (`api/cron/send-pursuit-fast`)
- [ ] Welcome/Confirmation emails
- [ ] Password reset / access link emails
- [ ] Purchase confirmation emails

### GovConEdu Phase-Out
- [ ] Set up email forward: `hello@govconedu.com` → `hello@govcongiants.com`
- [ ] Update Stripe receipts to show @govcongiants.com
- [ ] Update GHL automations to use new sender

---

## Phase 5: Past Buyer Rollout

### Profile Setup for Past Buyers
- [ ] Create "Profile Setup Reminder" email template
- [ ] Query: All paid users missing NAICS profile
- [ ] Send batch emails with secure setup link
- [ ] Track completion rate in Supabase

### Rollout Segments

**Segment 1: Bundle Buyers (Pro Giant + Ultimate)**
- [ ] Send email: "Set up your MI Pro profile"
- [ ] Include: Lifetime access, NAICS setup wizard link
- [ ] Expected: ~500 users

**Segment 2: Individual Tool Buyers**
- [ ] Send email: "Your tools now include Daily Alerts"
- [ ] Include: What changed, profile setup link
- [ ] Expected: ~2,000 users

**Segment 3: Free Users (OH Free, Bootcamp attendees)**
- [ ] Already enrolled in alerts or need NAICS setup
- [ ] Send reminder if no NAICS after 7 days
- [ ] Expected: ~8,000 users

---

## Phase 6: Pricing Page Consolidation

### Kill Shop
- [ ] Set up redirects from shop.govcongiants.org
- [ ] Archive shop.govcongiants.org Vercel project
- [ ] Remove all "shop.govcongiants.org" links from codebase

### New Pricing Page
- [ ] Create `/pricing` on govcongiants.com
- [ ] Show: MI Free, MI Pro, MI Team, Enterprise
- [ ] Include bundle comparison (Starter, Pro Giant, Ultimate)
- [ ] Add FAQ section
- [ ] Mobile-responsive design

### Update All CTAs
- [ ] OH → `/pricing` for upgrades
- [ ] Daily Alerts → `/pricing` for Pro upgrade
- [ ] Dashboard → `/pricing` for tier upgrades
- [ ] Marketing site → `/pricing` for all purchases

---

## Phase 7: Brand Cleanup

### Documentation Updates
- [ ] Update all CLAUDE.md files with new domains
- [ ] Update README files
- [ ] Update all MD docs referencing old domains

### Stripe Branding
- [ ] Update Stripe receipt branding
- [ ] Update Stripe product names to use "MI" prefix
- [ ] Update checkout page branding

### Marketing Materials
- [ ] Update social media profiles (Twitter, LinkedIn)
- [ ] Update email signatures
- [ ] Update slide decks
- [ ] Update video outros

---

## Phase 8: Legal Structure (Q3 2026)

### Attorney Consultation
- [ ] Schedule call with attorney re: nonprofit → for-profit
- [ ] Document options: conversion vs. subsidiary vs. PBC
- [ ] Get timeline and cost estimate

### If Converting to For-Profit
- [ ] File necessary state paperwork
- [ ] Update articles of incorporation
- [ ] Transfer assets from nonprofit to for-profit
- [ ] Update Stripe account ownership

### If Creating Subsidiary (OpenAI Model)
- [ ] Create GovCon Giants PBC (or LLC)
- [ ] Transfer commercial operations
- [ ] Keep nonprofit for training/education

---

## Acceptance Criteria

### MI Free Launch
- [ ] Free users can sign up without credit card
- [ ] Free users receive Daily Alerts
- [ ] Free users can access Opportunity Hunter
- [ ] Free users see upgrade prompts

### MI Pro Launch
- [ ] Pro users receive all 3 briefing types
- [ ] Pro users have full dashboard access
- [ ] $49 grandfathered users keep their price
- [ ] New Pro users pay $149/mo

### Domain Migration
- [ ] All old URLs redirect (301)
- [ ] No broken links
- [ ] SEO traffic maintained (monitor 30 days)
- [ ] Email deliverability >95%

### Shop Killed
- [ ] Shop URLs redirect to /pricing
- [ ] No "shop" references in codebase
- [ ] Stripe products consolidated

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Broken links | Comprehensive 301 redirects, monitor 404s |
| Email deliverability | Warm up new domain, test with seed list |
| Customer confusion | Clear migration emails with support contact |
| SEO traffic drop | 301s + sitemap update + Google Search Console |
| Stripe disruption | Test checkout URLs before domain switch |

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Redirect coverage | 100% | Monitor 404 logs |
| Email deliverability | >95% | Resend dashboard |
| SEO traffic | No drop after 30 days | Google Analytics |
| Customer complaints | <5 | Support inbox |
| Free signups/week | 50+ | Supabase query |
| Free → Pro conversion | 5%+ | Stripe + Supabase |

---

## Notes

- All phase 1-2 work can happen on current infrastructure
- Phase 3-4 (domain migration) is the riskiest — schedule during low-traffic period
- Phase 5-6 can happen in parallel with domain migration
- Phase 7-8 is lower priority but important for exit readiness

---

*Last Updated: May 4, 2026*
