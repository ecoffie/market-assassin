# Market Assassin - Stripe Products Reference

Complete reference for Stripe products, prices, and payment links.

---

## Product Configuration

Source of truth: `src/lib/products.ts`

---

## Individual Products

| Product | Price | Stripe Payment Link | KV Key | Tier Metadata |
|---------|-------|---------------------|--------|---------------|
| Opportunity Hunter Pro | $49 | `buy.stripe.com/00wcN60ke97c5d384UfnO0i` | `ospro:{email}` | `hunter_pro` |
| Content Reaper (Engine) | $197 | `buy.stripe.com/dRmcN64Au6Z4axn84UfnO0m` | `contentgen:{email}` | `content_standard` |
| Market Assassin Standard | $297 | `buy.stripe.com/3cI3cw9UOdns34V84UfnO0j` | `ma:{email}` | `assassin_standard` |
| Content Reaper (Full Fix) | $397 | `buy.stripe.com/aFa9AU4Au1EKaxn5WMfnO0n` | `contentgen:{email}` | `content_full_fix` |
| Recompete Tracker | $397 | `buy.stripe.com/7sYfZi9UOdnsaxnbh6fnO0k` | `recompete:{email}` | `recompete` |
| Federal Contractor Database | $497 | `buy.stripe.com/4gMaEY3wqcjo6h70CsfnO0g` | `dbaccess:{email}` | `contractor_db` |
| Market Assassin Premium | $497 | `buy.stripe.com/5kQdRaeb497cfRHdpefnO0f` | `ma:{email}` | `assassin_premium` |

---

## Upgrade Products

| Product | Price | Stripe Payment Link | Description |
|---------|-------|---------------------|-------------|
| Content Reaper Full Fix Upgrade | $200 | `buy.stripe.com/9B6cN62sm2IO7lb4SIfnO0o` | Engine → Full Fix |
| Market Assassin Premium Upgrade | $200 | `buy.stripe.com/5kQ8wQ9UObfk34V3OEfnO0p` | Standard → Premium |

---

## Bundles

| Bundle | Price | Value | Stripe Payment Link | Includes |
|--------|-------|-------|---------------------|----------|
| GovCon Starter | $697 | $943 | `buy.stripe.com/6oU9AUeb46Z46h70CsfnO0s` | OH Pro ($49), Recompete ($397), Contractor DB ($497) |
| Pro Giant | $997 | $1,388 | `buy.stripe.com/dRm7sMaYS0AG0WN5WMfnO0q` | Contractor DB, Recompete, MA Standard, Content Reaper |
| Ultimate GovCon | $1,497 | $1,788 | `buy.stripe.com/6oU3cwff897ceND84UfnO0t` | Content Full Fix, Contractor DB, Recompete, MA Premium |

---

## Subscriptions

| Product | Price | Product ID | Description |
|---------|-------|------------|-------------|
| Alert Pro | $19/mo | `prod_U9rOClXY6MFcRu` | Daily SAM.gov alerts, includes OH Pro |
| Federal Help Center | $99/mo | `prod_TaiXlKb350EIQs` or `prod_TMUmxKTtooTx6C` | MA Standard + Alert Pro (revoked on cancel) |

---

## Mindy Pro (getmindy.ai)

| Product | Price | Checkout route | Stripe Payment Link | Tier metadata |
|---------|-------|----------------|----------------------|---------------|
| Mindy Pro Monthly | $149/mo | `/checkout/mindy-pro-monthly` | `buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C` | (subscription — auto-detected) |
| Mindy Pro Annual | $1,490/yr | `/checkout/mindy-pro-annual` | `buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D` | (subscription — auto-detected) |
| **Mindy Lifetime** | **$2,997 one-time** | `/checkout/mindy-lifetime` | **TODO — see Stripe Setup Checklist below** | `tier=briefings_lifetime` |

**Partner attribution:** Share `getmindy.ai/ncmbc` or `getmindy.ai/checkout/mindy-pro-monthly?ref=NCMBC` — never raw `buy.stripe.com` links (skips affiliate tracking).

### Mindy Lifetime — Stripe Dashboard Setup Checklist

The **standard** post-bootcamp lifetime price ($2,997). The $1,497 Ultimate Giant Bundle on shop.govcongiants.com is the time-boxed bootcamp special — it bundles the full tool suite. The new $2,997 product is **Mindy lifetime ONLY** (briefings tier, no other tools).

Setup steps (Eric, in Stripe dashboard — live mode):

- [ ] **Create product:** `Mindy Lifetime` — $2,997.00 USD, **one-time** (not recurring)
- [ ] **Create Payment Link** for that price
  - Description on the line item should include the word **"Lifetime"** (the webhook has a defensive fallback that infers `briefings_lifetime` from "Mindy Lifetime" / "Lifetime Briefings" / "Lifetime Market Intelligence" descriptions if metadata is missing)
