# Repair Ledger — the running tally of fixes (audit against reverts)

**Why this exists (Eric, 2026-07-27):** "Earlier I saw Draw was fixed, now it's messed up
again. What would help is a ledger of repairs — a running tally we can audit to make sure
nothing reverted." Concurrent Claude sessions share one checkout and switch branches under
each other; a fix can silently disappear, or a **stale preview** can *look* like a revert when
the code is actually fine. This ledger is the source of truth for "is fix X still in?"

## How to use it

- **Every non-trivial fix/feature gets ONE row here, in the same commit as the fix.** No row =
  not shipped, same rule as slash commands in CLAUDE.md.
- Each row carries a **PROOF anchor**: an exact string that must be present (`grep`-able) in a
  named file. That's what makes the ledger *auditable* rather than a memory.
- **To audit** (catch reverts): run `npm run ledger:audit` (or `node scripts/audit-repair-ledger.mjs`).
  It re-greps every proof anchor against `main` (or the current tree) and reports any that
  VANISHED — those are real reverts. A green audit means every recorded fix is still present.
- **A stale/old PREVIEW is not a revert.** Before filing "X reverted", confirm the preview URL
  is built from a commit that *contains* the fix — the audit checks the CODE, not a screenshot.
- Newest at the top. Never delete a row; if a fix is intentionally rolled back, add a new row
  documenting the rollback and set the old row's Status to `SUPERSEDED by <date>`.

## Columns

`Date` · `Area` · `Fix` · `Proof anchor` (string → file) · `Verified` (how proven) · `Status`

---

## Opportunity Map

| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-07-27 | Map · Draw button | Draw button is **plain text "Draw", no icon** (copy Zillow) — no pen-nib SVG | `'<button class="mpill" id="drawBtn">Draw</button>'` → `src/app/opportunity-map/route.ts` | grep in main + branch; both plain text | ✅ LIVE (main) |
| 2026-07-27 | Map · Draw button | Draw button positioned **top-right** of the map (was lost to bottom during a refactor) | `id="drawBtn"` rendered in the top-right map-control group | screenshot 08-18 shows top-right | ✅ LIVE (main) |
| 2026-07-27 | Map · Top bar | Set-aside top-bar pill **replaced by Agency pill**; set-aside moved into Filters | `id="agencyBtn"` present; no top-bar `saselBtn` in the bar | filter-parity tests; PR #511 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Top bar | Notice-type top-bar select **replaced by Value pill** (range + histogram + 2-knob slider, $2M cap) | `id="valPanel"` → `src/app/opportunity-map/route.ts` | PR #505/#507/#509/#510 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Header | Data-source badge **removed from sidebar header** → drawer Overview only | no data-source badge in the sidebar header block | verified on prod | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters (Awarded) | **SAP-friendly / recompete-likelihood / expiring-within** filters added, recompete-only (no dead controls); no "low" likelihood (0 rows) | `contract_type', ['PURCHASE ORDER', 'BPA CALL']` → `src/app/api/app/recompete-map/route.ts` | 84/84 map tests; **HTTP verified live** — baseline 125,986 → friendly 34,290 / gated 72,098 / high 39,595 / ≤6mo 77,494 / combined 3,446 (all narrow, none zero) | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters (Open) | **SAP-friendly BUYER** filter — 3 honest PO-share tiers (most/somewhat/vehicle) on the buying agency; Open-only (no contract_type on opps); ~1% agencies unclassified, never force-bucketed | `SAM_DEPARTMENT_TIERS` → `src/lib/opportunities/sap-friendly-agencies.ts` | 35 lib+parity tests; **HTTP verified live** — active baseline 9,945 → most 2,050 (21%) / somewhat 7,578 (76%) / vehicle 190 (2%), all narrow, none zero | ✅ LIVE (main) |
| 2026-07-27 | Map · Contacts count | **Search/count honesty** — Companies/Buyers showed "N results" (pre-bbox match count) while the map rendered 0 ("No contacts in view"); now returns `totalInView` + client shows "0 in view · N match — zoom out" | `totalInView: pins.length` → `src/app/api/app/contacts-map/route.ts` | 91 map tests; +4 honesty tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Sort default | A default sort was PRESENTED as a user choice — 'Sort: Deadline (soonest)' in blue by default (meaningless for Awarded; user never set it). Zillow parity: default label = 'Recommended' (neutral, server's own order), a real dimension turns it active, Clear-all resets it. Fixed the template F.sort:'deadline'→'' in BOTH template files | `['', 'Recommended']` → `src/app/opportunity-map/route.ts` | 4 sort tests + 99 map tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters panel | Density + typography + REORG (unpaused): fixed placeholder bug (JS “ escape in HTML attr); removed duplicate .mf-sec rule ('different fonts'); hairline group dividers + tighter density; REORDERED to the bidder's question — What they buy · Who's buying · Location · Timing · [FIT: Set-aside·How this buyer buys·Value] · Notice type · Refine | `border-top:1px solid var(--hair)` → `src/app/opportunity-map/route.ts` | 99 map tests; preview-verified (divider preserved through the Filters design pass) | ✅ LIVE (main) |
| 2026-07-27 | Auth · Sign-in layout | Password sign-in is now the PRIMARY always-on form, co-equal with magic-link/OAuth (not a toggle): removed the '🔑 Sign in with a password' reveal-toggle + the separate magic-link-only view; magic-link is an inline 'one-time sign-in link' button under the password fields | `Email me a one-time sign-in link` → `src/app/app/page.tsx` | 5 sign-in tests; tsc clean | 🟡 IN REVIEW (branch feat/password-signin-coequal) |
| 2026-07-27 | Home page | Removed the temporary 'Beta user? Already getting Mindy alerts — set up your account' card (email-only-cohort onboarding). Recovery now handled everywhere (Sign in + Forgot password), so the standalone card is redundant | `MindySignupForm` (beta card gone above it) → `src/app/mindy-landing/page.tsx` | tsc clean | ✅ LIVE (main) |
| 2026-07-27 | Auth · Password default | Sign-in now DEFAULTS to password (was magic-link-first) — mature-SaaS pattern; magic-link kept as the 'sign-in link instead' alternative + OAuth still shown | `useState(true)` (usePasswordSignIn) → `src/app/app/page.tsx` | 3 sign-in tests; tsc clean | ✅ LIVE (main) |
| 2026-07-27 | Auth · Password recovery | 'Forgot password' was MISSING/broken: /app/forgot-password sent a MAGIC LINK not a reset; no 'Forgot password' link on sign-in/home/MCP; OAuth+passwordless users couldn't SET a password. Fixed: forgot-password now hits mi-password-reset (real recovery→/app/reset-password); 'Forgot password?' link added to sign-in form, home page, + OAuth consent; copy invites passwordless users to set one | `mi-password-reset/request` → `src/app/app/forgot-password/page.tsx` | reset endpoint 200 on prod; tsc clean | ✅ LIVE (main) |
| 2026-07-27 | Map · Filters design | Design pass: ONE consistent type scale (group 14/700 · label 13/600 · input 14/500 — fixed mixed label sizes); uniform spacing rhythm (fixed the 'clumped' Expiring-within row that had a -2px collapse); uniform 44px inputs/selects/chips w/ custom select caret + accent; titled panel header w/ close X; premium shadow/radius | `class="mf-head"` → `src/app/opportunity-map/route.ts` | 107 map tests; preview visual-verify | ✅ LIVE (main) |
| 2026-07-27 | Map · Card badges | Cards repeated the DATASET label on every row ('Open on SAM'/'Target'/'Company'/'Buyer') — redundant (section header + color strip already say it). All 4 datasets now lead with UNIQUE per-card info: Open→posted freshness, Awarded→real award TYPE, Company→set-aside chips only, Buyer→none (role in meta) | `function cardBadge` → `src/app/opportunity-map/template.html` | 107 map tests | ✅ LIVE (main) |
| 2026-07-27 | Template sync gate | FOUND: the map SERVES template-html.ts but it was OUT OF SYNC with template.html (edits silently never shipped). New scripts/gen-template-html.mjs regenerates it; pre-push step 1c blocks drift | `scripts/gen-template-html.mjs` → `scripts/gen-template-html.mjs` | --check gate proven | ✅ LIVE (main) |
| 2026-07-27 | Updates page | Zillow saved-search CARD treatment: was a plain 1-line row w/ on/off toggle. Now bold title link + 'N new' badge + filters as CHIPS + 'View on map' + a Daily/Weekly/Off email-FREQUENCY control wired to the real alert_frequency field (was hidden) | `class="freq"` → `src/app/opportunity-map/saved/route.ts` | tsc clean; 99 map tests; preview-verify | ✅ LIVE (main) |
| 2026-07-27 | Favorites page | Added the Zillow-style CONTROL BAR the page was missing: count + status breakdown (open/closing-soon/closed) + a 'Showing all' FILTER dropdown + a 'Date added/Deadline/Value' SORT dropdown (client-side, no dead options) | `class="ctlbar"` → `src/app/opportunity-map/favorites/route.ts` | script parse-checked + tsc | ✅ LIVE (main) |
| 2026-07-27 | Map · Company list cards | Company/Buyer sidebar cards brought to Awarded-card polish: color strip + chip + title + meta + a real .stats facts GRID (Won/Awards/Agencies) + footer with 'View details' (was chip+title only) | `class="stats"` → `src/app/opportunity-map/route.ts` | 99 map tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Awarded naming | Killed FABRICATED titles ('Manufacturing recompete' = service-line+'recompete', un-googleable); title = real INCUMBENT; each card labeled by real award TYPE (IDIQ vehicle/Task order/…) from contract_type | `function contractTypeLabel` → `src/app/opportunity-map/route.ts` | 97 map tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Award charts | Company Award-history now uses the Awarded-contract format (summary banner + chart + ledger); BOTH charts CONDENSED into readable time-period buckets (quarter/year) with the $ labeled on each bar | `function bucketedChart` → `src/app/opportunity-map/route.ts` | 93 map tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Company drawer | Overview brought to Open-drawer DENSITY: 6-cell grid (added Active-since + Primary-buyer) + value headline gains "across N awards · M agencies" subline | `Active since` → `src/app/opportunity-map/route.ts` | 93 map tests | ✅ LIVE (main) |
| 2026-07-27 | Map · Company drawer | Deep-link `?company=` now forces company sort scope so the header never shows a stale "Deadline (soonest)" for a firm | `__setSortScope('company')` → `src/app/opportunity-map/route.ts` | contacts-count-honesty test | ✅ LIVE (main) |
| 2026-07-27 | Map · Recompete pins | Task-order **city precision** honored (`map_loc_source==='task_order_city'` → precision:'city') so ~99.6K recovered cities aren't invisible | `map_loc_source === 'task_order_city'` → `src/app/api/app/recompete-map/route.ts` | #506 verified live | ✅ LIVE (main) |
| 2026-07-27 | Map · Industry pill | Industry dropdown is the human-first primary selector; NAICS/PSC live in Filters | `__INDUSTRY_PRESETS` build + `id="naicsBtn"` | verified live | ✅ LIVE (main) |

## Other-session fixes (concurrent — email / billing / MCP)

Backfilled 2026-07-27: these landed on main from PARALLEL sessions while the map work was in flight.
The ledger must record them too, or a revert of one goes unnoticed (the ledger only catches what it
records). Anchors verified present in main at backfill time.

| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-07-27 | Email · Resend webhook | Store open/click/delivered events → engagement counters (webhook was dead-domain blind before) | `case 'email.delivered':` → `src/app/api/webhooks/resend/route.ts` | landed via other session | ✅ LIVE (main) |
| 2026-07-27 | Billing · Stripe invariants | Money-shaped drift guard — every `price_…` id referenced in src is validated (archived price / dead payment-link would fail silently) | `Every ` + "`price_…` id referenced anywhere in src/." → `src/lib/data-invariants/stripe-refs.ts` | landed via other session | ✅ LIVE (main) |
| 2026-07-27 | MCP · Free credits | The signup free-credit number comes from the API, not a hardcoded literal (fell back to 100 only on failure) | `const [signupCredits, setSignupCredits] = useState(100)` → `src/app/oauth/authorize/page.tsx` | landed via other session | ✅ LIVE (main) |
| 2026-07-27 | MCP · OAuth consent | OAuth consent dead-ended new users; now surfaces the 100 free credits so the connect flow completes | `signupCredits` → `src/app/app/page.tsx` | landed via other session | ✅ LIVE (main) |
| 2026-07-27 | MCP · Auto-recharge | Stale auto-recharge package id → log the fallback + a data-invariant watches for it | `autorecharge` → `src/lib/mcp/autorecharge.ts` | landed via other session | ✅ LIVE (main) |

## Guardrails / gates (meta-repairs)

| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-07-27 | Client-JS gate | `check-drawer-js.mjs` cooks each map `<script>` template + `new Function()`-parses it (tsc can't see syntax errors inside template literals) | `scripts/check-drawer-js.mjs` exists; pre-push step 1b | runs green this session | ✅ LIVE |
| 2026-07-27 | Ledger-coverage gate | Pre-push step 11: HARD — every ledger anchor must still resolve (a vanished anchor = a revert → block); WARN — a substantive src/ feat\|fix push adding no ledger row is flagged. Keeps the ledger COMPLETE so its audit covers everything (not just the authoring session). | `scripts/audit-ledger-coverage.mjs` → `scripts/audit-ledger-coverage.mjs` | warn + hard paths both proven | ✅ LIVE |

---

*Seeded 2026-07-27. Add a row in the SAME commit as every fix. Audit with `npm run ledger:audit`.*
