# Domain & Brand Consolidation Strategy

**Decision Date:** May 4, 2026
**Status:** Approved — Implementation Pending

---

## Executive Summary

Consolidate all GovCon Giants properties under `govcongiants.com` (.com) with a unified MI SaaS product model. Kill the shop. Migrate from nonprofit (.org) to for-profit structure.

---

## Current State (The Mess)

| Asset | Current | Problem |
|-------|---------|---------|
| Marketing site | govcongiants.org | .org = nonprofit signal |
| Tools/App | tools.govcongiants.org | Separate subdomain |
| Shop | shop.govcongiants.org | Unnecessary with SaaS model |
| Team emails | @govcongiants.com | Different TLD from site |
| Transactional email | hello@govconedu.com | Third brand |
| Some team | @govcongiants.org | Inconsistent |

**Legal structure:**
- GovCon Giants = Nonprofit (brand recognition, free training)
- GovConEdu = For-profit (receives all revenue)
- Confusion for enterprise buyers, exit complications

---

## Target State

### Domain Structure

| Purpose | URL | Codebase |
|---------|-----|----------|
| **Marketing/SEO** | `govcongiants.com` | govcon-funnels |
| **SaaS App** | `mi.govcongiants.com` | market-assassin |
| **Shop** | KILLED | Redirect to /pricing |

### Email Structure

| Purpose | Email |
|---------|-------|
| Team communication | @govcongiants.com |
| Transactional/product | noreply@govcongiants.com |
| Support | service@govcongiants.com |
| Sales | hello@govcongiants.com |

**GovConEdu email:** Phase out over time, forward to @govcongiants.com

### Legal Structure (Future)

**Recommended:** Convert GovCon Giants to for-profit (or create for-profit subsidiary)
- One brand for everything
- Clean for exit/acquisition
- Enterprise buyers see one company
- Free training = marketing/lead gen (allowed under for-profit)

**OpenAI model alternative:** Keep nonprofit as foundation, create GovCon Giants PBC as commercial arm

---

## Product Architecture

### MI Tier Structure

| Tier | Price | Includes |
|------|-------|----------|
| **MI Free** | $0 | Opportunity Hunter + Daily Alerts (simple list) |
| **MI Pro** | $149/mo | Full intelligence stack with AI |
| **MI Pro (grandfathered)** | $49/mo | Existing $49 subscribers honored |
| **MI Team** | $499/mo | 5 seats, shared pipeline |
| **MI Enterprise** | $2,500+/mo | 15+ seats, API, white-label |

### Legacy Product Handling

| Old Product | New Status |
|-------------|------------|
| Alert Pro ($19/mo) | → MI Free (cancel subscriptions) |
| Briefings ($49/mo) | → MI Pro at $49 (grandfathered) |
| OH Pro ($49 one-time) | → MI Free (keep access) |
| Tool bundles | → MI Pro (lifetime access) |
| Individual tools | → MI Pro features |
| Shop | → KILLED (redirect to /pricing) |

### Key Distinction

| Feature | MI Free (Daily Alerts) | MI Pro (Daily Briefings) |
|---------|------------------------|--------------------------|
| Delivery | Email | Email + Dashboard |
| Content | Simple opportunity list | AI-curated top 3-5 |
| Analysis | None | Win probability |
| Strategy | None | Recommendations |
| Price | $0 | $149/mo |

---

## Why .com Over .org

Research from [Lovable](https://lovable.dev/guides/org-vs-com-domain-extension-guide) and [SaaSworthy](https://www.saasworthy.com/blog/org-vs-com-your-guide-to-choose-the-best-domain):

| Factor | .com | .org |
|--------|------|------|
| Trust score | 3.5/5 | 3.3/5 |
| Memorability | **44%** | 32% |
| User default guess | **3.8x more likely** | — |
| Enterprise perception | "Professional, commercial" | "Nonprofit, charity" |
| SaaS standard | **Yes** | Rare |

> "A .org suggests you're here to help, not sell; a .com positions you as a business ready to serve."

---

## Why Subdomain Over Path

Research from [AWS](https://aws.amazon.com/blogs/networking-and-content-delivery/tenant-routing-strategies-for-saas-applications-on-aws/) and [Serverless First](https://serverlessfirst.com/how-to-select-a-future-proof-subdomain-structure-for-saas-web-app/):

| Need at Scale | Subdomain | Path |
|---------------|-----------|------|
| White-label (APEX) | Easy | Hard |
| Enterprise SSO | Per-org domains | Complex |
| Custom domains | Standard | Not possible |
| Independent deployment | Yes | No |
| Per-customer routing | DNS-based | Complex |

**At 100K users, subdomain is mandatory for enterprise features.**

---

## Why Kill the Shop

1. **SaaS model** — Users go to MI, sign up, upgrade. No "shopping."
2. **One conversion point** — Simpler funnel, less confusion
3. **Less code to maintain** — One less Vercel project
4. **Matches competitors** — Deltek, Unanet don't have "shops"

**Legacy buyers:** Already have KV access keys. They log into MI.

**Shop URLs:** 301 redirect to `govcongiants.com/pricing`

---

## Migration Plan

### Phase 1: DNS Setup (Day 1)
- [ ] Add `govcongiants.com` to Vercel (govcon-funnels)
- [ ] Add `mi.govcongiants.com` to Vercel (market-assassin)
- [ ] Configure SSL certificates

### Phase 2: Redirects (Day 2)
- [ ] `govcongiants.org/*` → `govcongiants.com/*` (301)
- [ ] `tools.govcongiants.org/*` → `mi.govcongiants.com/*` (301)
- [ ] `shop.govcongiants.org/*` → `govcongiants.com/pricing` (301)

### Phase 3: Email Migration (Week 1)
- [ ] Update Resend sender to @govcongiants.com
- [ ] Update all email templates
- [ ] Set up forwards from @govconedu.com
- [ ] Update team signatures

### Phase 4: Brand Cleanup (Week 2-4)
- [ ] Update all MD docs
- [ ] Update Stripe receipt branding
- [ ] Update marketing materials
- [ ] Update social profiles
- [ ] Update GHL automations

### Phase 5: Legal (Q3 2026)
- [ ] Consult attorney on nonprofit → for-profit conversion
- [ ] File necessary paperwork
- [ ] Transfer assets to new entity
- [ ] Update Stripe account ownership

---

## SEO Considerations

- **301 redirects preserve SEO** — Google follows redirects
- **Interlink heavily** — govcongiants.com ↔ mi.govcongiants.com
- **Update sitemap** — Submit new URLs to Google Search Console
- **Monitor traffic** — Watch for drops in first 30 days

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Broken links | Comprehensive 301 redirects |
| Email deliverability | Warm up new sender domain |
| Customer confusion | Clear communication email |
| SEO drop | 301s + sitemap update |
| Legal complexity | Consult attorney early |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Redirect coverage | 100% of old URLs |
| Email deliverability | >95% inbox rate |
| SEO traffic | No drop after 30 days |
| Customer complaints | <5 |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| May 4, 2026 | Consolidate to .com | Enterprise perception, exit readiness |
| May 4, 2026 | Use mi.govcongiants.com | White-label ready, enterprise SSO |
| May 4, 2026 | Kill shop | SaaS model, one conversion point |
| May 4, 2026 | MI Free = OH + Daily Alerts | Habit-forming hook, same onboarding |
| May 4, 2026 | Grandfather $49 subscribers | Honor commitments, retention |

---

*Last Updated: May 4, 2026*