- [ ] **Set Payment Link metadata:** `tier = briefings_lifetime` (canonical signal — webhook reads this from `session.metadata.tier`)
- [ ] **Enable** "Collect customer name + email" on the link
- [ ] **Set after-payment redirect** to `https://getmindy.ai/purchase/success?product=mindy-lifetime`
- [ ] **Copy the resulting `buy.stripe.com/...` URL** and replace the placeholder in `src/lib/purchase-attribution.ts` (`mindy-lifetime` entry) — search for `REPLACE_ME_MINDY_LIFETIME_2997`
- [ ] Deploy
- [ ] Test with a $0 promotion code (or in test mode) and verify:
  - [ ] `purchases` row created with `tier=briefings_lifetime`, `amount_paid=2997`
  - [ ] `user_profiles.access_briefings = true` for the buyer
  - [ ] Welcome email arrives (`sendMarketIntelligenceWelcomeEmail`)
  - [ ] Buyer can load `/app` and access Mindy AI

**Why a manual step:** Stripe products/prices are live-mode resources; we don't auto-create them from code. Once the link exists, everything downstream (checkout route, webhook, access grant, welcome email, purchase attribution, affiliate commission) is already wired.

---

## Webhook Configuration

**Endpoint (live):** `https://getmindy.ai/api/stripe-webhook`  
**Stripe endpoint ID:** `we_1SlciyK5zyiZ50PBzCmDeI2K`

### Webhook Secrets
- `STRIPE_WEBHOOK_SECRET` - Live webhook secret (must match endpoint above in Vercel)
- `STRIPE_TEST_WEBHOOK_SECRET` - Test webhook secret

### Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Triple-write (Supabase + KV + email) + **30% affiliate commission** (initial payment) |
| `invoice.paid` | **30% affiliate commission** on subscription renewals (skips `subscription_create` — checkout already counted) |
| `customer.subscription.deleted` | Revoke FHC/Alert Pro access |
| `customer.subscription.updated` | Check for cancellation/past_due |

### Affiliate payout tracking
- Ledger: Vercel KV (`mindy:affiliate:*`)
- Dashboard: Launch Command Center → Partner & Affiliate Programs
- API: `GET /api/admin/partner-referrals?password=...&code=NCMBC`
- Payouts: **manual** (no Stripe Connect / Rewardful yet)

### Triple-Write Flow

1. **Supabase `purchases` table** - Record transaction
2. **Supabase `user_profiles` table** - Update access flags
3. **Vercel KV** - Set access key
4. **Email** - Send product-specific welcome email

---

## Access Key Patterns (Vercel KV)

| Pattern | Product |
|---------|---------|
| `ma:{email}` | Market Assassin |
| `ospro:{email}` | Opportunity Hunter Pro |
| `alertpro:{email}` | Alert Pro subscription |
| `contentgen:{email}` | Content Reaper |
| `recompete:{email}` | Recompete Tracker |
| `dbaccess:{email}` | Federal Contractor Database |
| `briefings:{email}` | Daily Briefings |

---

## Email Templates by Tier

| Tier | Email Function |
|------|----------------|
| `hunter_pro` | `sendOpportunityHunterProEmail()` |
| `contractor_db` | `sendDatabaseAccessEmail()` |
| `assassin_standard`, `assassin_premium` | `sendAccessCodeEmail()` |
| `content_standard`, `content_full_fix` | `sendContentReaperEmail()` |
| `recompete` | `sendRecompeteEmail()` |
| `alert_pro` | `sendAlertProWelcomeEmail()` |
| `fhc_membership` | `sendFHCWelcomeEmail()` |
| Bundle purchases | `sendBundleEmail()` |

---

## FHC Membership Access Grants

When FHC subscription is active:
- Market Assassin Standard (`ma:{email}`)
- Alert Pro (`alertpro:{email}`)
- Opportunity Hunter Pro (`ospro:{email}`)
- Daily alert frequency set to `daily`

When FHC subscription is canceled:
- All above access revoked
- Alert frequency reverted to `weekly`

---

## Testing

### Test Mode
- Set `STRIPE_TEST_SECRET_KEY` in `.env.local`
- Set `STRIPE_TEST_WEBHOOK_SECRET` in `.env.local`
- Webhook handler tries live secret first, falls back to test

### Manual Testing
```bash
# Trigger Stripe CLI for local webhook testing
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

---

*Last Updated: June 13, 2026 — added Mindy Lifetime $2,997 (post-bootcamp standard price)*
