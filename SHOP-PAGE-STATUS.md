# Shop Page Status - GovCon Giants

**Last Updated:** January 30, 2026

---

## Completed Tasks

### 1. Stripe Links Connected
All products now have working Stripe checkout URLs:

| Product | Price | Status |
|---------|-------|--------|
| Market Assassin Standard | $297 | ✅ Connected |
| Market Assassin Premium | $497 | ✅ Connected |
| Content Generator (Content Engine) | $197 | ✅ Connected |
| Content Generator (Full Fix) | $397 | ✅ Connected |
| Federal Contractor Database | $497 | ✅ Connected |
| Recompete Contracts Tracker | $397 | ✅ Connected |
| Opportunity Hunter Pro | $49 | ✅ Connected |
| GovCon Starter Bundle | $697 | ✅ Connected |
| Pro Giant Bundle | $997 | ✅ Connected |
| Ultimate GovCon Bundle | $1,497 | ✅ Connected |

### 2. LemonSqueezy Removed
- Deleted `/src/lib/lemonsqueezy.ts`
- Deleted `/src/app/api/lemonsqueezy-webhook/route.ts`
- Created `/src/lib/products.ts` with all Stripe URLs
- Updated all references to use Stripe

### 3. Webhook Fixed (`/src/app/api/stripe-webhook/route.ts`)
- Access flags now update for ALL purchases (removed user_id requirement)

### 4. Bundle Names Aligned (`/src/lib/supabase/user-profiles.ts`)
- Now accepts both short names AND full product IDs:
  - `starter` or `govcon-starter-bundle`
  - `pro` or `pro-giant-bundle`
  - `ultimate` or `ultimate-govcon-bundle`

### 5. Stripe Metadata Configured (Done by user)
- All payment links have `tier` or `bundle` metadata
- Success URLs configured to redirect to `/purchase/success`

---

## Current Purchase Flow

```
1. Customer clicks "Buy Now" on product page
   ↓
2. Redirects to Stripe Checkout (buy.stripe.com/...)
   ↓
3. Customer enters payment info
   ↓
4. Stripe processes payment
   ↓
5. Stripe webhook → POST /api/stripe-webhook
   - Verifies signature
   - Extracts email, tier, bundle from metadata
   - Saves purchase to Supabase `purchases` table
   - Creates/updates user profile with license key
   - Updates access flags in `user_profiles` table
   - Sends license key email
   ↓
6. Customer redirected to /purchase/success?session_id=...
   ↓
7. Customer receives email with:
   - License key (XXXX-XXXX-XXXX-XXXX format)
   - Link to activate at shop.govcongiants.org/activate
   ↓
8. Customer activates and gains access to products
```

---

## Key Files

| File | Purpose |
|------|---------|
| `/src/lib/products.ts` | Product config with Stripe URLs |
| `/src/app/api/stripe-webhook/route.ts` | Handles Stripe payment webhooks |
| `/src/app/api/stripe-session/route.ts` | Retrieves session info, grants access |
| `/src/lib/supabase/user-profiles.ts` | User profiles & access flag management |
| `/src/lib/send-email.ts` | Email templates (license key, etc.) |
| `/src/app/store/page.tsx` | Main shop page |
| `/src/app/purchase/success/page.tsx` | Post-purchase success page |
| `/src/components/PurchaseGate.tsx` | Access gate component |

---

## Stripe Metadata Reference

### Individual Products
| Product | Metadata Key | Metadata Value |
|---------|--------------|----------------|
| Market Assassin Standard | `tier` | `assassin_standard` |
| Market Assassin Premium | `tier` | `assassin_premium` |
| Content Generator | `tier` | `content_standard` |
| Content Generator Full Fix | `tier` | `content_full_fix` |
| Contractor Database | `tier` | `contractor_db` |
| Recompete Contracts | `tier` | `recompete` |
| Opportunity Hunter Pro | `tier` | `hunter_pro` |

