# Public routes intentionally NOT on the Mindy public design system

Close-out inventory for the public design migration (PR 1 #1783 · PR 2 #1784 · PR 3 #1793 + #1797 · PR 4). Every route below was checked on production on 2026-10-03 and left out **on purpose**. Anything public that appears neither here nor in `src/lib/public-site/opt-in.json` is a forgotten page and should be treated as a bug.

When a route changes category (retired, migrated, made public), update this file and `opt-in.json` in the same PR.

## Deliberate exclusions (decided in review)
| route | reason |
|---|---|
| `/mindy-landing` | Rollback snapshot of the pre-cutover homepage (`next.config.ts` rollback target). Restyling it would change the rollback. |
| `/home-redesign` | Obsolete GovCon Giants homepage experiment. To be retired or redirected, not restyled. |
| `/start` | Signup funnel experience, not a marketing surface. |
| `/dsbs-scorer` | Signed-out tool experience, not a marketing surface. |
| `/reports/[id]` | Customer deliverable (the market report a user sends a client). Different presentation purpose from site chrome. |
| `/gov/market-research` | Signed-out tool demo that does not use the government shell. |

## Transactional, signup and account flows
Public, but part of product flows (checkout, signup, auth). Out by decision.

| route | flow |
|---|---|
| `/purchase/success` | post-checkout |
| `/feedback/thanks`, `/feedback/error` | email-feedback confirmation |
| `/pursuit-brief/requested`, `/pursuit-brief/error` | request confirmation |
| `/mindy-day/confirmed` | event confirmation |
| `/alerts/signup` | alert signup |
| `/opportunity/mute/success`, `/opportunity/mute/already-muted`, `/opportunity/mute/error` | email "mute this opportunity" action confirmations |
| `/signup`, `/activate`, `/access`, `/welcome` | signup / activation |
| `/forgot-password`, `/reset-password`, `/setup-password`, `/setup-account` | password / account setup |
| `/auth/callback`, `/checkout/[product]` | handlers (redirects, no page) |

## Authenticated product
These keep the product's own design system. PR 1's map-chrome check guards that they don't change.

| route | note |
|---|---|
| `/app`, `/briefings`, `/agency`, `/pipeline`, `/contacts`, `/planner`, `/onboarding`, `/alerts/preferences`, `/command-center` | app panels / tool shells |
| `/opportunity-map/*` | the Maps product (its own chrome; verified unchanged by `verify-map-chrome`) |
| `/mcp/account` | signed-in MCP console (verified unchanged, signed in and out) |
| `/admin/*` | internal |

## Award detail
| route | note |
|---|---|
| `/contracts/[piid]` | Award-detail resolver (redirects). Tracked with the award 404s in #1786, kept separate from design work. `/awards/[id]` itself sits in the migrated `/awards` family. |

## Not served on getmindy.ai
| route | note |
|---|---|
| `/` (`src/app/page.tsx`) | On getmindy.ai, `/` is rewritten by host to `/today` (migrated), and `mi.govcongiants.com/` 308s to getmindy.ai. This legacy page renders only on other hosts (deployment URLs, localhost) and carries the Supabase auth-recovery redirect. It is the same frozen-rollback class as `/mindy-landing`. |

## Not pages
| route | note |
|---|---|
| `/bd-assist`, `/content-generator`, `/federal-market-assassin`, `/market-explorer`, `/mindy`, `/store`, `/partners` | redirect only, nothing renders |
| `/test-protocol` | internal, `noindex` |
| `/design-fixtures/*` | test fixtures, 404 in production |
| `/sitemap*.xml`, `/robots.txt`, `/.well-known/*`, `/api/*`, `/mcp/[transport]`, `/chatgpt/mcp`, `/oauth/*` | machine endpoints |

## Static legacy HTML in `public/` (not Next routes)
Self-contained legacy files served as-is. Each is its own artifact and would need its own decision (retire, redirect or rebuild). They are not covered by the design gates.

- `/prime-lookup.html` (live 200; still loads `public/contracts-data.js`; see CLAUDE.md)
- `/content-generator/*.html` (Content Reaper tool UI: index, auth, calendar, library, pricing, unlock, payment-success, reset-password)
- `/database.html` (307, gated)
- `/recompete.html` (308s to the Recompetes panel)
- `/resources/*.html` (7 lead-magnet resources) and `/templates/*.html` (4 templates)
