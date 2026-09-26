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
| `plink_1SlcMfK5zyiZ50PBVn60ByyO` | **Federal Contractor Database** $497 | yes | 5 (2026-07-21) | hosted confirmation | **Deactivate — treated as a separate URGENT incident:** `tasks/incident-contractor-db-checkout-2026-09-23.md`. All 5 payments reconciled: 4 have access; **1 (2026-07-21, $894) paid and has none** |
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
| **Alert Pro** `prod_U9rOClXY6MFcRu` | **1** — `sub_1TvookK5zyiZ50PBWnM2pa8R`, customer `cus_UvgBo8DqEWUFKN`, renews **2026-10-22**, not cancelling (1 more already cancelled 2026-07-21) | `alertpro:` + **`ospro:` → full Mindy Pro**, daily alerts on the shared preferences row | **Recommendation: grandfather.** Keep the $19/mo price and the subscription exactly as they are, with their existing access (`alertpro:` + `ospro:` → Mindy Pro). The Alert Pro *interface* is retired in #1671 and they land in Mindy, but their billing is not touched. No price change, no migration, no cancellation, no email without Eric's explicit approval. Deactivating the Alert Pro **payment link** (§A) stops new sales and does not affect this existing subscription. |
| Mindy Pro $149/mo | 36 active + 4 past_due | `briefings:` | none |
| Mindy Pro $1,490/yr | 4 | `briefings:` | none |
| Mindy legacy $49/mo, $497/yr, $499/mo | 1 / 1 / 1 | `briefings:` | none |
| FHC memberships (`fhc_membership`) | ~24 | webhook writes `ma:` + `alertpro:` + `ospro:` → Pro | none (FHC is a current membership) |
| Mindy MCP (Entry/Mid) | 5 | MCP credits | none |

## C. Grant/provisioning defects found (not fixed in #1671 — they change grants)

1. **Cancellation revoked the wrong things. FIXED separately in HELD PR #1675**, not in #1671.
   - Alert Pro cancellation left `ospro:` (Pro) behind.
   - FHC cancellation wiped unrelated MA/OH purchases, other live subscriptions and comps.
   - Both fired during Stripe's `past_due` retry window.
   - Both reset the alert-frequency preference.

   #1675 revokes only the access attributable to the cancelled subscription. It keeps other purchases,
   comps and live subscriptions, expires paid-through access at period end, and keeps access when
   attribution is uncertain. It does not retroactively re-grant anyone the old code wiped; that needs
   a separate, approved audit.
2. **Contractor Database purchases write no KV.** Now its own incident:
   `tasks/incident-contractor-db-checkout-2026-09-23.md`. All five payments are reconciled there,
   with the exact disable and repair actions. One buyer lacks access.
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

## E. Migration table — purchased capability → Mindy (no deletion, no indefinite exception)

Rule for every row: the legacy entry point stays reachable **only** until its Mindy equivalent
ships. Then it redirects like the rest of #1671 and the entitlement key becomes an entitlement marker
only. Nothing purchased is deleted. "Reuse" means the existing code or data moves behind Mindy auth;
nothing is rebuilt from scratch.

### Content Reaper (`contentgen:`, $197 / $397 Full Fix)

| Purchased capability | Current Mindy equivalent | Actual gap | Proposed implementation |
|---|---|---|---|
| LinkedIn post generation (≤30/click, agency + template targeting) | **None.** The `/app` panel list has no content panel. `/api/content-generator/generate` exists and works. | Not reachable from Mindy; gated on `contentgen:` only, so Mindy Pro is refused even though Pro is sold as including it | Add a `content` panel in `/app` that hosts the existing `public/content-generator` UI (keep `API_BASE=''`). Gate: `contentgen:` **OR** Mindy Pro. Reuse the generate API unchanged. |
| Saved posts (`content_library`) | Library panel exists but reads `user_generated_archive`, **not** `content_library` | Saved Reaper posts are invisible in Mindy | Library API: union `content_library` rows for the user as type `linkedin_post`. Read-only merge, no data move. |
| .docx / .zip / PDF export | None in Mindy | Export only exists inside the legacy page | Comes along with the hosted UI (client-side export code moves as-is) |
| Quote graphics / carousels (Full Fix) | None | The carousel calls APIs that are **missing today** (already broken on legacy) | Hide these in the hosted panel until repaired, and say so. Repairing is a separate item; never show a dead button. |
| 30-day calendar (`scheduled_posts`) | None | Calendar also calls **missing** APIs (already broken) | Same as carousels: hidden with a stated notice; repaired later |

### Federal Contractor Database (`dbaccess:`, $497)

| Purchased capability | Current Mindy equivalent | Actual gap | Proposed implementation |
|---|---|---|---|
| ~3,500 primes, searchable | **Contractors panel** (317K firms via BigQuery `search-bq`) | none for discovery (Mindy is a superset) | none |
| SBLO name / email / phone per prime | The panel's type declares `sblo_name/email/phone`, but `search-bq` returns **no SBLO columns** | Contact data a buyer paid for is not shown | Join the existing `src/data/prime-contractors-database.json` + `sblo-roster-2026-06.json` (by UEI, then normalized name) into `search-bq` results. Display email/phone to `dbaccess:` holders **and** Pro. |
| Subcontracting-plan / supplier-portal filters | `has_subcontract_plan` field exists in the type; no filter in the UI | Filters missing | Add two filter chips backed by the same joined data |
| CSV export | None in the panel | Export missing | Client-side CSV of the current filtered rows (cap stated in the UI, not silent) |
| After parity | — | — | Redirect `/contractor-database`, `/database.html`, `/database-locked` → `/app?panel=contractors` |

### Action Planner (`/planner`, env access code, separate planner Supabase)

| Purchased capability | Current Mindy equivalent | Actual gap | Proposed implementation |
|---|---|---|---|
| 36-task, 5-phase plan with notes, due dates, progress (`user_plans`, `planner_gamification`) | None | Whole tool; data lives in a **different Supabase project** (`getPlannerSupabase`) | `/app?panel=planner` reusing the existing `src/app/planner` components. It reads through `src/lib/supabase/planner.ts` with the **existing planner client** and does not copy data between projects. Identity: match the planner account by the Mindy session email. |
| Lessons / resources pages | None | Static content | Move pages under the panel as-is |
| PDF export | None | Export missing | Comes with the reused components |
| Planner login (separate password) | Mindy sign-in | Two logins | After the panel ships, `/planner/login` → `/app?panel=planner` with an email-match handoff. Users with no match are shown their planner email, never a fresh empty plan. |

### Missing exports / filters on already-retired products

| Purchased capability | Current Mindy equivalent | Actual gap | Proposed implementation |
|---|---|---|---|
| Opportunity Hunter: agency-list CSV | Research panel (same agency data) | No CSV | CSV button on the Research agency list |
| Opportunity Hunter: office ID → SAM drill | Research panel shows offices | No drill link | Link office IDs to the existing office/DoDAAC search |
| Recompete Tracker: CSV / Excel / PDF export | Recompetes panel (129K per-contract rows) | No export | CSV of the filtered vehicles. The cap is labelled, and when capped it states "6,000+". |
| Recompete Tracker: incumbent-name search | Recompetes panel filters by NAICS/agency | No incumbent search | Add `incumbent` to `/api/recompete` → `queryExpiringContracts` (shared lib, so the MCP tool gets it too) |
| Recompete Tracker: contract-value filter | none | No value filter | Min/max on `potential_total_value` in the same shared query |

Suggested order: Contractor DB (buyer #5 is actively unserved) → Content Reaper (sold inside Pro but
refused) → exports/filters → Planner.
