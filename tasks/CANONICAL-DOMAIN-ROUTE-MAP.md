# Canonical Domain Route Map

Status: Draft operating rule
Last updated: May 13, 2026

## Core Rule

GovCon Giants now has three primary surfaces:

| Surface | Domain | Job |
| --- | --- | --- |
| Public website | `https://govcongiants.com` | SEO, sales pages, pricing, content, public contractor pages, launch pages, and conversion CTAs |
| Mindy platform | `https://getmindy.ai` | **Primary** Mindy SaaS app — standalone brand for exit-ready positioning |
| MI platform (legacy) | `https://mi.govcongiants.com` | **Redirects to getmindy.ai** — kept for backwards compatibility |

> **Update (May 13, 2026):** The MI platform is rebranding to "Mindy" with its own domain `getmindy.ai`. This positions Mindy as a standalone product for potential acquisition. The `mi.govcongiants.com` subdomain will redirect to `getmindy.ai`.

Everything new should use `govcongiants.com` (public/marketing) or `getmindy.ai` (product/app). The `.org`, `tools.govcongiants.org`, `mi.govcongiants.com`, and old shop links are transition/redirect surfaces only.

## Public Website Routes

These should live on `govcongiants.com`.

| Route family | Purpose | Notes |
| --- | --- | --- |
| `/` | Main GovCon Giants brand home | Primary brand and offer positioning |
| `/mi` | MI sales page | Explains MI Free, MI Pro, teams, and white-glove path |
| `/premium` | Premium / bundle offer | Sales surface, not app surface |
| `/done-for-you` | White-glove sales page | Qualifies committed clients |
| `/bootcamp` or `/may-30-bootcamp` | Event registration and replay hub | Bootcamp should sell the platform plus services transition |
| `/contractors/[slug]` | Public contractor SEO pages | Public teaser data, sales history preview, and gated MI deep links |
| `/contractor-database` | Public product page for contractor research | CTA into MI Pro |
| `/recompetes` | Public SEO/product page for recompete research | CTA into MI Pro |
| `/forecasts` | Public SEO/product page for procurement forecasts | CTA into MI Pro |
| `/free-resources` | Free lead magnets and audience capture | Can link to MI Free setup |
| `/guides-templates` | SEO/resource content | Top-of-funnel |
| `/about` | Brand trust page | Keep on public domain |

## MI Platform Routes

These should live on `mi.govcongiants.com`.

| Route family | Purpose | Notes |
| --- | --- | --- |
| `/` | MI app entry / redirect | Should route logged-in users to the app and logged-out users to sign in |
| `/briefings` | MI Pro briefings dashboard | Primary paid intelligence surface |
| `/mi-beta` | Current unified MI app shell | Transition path until stable route names replace beta wording |
| `/mi-beta/setup-account` | Account setup | Product/account flow |
| `/mi-beta/setup-password` | Password creation | Product/account flow |
| `/mi-beta/forgot-password` | Password reset request | Product/account flow |
| `/mi-beta/reset-password` | Password reset completion | Product/account flow |
| `/alerts/preferences` | Alert preferences | Product/account flow |
| `/profile/setup` | MI Free profile setup | Product/account flow |
| `/profile/complete` | Profile completion | Product/account flow |
| `/pipeline` | Pursuit tracking | MI Pro or team surface |
| `/admin/dashboard` | Internal admin dashboard | Private/internal only |
| `/admin/launch-command-center` | Internal launch command center | Private/internal only |
| `/admin/*` | Internal admin operations | Private/internal only |

## Current Repo Ownership

Source check completed May 10, 2026.

| Repo | Canonical domain | Owns |
| --- | --- | --- |
| `govcon-funnels` | `govcongiants.com` | Public website, SEO pages, sales pages, offer pages, public contractor/company pages, resources, blog/guides/video/glossary pages, public tools, and public lead capture |
| `market-assassin` | `mi.govcongiants.com` | MI product app, authentication/account setup, alerts, profiles, briefings, forecasts, recompetes, contractor research inside MI, pipeline, teaming, proposal workflows, admin dashboards, cron jobs, and internal operational APIs |

### `govcon-funnels` Public Website Pages

The public website repo already contains the main surfaces that should become the `.com` system:

