# Implementation Plan: Daily Bid Target ($49/mo)

**Phase:** 1 of 3
**Timeline:** 4-6 weeks
**Goal:** Launch subscription product, prove recurring revenue model

---

## What We're Building

**Product:** Daily Bid Target
**Price:** $49/month
**Value Prop:** "Your #1 bid-ready contract, every morning"

---

## The Funnel (Like Opportunity Hunter)

```
FREE: Daily Alerts → Lead Generation (9,000+ leads like OH)
         ↓
     Demonstrates value daily
         ↓
PAID: Daily Bid Target ($49/mo) → Monetization
         ↓
     Proves subscription model
         ↓
PAID: Bid Intelligence Pro ($149/mo) → Upsell
```

**Daily Alerts is NOT a lesser product.** It's the marketing engine that:
- Captures email addresses
- Demonstrates value every day
- Builds habit and trust
- Creates upgrade opportunities

---

### Free vs Paid Tiers

| Feature | Free (Daily Alerts) | Paid ($49/mo Bid Target) |
|---------|---------------------|--------------------------|
| **Purpose** | Lead gen / marketing | Revenue / premium value |
| Matching opportunities | All matches | All matches |
| **THE ONE bid target** | ❌ | ✅ |
| Win probability score | ❌ | ✅ |
| "Why this one" reasoning | ❌ | ✅ |
| Action steps for today | ❌ | ✅ |
| "Also on radar" list | ❌ | ✅ (2-3 more) |
| **Upgrade CTA in email** | ✅ (drives to $49) | ✅ (drives to $149) |

---

## Implementation Tasks

### Week 1: Email Rebranding

- [ ] Update email subject lines: "priority" → "bid target"
- [ ] Update email body copy to use "bid" language
- [ ] Change "Why This One" to "Why You Can Win This"
- [ ] A/B test old vs new subject lines (track open rates)

**Files to modify:**
- `src/app/api/cron/send-all-briefings/route.ts` (email templates)
- `src/lib/briefings/delivery/ai-email-template.ts`

### Week 2: Scoring Algorithm

- [ ] Simplify to 3 factors: NAICS match, Set-aside match, Timing
- [ ] Add "bid readiness" score (0-100)
- [ ] Generate "Why You Can Win" bullets from score factors
- [ ] Test with 100 sample opportunities

**Files to modify:**
- `src/lib/briefings/win-probability.ts`
- `src/lib/briefings/pipelines/daily-brief.ts`

### Week 3: Paywall & Stripe

- [ ] Create Stripe product: "Daily Bid Target" $49/mo
- [ ] Add subscription check to briefing sender
- [ ] Free tier: Daily Alerts (raw matching)
- [ ] Paid tier: Daily Bid Target (curated + scoring)
- [ ] Add "Upgrade to Bid Target" CTA in free emails

**Files to modify:**
- `src/lib/products.ts` (add new product)
- `src/app/api/stripe-webhook/route.ts` (handle subscription)
- `src/lib/access-codes.ts` (add bidtarget:{email} key)

### Week 4: Onboarding Simplification

- [ ] Create 3-question signup flow:
  1. Email
  2. What do you do? (maps to NAICS)
  3. Certification? (8(a), WOSB, SDVOSB, HUBZone, None)
- [ ] Auto-infer NAICS from selection
- [ ] Landing page: /bid-target

**Files to create:**
- `src/app/bid-target/page.tsx` (landing page)
- `src/app/bid-target/signup/page.tsx` (3-question flow)

### Week 5: Testing & Metrics

- [ ] Send test emails to team (Eric, Evan)
- [ ] Track: open rate, click rate, upgrade clicks
- [ ] Set up conversion tracking in Stripe
- [ ] Create admin dashboard for subscription metrics

### Week 6: Launch

- [ ] Email existing 927 briefing users about upgrade
- [ ] Add upgrade banner to free Daily Alerts
- [ ] Monitor conversions daily
- [ ] Iterate based on feedback

---

## Email Template Changes

### Subject Line

**Before:**
```
🎯 [Maria] Your priority today: HUD needs 8(a) consulting
```

**After:**
```
🎯 [Maria] Your bid target: HUD 8(a) - $2.5M - 12 days left
```

### Body Structure

```
Good morning, Maria.

YOUR BID TARGET TODAY
━━━━━━━━━━━━━━━━━━━━━━━━

📋 HUD Program Management Support
   Department of Housing & Urban Development

💰 $2.5M - $5M (estimated)
⏰ Closes in 12 days (April 25)
🎯 Bid Score: 82/100 — YOU CAN WIN THIS

WHY YOU CAN WIN THIS:
✅ 8(a) set-aside — you qualify
✅ 541611 exact NAICS match
✅ No incumbent — new requirement
✅ Your past performance aligns

YOUR ACTION TODAY:
→ Download the RFP and read Section C (15 min)
→ Call HUD OSDBU: (202) 708-1428

[View on SAM.gov →]

━━━━━━━━━━━━━━━━━━━━━━━━

📊 Also on your radar (but focus on above first):
• VA IT Support — closes Apr 28 — Score: 74
• GSA Schedule refresh — closes May 5 — Score: 68

[Manage Preferences] | [Unsubscribe]

GovCon Giants • shop.govcongiants.org
```

---

## Database Changes

### New Stripe Product

```typescript
// src/lib/products.ts
{
  id: 'bid_target',
  name: 'Daily Bid Target',
  price: 49,
  type: 'subscription',
  interval: 'month',
  kvKey: 'bidtarget',
  stripeMetadata: { tier: 'bid_target' }
}
```

### Access Control

```typescript
// KV keys
bidtarget:{email} = true  // Has paid subscription
alerts:{email} = true      // Has free alerts (everyone)
```

---

## Success Metrics

| Metric | Target | How We Measure |
|--------|--------|----------------|
| Email open rate | 60%+ | SendGrid/Mailgun stats |
| Click rate | 20%+ | Link tracking |
| Free → Paid conversion | 10%+ | Stripe subscriptions / total users |
| Monthly churn | <5% | Stripe cancellations |
| MRR Month 3 | $4,900 | 100 subscribers × $49 |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Users don't upgrade | Strong "Why You Can Win" reasoning, visible value difference |
| Scoring is wrong | Feedback loop ("Was this helpful?"), rapid iteration |
| Too much change at once | A/B test subject lines before full rollout |
| Existing users confused | Clear communication email explaining new tiers |

---

## Dependencies

- Existing briefing infrastructure (working)
- 927 users already receiving briefings (audience ready)
- Stripe account (configured)
- Win probability scoring (exists, needs simplification)

---

## Not In Scope (Phase 1)

- Pipeline tracking (Phase 2)
- Teaming suggestions (Phase 2)
- Dashboard UI (Phase 2)
- Mobile app (not planned)

---

*Created: April 13, 2026*
