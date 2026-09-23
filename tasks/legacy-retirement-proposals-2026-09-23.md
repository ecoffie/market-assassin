# Legacy retirement — separate proposals (NOT executed) — 2026-09-23

Companion to PR #1671 and its review packet (`tasks/retire-legacy-ma-interfaces-2026-09-23.md`).
Everything here is a **proposal for approval**. No payment link, price, subscription, grant, env var
or production row has been changed. All figures were read from Stripe / Vercel / KV **read-only** on
2026-09-23.

---

## A. Stripe — payment links (retire legacy checkouts, repoint Mindy success URLs)

| Payment link | Product / price | Active | Paid checkouts (last) | After completion now | Proposal |
|---|---|---|---|---|---|
| `plink_1TTYfRK5zyiZ50PBkZ4mukPq` | Market Intelligence (Mindy Pro) $149/mo | yes | 58 (2026-09-22) | redirect `getmindy.ai/briefings?welcome=true` | **Keep active.** Change redirect → `https://getmindy.ai/app` |
| `plink_1TTYhlK5zyiZ50PBGhvWwBLq` | Market Intelligence (Mindy Pro) $1,490/yr | yes | 4 (2026-06-27) | same | **Keep active.** Change redirect → `https://getmindy.ai/app` |
| `plink_1TBXg2K5zyiZ50PBp5xvOJP2` | **Alert Pro** $19/mo | yes | 2 (2026-07-22) | redirect `…/alerts/preferences?upgraded=true` | **Deactivate** (product retired; nothing on the site links it after this PR) |
| `plink_1SlcMfK5zyiZ50PBVn60ByyO` | **Federal Contractor Database** $497 | yes | 5 (2026-07-21) | hosted confirmation | **Deactivate.** ⚠️ Urgent-ish: the webhook's `contractor_db` branch writes **no `dbaccess:` KV**, so recent buyers may hold no access anywhere (see C.2) |
| `plink_1SxuVtK5zyiZ50PBmxd7LM9F` | Ultimate Giant Bundle (discount) $1,497 | yes | 5 (2026-05-26) | hosted confirmation | **Deactivate** (legacy bundle; `/bundles/ultimate` now → `/pricing`) |
| `plink_1TND04K5zyiZ50PBQ1WruM46` | Ultimate Giant Bundle (discount) $500 | yes | 1 (2026-04-27) | hosted confirmation | **Deactivate** |
| `plink_1SzGrLK5zyiZ50PBS9w6qvI7` | Upgrade to Tool Bundle $500 | yes | 2 (2026-02-18) | hosted confirmation | **Deactivate** |
| `plink_1TJVGDK5zyiZ50PBquMd5dEj` / `plink_1TJVSFK5zyiZ50PBjM2WbMaX` | Market Intelligence $49/mo / $497/yr | yes | — | `/purchase/success?product=briefings(_annual)` | **No change** — current Mindy product at private loyalty pricing |

Not Mindy products (out of scope, unchanged): OpnGovIQ seats, Mastermind, BD packages, coaching,
consultant meetings, Academy, White Glove, Whitty Cap, SWC sponsorship.

Code follow-up after deactivation: remove the dead `stripeUrl`s in `src/lib/products.ts`
(`CONTRACTOR_DATABASE`, `ULTIMATE_GOVCON_BUNDLE`) and the hard-coded Content Reaper links in
`public/content-generator/index.html`.

## B. Subscriptions (inventory; no billing changes)

| Cohort | Count (active) | What it grants in Mindy today | Proposal |
|---|---|---|---|
| **Alert Pro** `prod_U9rOClXY6MFcRu` | **1** — `sub_1TvookK5zyiZ50PBWnM2pa8R`, customer `cus_UvgBo8DqEWUFKN`, renews **2026-10-22**, not cancelling (1 more already cancelled 2026-07-21) | `alertpro:` + **`ospro:` → full Mindy Pro**, daily alerts on the shared preferences row | Eric decides one of: **(a)** keep the $19 billing and keep Pro (grandfathered; nothing to do), **(b)** email them the Mindy Pro offer before 2026-10-22 and cancel-at-period-end only after they accept, **(c)** move them to the $49 loyalty price. Do **not** cancel or remove grants without contact. |
| Mindy Pro $149/mo | 36 active + 4 past_due | `briefings:` | none |
| Mindy Pro $1,490/yr | 4 | `briefings:` | none |
| Mindy legacy $49/mo, $497/yr, $499/mo | 1 / 1 / 1 | `briefings:` | none |
| FHC memberships (`fhc_membership`) | ~24 | webhook writes `ma:` + `alertpro:` + `ospro:` → Pro | none (FHC is a current membership) |
| Mindy MCP (Entry/Mid) | 5 | MCP credits | none |

