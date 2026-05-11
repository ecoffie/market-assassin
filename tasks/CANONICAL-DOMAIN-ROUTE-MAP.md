# Canonical Domain Route Map

Status: Draft operating rule  
Last updated: May 10, 2026

## Core Rule

GovCon Giants now has two primary surfaces:

| Surface | Domain | Job |
| --- | --- | --- |
| Public website | `https://govcongiants.com` | SEO, sales pages, pricing, content, public contractor pages, launch pages, and conversion CTAs |
| MI platform | `https://mi.govcongiants.com` | Market Intelligence app, account setup, login, briefings, alerts, forecasts, recompetes, contractors, pipeline, teaming, proposal workflows, and internal/admin dashboards |

Everything new should use one of those two domains. `.org`, `tools.govcongiants.org`, and old shop links are transition surfaces only.

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

- Which exact public pages live in the funnels repo versus this repo?
- Which current `tools.govcongiants.org` routes need direct redirects to `mi.govcongiants.com` first?
- Should `mi.govcongiants.com/admin/*` exist long term, or should internal admin remain on a separate private admin surface?
- What is the canonical checkout/payment surface after the shop cleanup?
