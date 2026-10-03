# Public design migration, PR 4: scope proposal (2026-10-03)

Branch `design/public-site-legacy` (from `main` @ d21e4597). **Proposal only; no code has changed.**
Method: every top-level `src/app` route not yet opted in was probed on production (status, redirect, robots, sitemap, branding, auth code). Raw data: 70 route dirs; 40 return 200 at the top level.

Fixed out of scope (per instruction): `/gov/market-research`, award issue #1786 (and `/contracts/[piid]`, which feeds it), authenticated pages, all data behavior, routing.

## Cohort A: `ProductPageAppSumo` family (IN)
One shared component (`src/components/ProductPageAppSumo.tsx`) plus the 13 pages that render it.

| route | prod | note |
|---|---|---|
| `/action-plan-2026` | 200 | |
| `/ai-prompts` | 200 | |
| `/december-spend` | 200 | |
| `/expiring-contracts-csv` | 200 | |
| `/guides-templates` | 200 | |
| `/sblo-directory` | 200 | |
| `/tier2-directory` | 200 | |
| `/tribal-list` | 200 | |
| `/content-generator-product` | 308 → `/` | source migrates with the component; redirect untouched |
| `/contractor-database-product` | 308 → `/` | same |
| `/expiring-contracts` | 308 → `/` | same |
| `/market-assassin` | 308 → `/` | same |
| `/contractor-database` | 307 → `/database-locked` | same |

## Cohort B: legacy public marketing / SEO pages (IN)
| route | prod | why it's public |
|---|---|---|
| `/top` (+65 list pages) | 200, in sitemap | SEO rankings; renders MeetMindyStrip / MemberAwareCta / ShareButton (PR 1 left their `appearance="public"` switch for this PR) |
| `/up-for-grabs` | 200 | public content page; same shared CTAs |
| `/weird` | 200 | public content page; same shared CTAs |
| `/shared/opp/[shareId]` | share link | public share page; same shared CTAs |
| `/about` | 200, in sitemap | |
| `/free-resources` | 200, in sitemap | |
| `/enterprise` | 200 | sales page |
| `/lifetime` | 200 | Founders sales page |
| `/mindy-intelligence` | 200 | "How Mindy Works" landing |
| `/bundles/{starter,pro,ultimate}` | pages | bundle sales pages |
| `/database-locked`, `/market-assassin-locked` | 200 | legacy product "locked" landings, still titled "… \| GovCon Giants" (title stays; parity) |
| `/legal/referral-terms` | page | public legal text (like `/terms`) |
| `/ncmbc`, `/mdeat` (via `PartnerLandingPage`) | 200 | partner landings |

## Cohort C: decision needed (proposed OUT unless you say otherwise)
| route | why it's borderline |
|---|---|
| `/mindy-landing` | the **rollback homepage** (next.config.ts rollback target). Restyling it changes the rollback. Proposed: leave as the frozen rollback. |
| `/home-redesign` | old "GovCon Giants" homepage experiment, dark. Unlinked? Proposed: leave (or retire separately). |
| `/start` | 535-line client funnel page. Need to confirm it's a public signup funnel vs an onboarding step. |
| `/dsbs-scorer` | 772-line client tool, signed-out usable? Tool UI, not marketing. |
| `/reports/[id]` | customer **deliverable** (the market report a user sends a client). Brand artifact, not site chrome. Proposed: separate decision. |
| Transactional confirmations: `/purchase/success`, `/feedback/{thanks,error}`, `/pursuit-brief/{requested,error}`, `/mindy-day/confirmed`, `/alerts/signup` | public but noindex-style post-action pages. Proposed: OUT (touch auth/checkout flows). |

## Cohort D: OUT (authenticated, auth flows, internal)
- App/tool shells: `/briefings`, `/agency`, `/pipeline`, `/contacts`, `/planner`, `/onboarding`, `/alerts/preferences`, `/command-center` (re-exports admin).
- Auth/account flows: `/signup`, `/activate`, `/access`, `/forgot-password`, `/reset-password`, `/setup-password`, `/setup-account`, `/welcome`, `/auth/callback`, `/checkout/[product]`.
- Internal/noindex or non-page: `/test-protocol`, sitemaps, `/chatgpt/mcp`, redirect-only routes (`/bd-assist`, `/content-generator`, `/federal-market-assassin`, `/market-explorer`, `/mindy`, `/store`, `/partners`).
- `/contracts/[piid]` (award-detail path, #1786).
- Static `public/*.html` (e.g. `prime-lookup.html`, `content-generator/index.html`): separate artifacts, not routes.

## Plan once scope is signed off
Same protocol as PR 2/3: family layouts / `PublicShell`; recolor codemod plus hand fixes; `appearance="public"` on the shared CTAs; add every file and route to `opt-in.json`; parity against prod, runtime checks at desktop and mobile, `/mcp/account` and map-chrome controls; screenshots; stop before merge.