## C. Grant/provisioning defects found (not fixed in #1671 — they change grants)

1. **Alert Pro cancellation leaves Pro behind.** `stripe-webhook` (subscription-deleted branch)
   deletes `alertpro:` only; `ospro:` and `access_hunter_pro` stay → a cancelled $19 customer keeps
   $149 Pro. Proposal: delete `ospro:` in that branch **unless** another product also granted it
   (FHC does). Needs a decision on what a cancelled Alert Pro customer should keep.
2. **Contractor Database purchases write no KV.** The `contractor_db` webhook branch only sets
   Supabase flags + emails `/contractor-database?email=` — the gate reads `dbaccess:` KV, so the
   buyer is refused. Audit the 5 paid checkouts on `plink_1SlcMf…` (read-only) and grant `dbaccess:`
   where missing — **after** approval.
3. **Content Reaper is sold as a Mindy Pro feature but Pro is rejected by the tool.** Removed from the
   `/market-intelligence` comparison in #1671; the tool still checks `contentgen:` only.

## D. Shared passwords — transition + security

| Route | Credential | Default in source | Set in prod? | Grants | After #1671 |
|---|---|---|---|---|---|
| `POST /api/verify-ma-password` | shared MA password | yes (hard-coded fallback) | **No** — `MA_ACCESS_PASSWORD` absent from the 111 production vars (names checked read-only) → **the source default is live** | anonymous cookie `ma_access_email=authorized-user` | the cookie opens nothing but a redirect into `/app` (grace closed by default). **Still:** `generate-all` treats the cookie value as an "email" → anonymous **free-tier** report generation under one shared rate-limit bucket |
| `POST /api/verify-recompete-password` | shared Recompete password | yes (hard-coded fallback) | not in prod var names | cookie `recompete_access=authorized-user` | **read by nothing** — `/recompete` no longer has a gate |
| `POST /api/verify-db-password` | *(misnamed)* — checks the typed **email** against `dbaccess:` KV | — | — | `db_access_email` cookie | unchanged (Contractor DB is an open migration gap) |

Who holds the MA shared password is unknowable (anonymous cookie). What it bought: FREE-tier
reports — proven in the acceptance run (the anonymous cookie resolves to `accessTier: 'free'`).

**Transition (bounded — no indefinite old-interface exception):**
1. #1671 ships with the grace window **closed** (default): anonymous holders go to `/app`, where a free
   Mindy account gives the same free-tier reports. If Eric wants a courtesy window, set
   `LEGACY_SHARED_PASSWORD_ACCESS=on` at release with a fixed end date (proposal: 30 days) and a
   notice to the community where the password was shared, then **unset** it on that date.
2. Security PR (separate): delete `/api/verify-ma-password` and `/api/verify-recompete-password`
   (or, at minimum, remove the hard-coded fallbacks so an unset env fails closed), and stop
   `getEmailFromRequest` from treating a non-email cookie value as an identity.
3. After the window: remove the `keepFor`/grace code from `legacy-routes.ts`.

## E. Unresolved functionality gaps (entry points NOT retired, deliberately)

| Legacy product | What customers have that Mindy lacks | Proposed Mindy work |
|---|---|---|
| **Content Reaper** (`contentgen:`) | LinkedIn post generator (up to 30/click, templates), quote graphics & carousels (Full Fix), .docx/.zip/PDF export, saved `content_library`, 30-day `scheduled_posts` calendar | Either a `/app` Content panel that embeds the existing tool under Mindy auth (accepting any Pro tier), or a rebuild. Note: its 30-day calendar and carousel already call missing APIs. |
| **Federal Contractor Database** (`dbaccess:`) | SBLO name/email/phone for ~3,500 primes, subcontracting-plan / supplier-portal filters, CSV export | Load the SBLO/portal columns into the Contractors panel data + CSV export; then retire `/contractor-database`, `/database.html`, `/database-locked` |
| **Action Planner** (`/planner`, env access code) | 36-task plan with notes/due dates/progress (`user_plans`, `planner_gamification`), PDF export | A tasks view in `/app` reading `user_plans`, or an explicit decision that it is a separate product |
| Opportunity Hunter (retired into Research) | CSV export of the agency list; per-office "Office ID → SAM" drill | Add both to the Research panel |
| Recompete Tracker (retired into Recompetes) | CSV/Excel/PDF export; incumbent-name search; contract-value filter | Add to the Recompetes panel |