- Brand and content: `/`, `/blog`, `/guides`, `/videos`, `/glossary`, `/about`
- Sales and offers: `/pricing`, `/premium`, `/premium/[slug]`, `/premium/[slug]/checkout`, `/done-for-you`, `/demo`, `/mi-free`
- Public SEO/data: `/data/contractors`, `/data/contractors/[uei]`, `/data/agencies`, `/data/forecasts`
- Product education: `/features/*`, `/for/*`, `/compare/*`, `/resources/*`, `/tools/*`
- Public intake and event flows: `/jobs/*`, public calculators/checkers, and lead capture APIs

This repo should be the primary home for pages meant to rank in Google, educate visitors, capture leads, and convert people into MI Free, MI Pro, or white-glove.

### `market-assassin` MI Platform Pages

The MI platform repo already contains the authenticated/app surfaces that should remain on `mi.govcongiants.com`:

- App and login: `/`, `/mi-beta`, `/mi-beta/setup-account`, `/mi-beta/setup-password`, `/mi-beta/forgot-password`, `/mi-beta/reset-password`
- Customer product: `/briefings`, `/alerts/preferences`, `/profile/setup`, `/profile/complete`, `/pipeline`
- Admin/internal: `/admin/dashboard`, `/admin/launch-command-center`, `/admin/*`
- Operational APIs: cron, email, entitlement, dashboard, admin, MI app, and data feeds

This repo should be the primary home for product behavior, customer data, app sessions, permissions, paid features, internal dashboards, and delivery systems.

### `market-assassin` Routes To De-Emphasize Or Redirect

These route families currently exist in `market-assassin`, but they look like public website, sales, or SEO surfaces. They should either move to `govcon-funnels`, redirect to `govcongiants.com`, or become thin compatibility routes after the `.com` destination exists:

- `/about`
- `/store`
- `/purchase/success`
- `/market-intelligence`
- `/contractors/[slug]`
- `/contractor-database`
- `/forecasts`
- `/recompete`
- `/free-resources`
- `/guides-templates`
- `/content-generator-product`
- `/bundles/*`

Do not delete these until redirects are mapped and tested. Treat them as compatibility surfaces during migration.

## Redirect Surfaces

These should not be used in new customer-facing links except as redirects.

| Legacy surface | Redirect policy |
| --- | --- |
| `https://govcongiants.org/*` | Redirect public/sales/content pages to matching `https://govcongiants.com/*` |
| `https://www.govcongiants.org/*` | Redirect public/sales/content pages to matching `https://www.govcongiants.com/*` |
| `https://tools.govcongiants.org/*` | Redirect product/app/account links to matching `https://mi.govcongiants.com/*` when destination exists |
| Old shop links | Redirect offer pages to `govcongiants.com` sales pages or canonical checkout path |

## Email Link Rules

| Email type | Primary CTA domain |
| --- | --- |
| MI Free alert | `mi.govcongiants.com` for app/profile links |
| MI Pro briefing | `mi.govcongiants.com` for app links |
| Password reset / account setup | `mi.govcongiants.com` |
| Bootcamp invite | `govcongiants.com` |
| Offer / bundle / white-glove | `govcongiants.com` |
| Public SEO/content newsletter | `govcongiants.com` |

## SEO Rules

- Public contractor pages should canonicalize to `govcongiants.com`.
- Public pages can show teaser data that helps Google understand the contractor, agency, NAICS, award history, and sales trend.
- Full contractor details, exports, saved lists, pipeline actions, team workflows, and deeper intelligence should gate into MI.
- App pages should generally be `noindex`.
- Admin pages must be `noindex` and private.

## Product Navigation Rules

- Customer-facing app navigation should gradually remove `beta` language once the unified MI shell is stable.
- MI Free users should not receive redundant Pro-only routes without upgrade prompts.
- MI Pro users should not receive duplicate MI Free alert emails when Pro briefings supersede the free alert.
- Internal users can have broader access, but public labels should not expose internal-only concepts.

## Open Questions

- Which current `tools.govcongiants.org` routes need direct redirects to `mi.govcongiants.com` first?
- Should `mi.govcongiants.com/admin/*` exist long term, or should internal admin remain on a separate private admin surface?
- What is the canonical checkout/payment surface after the shop cleanup?