### Upgrade Products
| Upgrade Product | Price | Metadata Key | Metadata Value |
|-----------------|-------|--------------|----------------|
| Market Assassin Premium Upgrade | $200 | `tier` | `assassin_premium_upgrade` |
| Content Generator Full Fix Upgrade | $200 | `tier` | `content_full_fix_upgrade` |

**Note:** Upgrades grant the higher tier access. Users must already own the standard version.

### Bundles
| Bundle | Metadata Key | Metadata Value |
|--------|--------------|----------------|
| GovCon Starter | `bundle` | `govcon-starter-bundle` |
| Pro Giant | `bundle` | `pro-giant-bundle` |
| Ultimate GovCon | `bundle` | `ultimate-govcon-bundle` |

---

## Access Flags (user_profiles table)

| Flag | Products That Grant It |
|------|------------------------|
| `access_hunter_pro` | Opportunity Hunter Pro, Starter Bundle, Ultimate Bundle |
| `access_content_standard` | Content Generator, Pro Bundle, Ultimate Bundle |
| `access_content_full_fix` | Content Generator Full Fix, Ultimate Bundle |
| `access_assassin_standard` | Market Assassin Standard, Pro Bundle, Ultimate Bundle |
| `access_assassin_premium` | Market Assassin Premium, Ultimate Bundle |
| `access_recompete` | Recompete Contracts, Starter Bundle, Pro Bundle, Ultimate Bundle |
| `access_contractor_db` | Contractor Database, Starter Bundle, Pro Bundle, Ultimate Bundle |

---

## Bundle Contents

### GovCon Starter Bundle ($697)
- Opportunity Hunter Pro ($49)
- Recompete Contracts Tracker ($397)
- Federal Contractor Database ($497)
- **Individual Total: $943 | Save $246**

### Pro Giant Bundle ($997)
- Federal Contractor Database ($497)
- Recompete Contracts Tracker ($397)
- Market Assassin Standard ($297)
- AI Content Generator ($197)
- **Individual Total: $1,388 | Save $391**

### Ultimate GovCon Bundle ($1,497)
- AI Content Generator Full Fix ($397)
- Federal Contractor Database ($497)
- Recompete Contracts Tracker ($397)
- Market Assassin Premium ($497)
- Opportunity Hunter Pro ($49)
- **Individual Total: $1,837 | Save $340**

---

## Upgrade Purchase Flow

For users upgrading from Standard to Premium:

```
1. Customer clicks "Upgrade" on product page
   ↓
2. Redirects to Stripe Checkout (upgrade payment link)
   - Market Assassin Premium Upgrade: $200
   - Content Generator Full Fix Upgrade: $200
   ↓
3. Stripe webhook receives checkout.session.completed
   - tier: assassin_premium_upgrade OR content_full_fix_upgrade
   ↓
4. updateAccessFlags() grants premium access
   - Also ensures standard access flag is set
   ↓
5. Customer redirected to /purchase/success?product=market-assassin-premium-upgrade
   ↓
6. stripe-session API (if called) also grants access via Vercel KV
```

**Stripe Success URL for Upgrades:**
- Market Assassin: `https://shop.govcongiants.org/purchase/success?product=market-assassin-premium-upgrade`
- Content Generator: `https://shop.govcongiants.org/purchase/success?product=content-full-fix-upgrade`

---

## Potential Next Steps

1. **Add bundles section to shop page** - Bundles exist but aren't displayed on /store
2. **Test purchase flow end-to-end** - Make a test purchase to verify everything works
3. **Add bundle product pages** - Create dedicated landing pages for each bundle
4. **Review email templates** - Ensure emails look good and have correct links
5. **Add order confirmation page content** - Enhance /purchase/success with more details

---

## Environment Variables Required

```
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...

# Email
SMTP_USER=hello@govconedu.com
SMTP_PASSWORD=...
```

---

## Notes

- Build passes successfully
- All LemonSqueezy code removed
- Webhook now grants access without requiring user_id in metadata
- Bundle names are flexible (accepts short or full names)
