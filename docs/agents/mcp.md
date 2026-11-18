# Mindy MCP server and tool catalog

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## One fix = every surface — now a GATE (`scripts/audit-tool-catalog-drift.mjs`, Jul 17 2026)

The MCP tool catalog lives on FOUR surfaces: **`tool-registry.ts` (source of truth)** ·
`docs/marketing/MCP-WHITEPAPER.md` · its generated `.docx` · the **claude.ai Tool Map
artifact**. The global CLAUDE.md rule *"changing one means changing all four in the same
pass"* has existed since June. It kept drifting anyway:

| surface | claimed | actual |
|---|---|---|
| `tool-registry.ts` | 49 | ✅ |
| Tool Map artifact | 46 | 3 behind |
| `MCP-CHANGELOG.md` | 41 | 8 behind |
| `MCP-WHITEPAPER.md` | 40 | 9 behind |

**A written rule did not stop it** — it was read and violated by the same session that had
just quoted it. So it is a **hard-blocking step of the pre-push gate** now (the gate has multiple
steps; see `.githooks/pre-push` for current numbering). A wrong tool count ships to
customers; that is not a docs nit.

- **`listMcpTools()` is the authority — never a grep.** Tools register on TWO paths
  (`tool-registry.ts` def + `server.ts` zod), and a grep has already made live tools look
  missing.
- The artifact can't be linted from here, so its contents are mirrored in
  **`docs/mcp-tool-catalog.json`**. That mirror is the promise you keep by hand; a BROKEN
  promise now fails the push instead of shipping.
- **Workflow:** update the artifact + docs → `node scripts/audit-tool-catalog-drift.mjs --update`
  → rerun `scripts/build-whitepaper-docx.mjs` (the `.docx` is generated from the `.md`).
- `--list` prints the live names. Proved it blocks: a stale prose count AND an artifact
  missing a tool both exit 1.

⚠️ **A mutating tool must be visible as one.** `add_contacts_to_crm` writes to the user's
own GoHighLevel CRM (upsert → can overwrite fields) and is annotated `destructiveHint` in
`tool-schemas.ts`. The artifact claimed *"no tool mutates an external system"* long after
that shipped. 48 of 49 are read-only; say so precisely, and re-check the claim when adding
a tool. (`mcpRegistrationList()` auto-derives a `title` for tools absent from `TOOL_META`,
so that surface self-heals — the annotation does NOT.)

---

## Mindy MCP Server — Phase 1 platform: billing / auth / transport (SHIPPED 2026-07-12)

A hosted, **credit-metered** MCP server (`mcp.getmindy.ai`) exposing Mindy's GovCon
intelligence to any MCP agent, with a self-serve dashboard at **`getmindy.ai/mcp`**.
All of Phase 1 is merged to `main` + every migration run & verified live (PRs #118–128).

**Slices shipped:** keys → edge auth → tool registry → **atomic credit ledger** →
**hybrid credits** (top-ups + Pro monthly allowance) → **hosted metered HTTP transport**
→ data-core tools → dashboard. `_ai_hint` gated OFF by default (data-first — see below).

**The billing model:**
- **Free 100 credits on a user's FIRST connect** (first key OR first keyless OAuth connect; `grantSignupCreditsIfFirst`, env `MCP_SIGNUP_CREDITS`, default 100 as of 2026-07-13; re-minting can't farm — gated on "no balance row yet"). One-time B2B trial (≈ one real evaluation), NOT a recurring grant.
- **Debit-on-success only, atomic.** `runMeteredTool` (`src/lib/mcp/metered.ts`) pre-checks balance → runs the tool → debits on success / **0 on failure**; zero-balance is rejected with a top-up message before the tool runs.
- **Atomicity is in Postgres**, not app code: `mcp_debit_credits` / `mcp_grant_credits` / `mcp_apply_credit` — the `UPDATE … WHERE balance >= amount RETURNING` (and `INSERT … ON CONFLICT DO NOTHING`) ARE the gates. 100 concurrent debits can't corrupt the balance (verified live); balance never < 0.
- **Top-ups are exactly-once** by Stripe session id; **Pro monthly** allowance is exactly-once by `pro:<email>:<YYYY-MM>` — both via `applyCreditOnce` → `mcp_apply_credit`.

**⚠️ THE BILLING SEAM (do not break):** the hosted HTTP edge MUST dispatch tool calls
through **`runMeteredTool`**, NOT raw `runMcpTool`. Raw dispatch = tools run for free.
Any new transport/entry point bills only if it goes through `runMeteredTool`.

**⚠️ ChatGPT-attributed auto-recharge (PR #1778 LIVE, merged `9c24b306`; migration
`20261003_mcp_autorecharge_chatgpt_attribution.sql` applied 2026-10-03 via the runner, prod-accepted):** an automatic card payment is permitted only if the account would still qualify
after removing all ChatGPT-originated consumption in the current ATTRIBUTION WINDOW — the window
opened by the most recent INDEPENDENT FUNDING EVENT. `mcp_credit_balance.chatgpt_spend_since_recharge`
(S) grows only on a PERSONAL debit with `p_channel='chatgpt'` (same UPDATE as the debit); normal and
pool debits never move it. Eligible iff `balance < T AND balance + S < T` (current T) — one rule, in
SQL `mcp_recharge_gate()` (enforced inside `mcp_autorecharge_claim`, before debounce/cap stamping)
and TS `rechargeGate()` (cron pre-filter + engine). A grant whose reason is in the ONE SQL allowlist
`mcp_grant_resets_chatgpt_window()` sets S := 0 in the grant's own statement (auto_recharge,
stripe_topup, pro_monthly, app_tier_pro, app_tier_team, mcp_sub_monthly, mcp_sub_annual); every other
reason — admin, signup/promo, referral, corrections, pool, sponsor, and ANY NEW reason — does not.
**Adding a grant reason?** Classify it in `src/lib/mcp/grant-reasons.ts`; `grant-reasons.unit.test.ts`
scans every `applyCreditOnce`/`grantCredits`/`topUpToCeiling` call and fails on an unclassified one.
Any new surface that debits a personal balance on ChatGPT's behalf MUST pass `channel: 'chatgpt'`
through `runMeteredTool` → `debitResolvedPayer` → `debitCredits`, or its spend can charge a card.
The `/chatgpt/mcp` route (#1776) passes `channel: 'chatgpt'`; proven route→RPC by
`src/app/chatgpt/mcp/__tests__/route.billing-chain.unit.test.ts`.
Open items: `tasks/autorecharge-followups-2026-10-03.md`.

**`capability_market_match` bills by result tier (Option D, owner decision 2026-10-04):**
grounded (company-corroborated) 50 · useful candidate 10 (`billable_candidate`, `CANDIDATE_CREDITS`
in `credit-integrity.ts`) · empty / no defensible market 0 (`nonbillable_no_market`) · degraded 0.
The pre-check still requires the full 50. Matching probes several cleaned candidates in parallel
and picks by a ladder (`selectAnchorFromProbes`); fixture gate =
`src/lib/market/capability-plain-english.unit.test.ts` + live `scripts/verify-capability-match.ts`
(run under `caffeinate -i` — a sleeping Mac turns probe timeouts into false "degraded").
⚠️ Never re-add a word ban (the old global `roofing` reject deleted every real roofer); anchors
must come from the company's own activity words instead.
**Document paging is billed once per retrieval (ChatGPT blocker #2, 2026-10-04).** A
`get_solicitation_documents` call that continues a paid read with the `next_page.continuation`
token is priced 0 in `runMeteredTool` before the balance check (`isFreeDocumentContinuation`,
`src/lib/mcp/doc-continuation.ts`). The token is HMAC-bound to the caller, the exact next windows,
a 6h TTL and `MAX_FREE_CONTINUATIONS` (50); anything else bills as a new retrieval — never refused.
Paging copy is question-driven ("page only when the question needs more"); never restore the
unconditional "call again until next_page is empty" — it cost 90 credits on one prompt.

**Corpus extraction guard (Layers A+B, `src/lib/mcp/extraction-guard.ts`):** protects ONLY
the proprietary tools (`PROPRIETARY_TOOLS` in `tool-registry.ts`: winning-playbook, podcast-
lessons, sblo-contact, federal-osbp) from bulk export — the public-data wrappers stay ungated.
Layer A = free signup credits can't buy proprietary calls (needs PAID standing: a ledger row
with reason `stripe_topup`/`pro_monthly`/`admin_grant`). Layer B = per-account rolling caps
(`MCP_PROPRIETARY_CAP_DAY`=40 / `_WEEK`=150). Wired in `runMeteredTool` right after the tier
gate. **Both flag-gated + default OFF** (`MCP_EXTRACTION_GUARD`); with `MCP_EXTRACTION_ENFORCE`
OFF it's **LOG-ONLY** (writes `shadow_requires_paid`/`shadow_throttled` call-log rows, call
still runs) so you measure impact before enforcing. FAIL-OPEN: a guard-query error allows the
call (never blocks a payer). No migration — `mcp_call_log.status` is unconstrained TEXT.
Rollout: run log-only → read the shadow rows → set caps to the 99th pct of real use → enforce.

**Key files:**
| File | Role |
|---|---|
| `src/lib/mcp/api-keys.ts` | issue/verify/revoke; stores sha256(key) only, shown once |
| `src/lib/mcp/auth.ts` | `authenticateMcpRequest` (Bearer / X-Mindy-API-Key → identity) |
| `src/lib/mcp/tool-registry.ts` | catalog + dispatch + `TOOL_CREDITS` (the tool source of truth) |
| `src/lib/mcp/credits.ts` | `getBalance`/`grantCredits`/`debitCredits`/`applyCreditOnce`/`logCall` |
| `src/lib/mcp/metered.ts` | `runMeteredTool` — the billing wrapper (the seam) |
| `src/lib/mcp/packages.ts` | server-trusted credit packages + `PRO_MONTHLY_CREDITS` |
| `src/lib/mcp/stripe-topup.ts` | `handleMcpCreditTopup(session)` — wired into `api/stripe-webhook` |
| `src/app/mcp/[transport]/route.ts` | hosted HTTP transport (verifyApiKey → runMeteredTool) |
| `src/app/mcp/page.tsx` + `src/app/api/mcp/account/route.ts` + `api/mcp/keys` | dashboard + its APIs |
| `src/app/api/cron/grant-mcp-pro-credits/route.ts` | monthly Pro-allowance grant (idempotent) |
| `src/app/api/admin/mcp-credits/route.ts` | admin grant/read (test credits pre-Stripe) |

**DB tables (all hand-run + verified live):** `mcp_api_keys`, `mcp_credit_balance`,
`mcp_credit_ledger`, `mcp_call_log`, `mcp_credit_topups`, `mcp_external_cache`
(migrations `20260712_mcp_*`). All RLS service-role-only.

**Still Eric's (config, not code):** claim `mcp.getmindy.ai` in Vercel → Domains ·
create Stripe credit products/links (`type=mcp_credit_topup, package=starter|plus|scale`)
+ set final $/credits in `packages.ts` · add the `grant-mcp-pro-credits` monthly cron row
· live click-through (mint key → connect Claude Desktop → call a tool → confirm the debit).

**Multi-session build note:** Phase 1 was built across parallel Claude sessions. Sharing
ONE working tree + `.git` entangled commits (a push carried another session's commit).
Fix + rule: **each concurrent session gets its own `git worktree`** — "separate branches"
alone does NOT isolate a shared `.git`. (Memory: the worktree collision + recovery.)

---

## Mindy MCP Server — Data Core tools (2026-07-12)

The Mindy MCP server exposes Mindy's proprietary + live-API intelligence to any AI agent.
Two transports wrap the **same transport-agnostic pure functions** (`src/mcp/tools/*.ts`):
- **stdio** (`src/mcp/server.ts`) — local dev + smoke (`npm run mcp:dev` / `npm run mcp:smoke`).
- **Hosted HTTP edge** (`src/app/mcp/[transport]/route.ts`) — dispatcher `src/lib/mcp/tool-registry.ts`,
  API-key auth + credit metering (Phase-1 Slice 2/3). `mcp.getmindy.ai` target.

**Tools live (4):** `get_winning_playbook` (proprietary RAG corpus — the moat), `get_pricing_intel`
(GSA CALC labor rates, promoted existing client), `get_incumbent_financials` (SEC EDGAR — public filers
only, private→`grounded=false` honest miss), `get_regulatory_demand` (Federal Register — "demand before SAM"
leading indicator). Credit prices in `TOOL_CREDITS`: playbook=1, pricing_intel=1, incumbent_financials=2,
regulatory_demand=1.

**Tool pattern (follow exactly — `winning-playbook.ts` is the reference):**
- Pure async fn `(input) → Result`. NO transport, NO auth, NO `console.log` (stdout is the MCP wire;
  diagnostics → `console.error`). Both transports wrap it → zero rework.
- `Result` carries `_meta: { grounded, degraded, <counts> }` — **ALWAYS ships** (machine-readable;
  the edge/agent branches on it). `grounded` = ≥1 real row returned; `degraded` = upstream *errored*
  (distinct from a genuine empty result — surface, don't swallow, via catch + `console.error`).
- `_ai_hint: { summary, how_to_use, key_caveats }` — **OPTIONAL, OFF by default** (data-first principle,
  Eric 2026-07-12: the raw grounded DATA is the moat; nothing narrated ships until explicitly enabled).
  Gate it: `if (mcpFlags.aiHint) result._ai_hint = buildHint(...)` (`mcpFlags.aiHint` reads
  `MCP_ENABLE_AI_HINT`, OFF by default; smoke sets it to exercise the layer).
- **No-fabrication contract:** `buildHint` branches `degraded → grounded → else` (the three-way ternary).
  When `!grounded && !degraded`, the hint MUST say "no data found" and instruct the agent NOT to invent.
  Every fact in a grounded hint must trace to the returned data (smoke asserts traceability). Never map a
  record to a NAICS/set-aside the source doesn't carry (Federal Register has NO NAICS tag — say so; do NOT
  invent one). EDGAR: no gov-vs-commercial revenue breakout unless the filer volunteers a segment.

**Shared response cache:** `mcp_external_cache` Supabase table (cache_key md5 UNIQUE, api_type,
query_params jsonb, response_data jsonb, fetched_at, expires_at, hit_count). `withCache<T>(apiType, params,
ttl, fetcher) → {value, fromCache}` in `src/lib/mcp/external-cache.ts` — degrades to no-cache on any error.
TTLs: EDGAR facts 24h / submissions 6h / tickers 24h; Federal Register 1h; CALC 12h. RLS service-role-only.

**Gotchas:**
- **GSA CALC is keyless and rate-limits per IP.** `fetchPricingIntel(naics)` fans out 5 parallel CALC calls
  (3 terms + 2 biz-size splits) → bursts past the limit on repeat runs. The client swallows 429s to `null`
  → tool reports `grounded=false, degraded=false` (indistinguishable from a genuine empty result). The smoke
  treats pricing-intel `grounded=false` as NON-FATAL for this reason (verified passing in a prior run); the
  permanent fix is the `mcp_external_cache` table (warm calls skip the fan-out). If pricing-intel stays
  grounded=false after CALC recovers, THAT's a regression.
- **SEC EDGAR requires `User-Agent: <name> (<contact email>)`** on every request (10 req/s ceiling). The
  client sends `Mindy-MCP-GovConGiants (<MCP_CONTACT_EMAIL or hello@govcongiants.com>)`. Public filers
  only — a private contractor name → no CIK match → `grounded=false` (do NOT invent financials).
- **Migrations are hand-run by Eric** (no auto-apply): `20260712_mcp_external_cache.sql` +
  `20260712_mcp_data_sources_seed.sql` (idempotent `ON CONFLICT DO UPDATE`). Verify live after running.

**Adding a new tool:** pure fn in `src/mcp/tools/<name>.ts` + client in `src/lib/<source>/` → register in
BOTH `src/lib/mcp/tool-registry.ts` (def + `listMcpTools`/`isMcpTool`/`runMcpTool` + `TOOL_CREDITS`) AND
`src/mcp/server.ts` (zod inputSchema) → add a `callTool` block to `scripts/mcp-smoke.mjs` (assert grounded +
traceability) → add a `data_sources` seed row + an inventory row in
`src/app/api/admin/data-inventory/route.ts` (`kind: 'passthrough'`, `stored: null` for a live API;
`source_corpus` only if it PERSISTS rows; list the tool in `surface.tools` — the inventory test checks it
against `listMcpTools()`) + a row in `docs/DATA-SOURCES-REGISTRY.md`.

---

## Mindy MCP Server — Keyless OAuth 2.1 (2026-07-13)

Agents connect to the hosted MCP transport by **signing in through their browser** —
no API key to copy. This is the DEFAULT connect path on `getmindy.ai/mcp`; API keys
still work and are demoted to a collapsed "Advanced — headless / CI" section.

**Gated OFF by default.** Every OAuth route 404s unless `MCP_OAUTH_ENABLED` is truthy
(`mcpFlags.oauth`, `src/lib/mcp/flags.ts` → `oauthGate()` in `src/lib/mcp/oauth/guard.ts`).
The feature can sit on prod exposing nothing until the flag is flipped. It is currently
**ON in prod** (verified: metadata endpoints 200, live smoke green, real Claude Desktop
pulled a solicitation).

**Flow (OAuth 2.1, public client, PKCE S256):**
DCR (`/oauth/register`, RFC 7591) → authorize consent (`/oauth/authorize` page →
`/api/oauth/authorize/approve`) → token (`/oauth/token`, authorization_code + refresh
rotation) → the MCP client calls `getmindy.ai/mcp/mcp` with a Bearer JWT. Discovery via
RFC 8414 (`/.well-known/oauth-authorization-server`) + RFC 9728 (protected-resource),
served through `next.config.ts` rewrites (Next won't serve `.well-known` folders).
Revoke = RFC 7009 (`/oauth/revoke`).

**Identity source:** the consent page reads the signed MI 2FA session
(`mi_beta_auth_token`), so the approver's email is the token identity — the same
server-verified path that fixed the /mcp 0-credits wrong-account bug
(`/api/mcp/session`). First OAuth connect gets the 100-credit welcome grant via
`grantSignupCreditsIfFirst` (can't be farmed — gated on "no balance row yet").

**Tokens (`src/lib/mcp/oauth/tokens.ts`):** stateless HS256 access JWTs, `aud`-bound to
`OAUTH_RESOURCE=https://getmindy.ai/mcp/mcp` (1h TTL); opaque hashed refresh tokens
(60d, rotated + revocable); single-use auth codes (5m). Signing secret =
`MCP_OAUTH_SIGNING_SECRET` (falls back to `ADMIN_PASSWORD` — dedicated env var is a
TODO). Persistence in `src/lib/mcp/oauth/store.ts` (atomic single-use code consume +
refresh rotation).

**⚠️ The billing seam still holds.** The transport verifier
(`src/app/mcp/[transport]/route.ts` `withMcpAuth`) tries `verifyAccessToken` (OAuth JWT)
first, then `verifyApiKey` — either way the call dispatches through **`runMeteredTool`**,
never raw `runMcpTool`. Keyless calls debit credits exactly like keyed ones. The transport
loops `mcpRegistrationList()` (`src/lib/mcp/tool-schemas.ts`) so **all tools** are
exposed (a prior bug exposed only 1 — caught by the live smoke; now 42, each carrying
read-only annotations — see the usage-visibility section below).

**Key files:** `src/lib/mcp/oauth/{tokens,store,guard}.ts`, `src/app/oauth/{register,token,revoke}/route.ts`,
`src/app/api/oauth/metadata/{authorization-server,protected-resource}/route.ts`,
`src/app/api/oauth/authorize/approve/route.ts`, `src/app/oauth/authorize/page.tsx`,
`src/app/api/mcp/session/route.ts` (server-verified identity), `src/app/mcp/page.tsx`
(keyless 3-step UI). Migration: `supabase/migrations/20260713_mcp_oauth.sql`
(`mcp_oauth_clients` / `_codes` / `_tokens`, RLS service-role-only — hand-run + verified).
Smoke: `scripts/mcp-oauth-smoke.mjs` (DCR→authorize→token→keyless-call→refresh→negatives;
needs `MI_AUTH_TOKEN`).

**Parked:** PR #135 (GitHub OAuth for app sign-in — Apple already merged); add
`mcp.getmindy.ai` to the token `aud` allowlist once the subdomain is claimed; provision a
dedicated `MCP_OAUTH_SIGNING_SECRET`.

---

## Mindy MCP Server — `/chatgpt/mcp` profile (ChatGPT plugin Path A, 2026-10-02)

A SECOND MCP handler at `https://mcp.getmindy.ai/chatgpt/mcp` (`src/app/chatgpt/mcp/route.ts`),
beside — not replacing — the full edge. Plan + owner decisions + open items:
**`tasks/chatgpt-plugin-path-a.md`** (read it before touching either endpoint).

- **Allowlist lives in `src/lib/mcp/chatgpt-profile.ts`** (`CHATGPT_TOOL_ALLOWLIST`, exactly 15 — owner-final
  2026-10-03; every one must be in the PUBLIC catalog `listPublicMcpTools()`, or registration throws),
  with ChatGPT-only titles/descriptions/annotations, server instructions, the result projection
  (`_meta` ALLOWLIST, `_next` credits stripped, find_opportunities ranking internals dropped) and the
  neutral-refusal mapping (`chatgpt-refusals.ts`). Input schemas are reused from
  `mcpRegistrationList()` (= the public catalog since #1777) — never redefine them there; only
  parameter DESCRIPTION text may be overridden (`CHATGPT_PARAM_COPY`).
- **Billing seam still holds:** calls go through `runMeteredTool(..., { channel: 'chatgpt' })`, so an
  existing balance is pre-checked and debited exactly like Claude. The channel only suppresses
  commerce side effects (`recordPaywallAttempt`, paywall copy, continue_url); every row still writes
  #1777's `outcome` telemetry, refusals included. No footer, no
  `_meta.credits`, no `grantSignupCreditsIfFirst`, no in-request `maybeAutoRecharge`.
- **OAuth:** one authorization server, two resources (`src/lib/mcp/oauth/resources.ts`). The token
  endpoint mints `aud` = the ChatGPT resource only for a ChatGPT grant (no signup/referral credits);
  each handler accepts only its own audience. Metadata: `/.well-known/oauth-protected-resource/chatgpt/mcp`.
- **⚠️ The Claude/general endpoint must stay EXACTLY as main has it** (main's public catalog — 53 of
  64 on 2026-10-03, asserted against main's list, not a hardcoded count — copy, footer, paywall).
  Guarded by `src/app/mcp/[transport]/__tests__/route.claude-unchanged.unit.test.ts`. Never "clean up"
  commerce on the full endpoint as a side effect of ChatGPT work.
- **Auto-recharge:** never in-request on this route; the hourly `/api/cron/mcp-autorecharge`
  backstop excludes ChatGPT-attributed spend via #1778 (`rechargeGate` / `mcp_recharge_gate`, LIVE).
  Personal ChatGPT debits carry `p_channel='chatgpt'`; pooled ChatGPT debits go to the pool only.
  Proven route→RPC in `src/app/chatgpt/mcp/__tests__/route.billing-chain.unit.test.ts`.
  Not submitted to OpenAI.

---

## Mindy MCP Server — usage visibility + tool grouping (2026-07-15, PR #247)

Three additive UX fixes (from Eric's Higgsfield comparison) so users can see spend
against balance and Claude Desktop groups the toolset. All verified live via
`mcp-oauth-smoke.mjs` against prod (42 tools, a priced call debited 1223→1221).

- **Usage panel** on `getmindy.ai/mcp` (`src/app/mcp/page.tsx`) — signed-in visitors get a
  panel at the top: current balance + recent call history (tool · status · credits · when),
  Refresh + Top up. Wires up the pre-existing `GET /api/mcp/account` (balance + last 20
  `mcp_call_log` rows) that nothing rendered before. Front-end only.
- **Balance IN THE CHAT** (Higgsfield-style) — the hosted transport appends a footer text
  block to every PRICED tool result: `Mindy credits: N remaining · this call used X`,
  escalating to a top-up nudge at ≤`LOW_BALANCE_THRESHOLD` (20) and at 0. Free tools
  (`get_balance`) emit no footer. `runMeteredTool` already returns the post-debit
  `balance`, so **NO billing change** — also mirrored into `structuredContent._meta.credits`.
  Helpers `creditFooter` / `prettifyToolName` live in `src/app/mcp/[transport]/route.ts`.
- **Read-only tool ANNOTATIONS** — tools carried no MCP annotations, so Claude Desktop
  dumped all 42 into one flat "Other tools" bucket. Every Mindy tool is a read-only
  intel/compute lookup (none mutate the user's account or any external system), so
  `mcpRegistrationList()` (`src/lib/mcp/tool-schemas.ts`) now tags EVERY entry
  `{ readOnlyHint:true, idempotentHint:true, openWorldHint:true }` + a Title-Case `title`,
  passed into `server.registerTool`. Result: one clean "Read-only tools (42) — Always
  allow" bucket. **⚠️ Guard:** any future MUTATING tool MUST override with
  `readOnlyHint:false, destructiveHint:true` so it doesn't hide in the always-allow group.

The billing seam is untouched — the footer/annotations wrap the SAME `runMeteredTool`
dispatch; nothing bills for free.

---

## Mindy MCP Server — account area + usage charts (2026-07-16, PRs #251–253)

The `/mcp` surface split into a **connect landing** and a dedicated **account area**,
mirroring the OpenAI Platform / Anthropic Console layout (Eric's "make it a settings
page, not a home page").

- **`/mcp`** = Connect only (hero + keyless connect card + examples). Signed-in users get
  a **balance chip → Account** in the nav (`McpNav` gained `signedIn`/`balance` + an
  `account` active state). No usage/billing machinery here anymore.
- **`/mcp/account`** (`src/app/mcp/account/page.tsx`) = left-rail console:
  **Usage** (balance · 7-day credits graph · KPI tiles · spend-by-tool) · **Activity**
  (raw call log) · **Billing** (top-up · plan · auto-recharge full controls · payment
  method · **billing history**) · **API keys** (create/label/revoke — first UI
  for the existing `/api/mcp/keys`) · **Settings**. Deep-links: `?section=<id>`,
  `?autorecharge=saved`.
- **Charts** live in `src/app/mcp/usage-charts.tsx` (`UsageKpis`/`UsageOverTime`/
  `SpendByTool`/`ActivityLog` + shared `shortWhen`/`statusStyle`). Magnitude-by-category →
  ONE emerald hue, direct-labeled, no per-tool rainbow. Pure CSS/SVG bars (no chart lib).
  The day chart gives each bar its own track so value/day labels never overlap.
- **`/api/mcp/account`** returns a 30-day `usage` rollup `{ windowDays, totalCredits,
  totalCalls, byTool[], byDay[], capped }` (additive); `shadow_*` guard rows excluded.
- **Auto-recharge** Stripe return URLs repoint to `/mcp/account?autorecharge=...`.

**⚠️ Two client-auth gotchas on the `/mcp` APIs** (both bit this work — memory
`getmiapiheaders-returns-headers-object`): (1) `getMIApiHeaders()` returns a **Headers
object** — spreading it (`{...getMIApiHeaders()}`) drops the auth token → 401; mutate it
in place. (2) `account`/`autorecharge` use token-only `resolveMcpEmail`, but `keys` uses
`requireUserAuth` which needs the email in **`?email=`** (or JSON body), NOT the
`x-user-email` header.

**Phase 2 (SHIPPED, PR #255):** Billing history — `GET /api/mcp/billing-history`
(token-only) lists every credit ADDITION (`mcp_credit_ledger` delta > 0) newest-first
as dated receipts (reason → friendly label; a "free" badge only on signup/admin grants).
**Credit-denominated, NOT dollars** — neither `mcp_credit_ledger` nor `mcp_credit_topups`
stores a USD amount, and a credit count is ambiguous between a one-time pack and a
subscription month; per-event USD would need capturing the amount at grant time (a later
enhancement).

**Extraction guard (2026-07-16):** flipped ON in prod in **log-only/shadow** mode
(`MCP_EXTRACTION_GUARD=true`, `MCP_EXTRACTION_ENFORCE` unset). Verified live. Next:
read `shadow_*` rows → set caps to p99 → enforce. (Memory: `mcp-extraction-guard-logonly`.)

---

## MCP credit emails — receipts + welcome (2026-07-16)

Credits were granted SILENTLY (no email) on every purchase. Now every credit-add event
that involves a customer sends a transactional email. Reference model: Perplexity's
"Your API credits are ready" receipt.

- **`src/lib/mcp/credit-emails.ts`** — ONE reusable branded receipt (`sendCreditReceiptEmail`,
  kinds `topup` | `auto_recharge` | `subscription`) + a `sendCreditWelcomeEmail` for the free
  signup grant. Mindy navy→purple header, line-item block (date · plan · credits · amount paid ·
  reference · **new balance**), "Manage credits" → `getmindy.ai/mcp/account`. Clean RECEIPT style,
  NOT the plain-letter marketing format (receipts should look like receipts). `transactional:true`
  (bypasses the #58 marketing send cap); `renderCreditReceipt`/`renderCreditWelcome` exported for
  tests + previews.
- **Fires only on a REAL grant** (`applied===true` from `applyCreditOnce`) so Stripe re-deliveries
  / idempotent no-ops don't re-send. **Never blocks the grant** — every send is try/caught +
  swallowed (the ledger is the source of truth; the email is a courtesy).
- **Wired at all four events:** top-up (`stripe-topup.ts`), subscription invoice
  (`stripe-subscription.ts`), auto-recharge (BOTH the engine `autorecharge.ts` AND the webhook
  backstop in `stripe-webhook` — each gated on `applied`, so exactly one receipt fires per
  `pi.id`), and signup welcome (inside `grantSignupCreditsIfFirst`, covering both the oauth/token
  and api/mcp/keys call sites). Pro-monthly refill + admin grants deliberately DON'T email
  (recurring free / internal).
- Tests: `credit-emails.unit.test.ts` (render + params + swallows failure); topup/subscription
  tests mock `./credit-emails` to stay hermetic.

---

## Mindy MCP Server — proposal WRITING tools (2026-07-16)

The MCP surface can now **draft a proposal**, not just shred/scan/referee one — the
competitive wedge (SweetSpot/Govly/GovWin are closed UIs; we're the only GovCon layer an
agent can invoke, and now the only one that can *write*). Three tools wrap the EXISTING
in-app engine (nothing new was built on the drafting side — it was already vault+RAG-grounded):

| Tool | Credits | Wraps | Returns |
|------|---------|-------|---------|
| `draft_proposal` | 50 | `generateAllSections` (`src/lib/proposal/draft-all.ts`) | full multi-section vault-grounded draft + outline; heavy internal meta stripped |
| `draft_proposal_section` | 12 | `generateV2Draft` (`src/lib/proposal/v2.ts`) | one section (`DraftResult`) |
| `export_proposal` | 2 | self-contained `docx` build (NOT the auth-tied export route) | base64 `.docx` (`Packer.toBuffer`) |

- Files: `src/mcp/tools/draft-proposal.ts` (both draft fns) + `src/mcp/tools/export-proposal.ts`.
  Registered the two-path way (`tool-registry.ts` def+`TOOL_CREDITS`+`isMcpTool`+`runMcpTool`
  dispatch AND `server.ts` zod) + smoke blocks in `scripts/mcp-smoke.mjs`. Billing is automatic
  (the transport's `runMeteredTool` seam is untouched). `_ai_hint` OFF by default; honest-miss →
  `grounded=false` + "do NOT fabricate".
- **`proposal_chat` was deliberately NOT exposed on MCP** — an agent already has its own LLM to
  "chat"; what it can't do is the vault+RAG draft. Kept app-only.
- **Refactor:** `draft-all.ts` `generateOutline` now calls `callLLM({ job:'drafting' })` (was raw
  Groq fetch) → the outline survives a Groq quota exhaustion (the old 70B→8B fallback died together)
  + the $15/user cost cap applies. Verified end-to-end: 752-word Technical Approach + a 12KB PK-header
  `.docx` generated locally.

### Locked pricing model (2026-07-16) — ✅ WIRED, not blocked
**`packages.ts` is the source of truth — read it, not this table.** (This section previously said
"blocked on Stripe products" long after the products existed; that staleness cost a whole
round-trip on 2026-07-16. If you're about to state a pricing fact, grep the code first.)

- **Base tiers:** Free $0 (100 cr one-time = ~1 proposal, then wall — the Higgsfield "one video"
  model) · **Starter $59/mo** (`SUBSCRIPTION_PLANS`, id stays `'scale'` so the Stripe
  `plan=scale` metadata resolves; **2,400 cr/mo**, `MCP_SCALE_MONTHLY_CREDITS`; annual $590
  ≈ $49/mo) · **Pro $149/mo** · **Team $499/mo** · Founders $4,997 lifetime.
  - ⚠️ Pro/Team are **app** tiers — their MCP allowance is `PRO_MONTHLY_CREDITS` /
    `TEAM_MONTHLY_CREDITS`; they are NOT sold through `SUBSCRIPTION_PLANS`.
    **⚠️ This number has now gone stale TWICE in this doc** — it said 6,000/mo (corrected
    2026-09-08 to 250), and 250 was itself stale by 2026-09-14. Verified two ways on
    2026-09-14: `packages.ts` defaults to **Pro 1,500 / Team 1,000**, and live
    `GET getmindy.ai/api/mcp/catalog` returns `tierCredits.pro.credits = 1500`,
    `.teams.credits = 1000`. **Read `packages.ts` or the live catalog; never this doc**
    for an allowance number — that instruction is the only durable part of this bullet.
    (Hardcoded Pro fallbacks drifted the same way twice: `mcp/tools/page.tsx` → 0 on
    2026-09-08, `mcp/page.tsx` `?? 1000` → 0 on 2026-09-14.)
  - The **$19 'Plus' subscription was RETIRED** (0 subs ever → nothing to grandfather).
- **One-time top-ups** (`CREDIT_PACKAGES`): Plus 2,000 cr / $49 · Scale 5,000 cr / $99.
- **Flagship credit sink:** a full proposal run ≈ ~100 cr (`draft_proposal`=50 + matrix/SOW/
  structure/scan/referee/docs). Reprices SHIPPED: referee 4→12, compliance-matrix 3→8, SOW 2→4,
  recompete-sow 2→4, sol-docs 3→5, structure/scan 1→2.
- **Add-ons (still unbuilt):** Coaching (group in Team, 1:1 à-la-carte) · Coach/Agency $99/mo up
  to 5 clients (per-client spend tracking for rebilling).
- `MCP_PRO_MONTHLY_CREDITS` / `MCP_TEAM_MONTHLY_CREDITS` are **not set in any Vercel
  environment** (re-verified 2026-09-08 by `vercel env ls` across all 102 vars AND
  behaviourally against the live catalog) → the `packages.ts` defaults apply. If either is
  ever set, **the env wins** — update it too or the tier silently under-grants.
- Rationale: "not consumer-priced" comes from tier SIZE + the flagship sink, not per-credit
  gouging (per-credit stays ~$0.025, market rate).

---

## One-Shot Composite Tools — ALL 3 SHIPPED (2026-07-16)

Scope: `tasks/one-shot-tools-plan.md`. Collapse a hand-chained workflow into ONE agent call.

| # | Tool | PR | Notes |
|---|---|---|---|
| 1 | `generate_market_report` | #283, #289, #293 | + hosted shareable link + basis/reconciliation |
| 2 | `add_contacts_to_crm` | #285, #286 | BYO GoHighLevel token; Connect card on `/mcp/account` |
| 3 | `include_ics` on `search_federal_events` | #287 | opt-in base64 VCALENDAR |

- **Sue's deliverable:** `deliverable.url` → `/reports/<id>` (`src/app/reports/[id]/route.ts`, a
  route handler because `renderMarketReportHtml` emits a full `<!doctype html>`). Stores the
  **payload**, not the HTML, so renderer fixes reach already-shared links. The 22-char random id
  **IS** the access control — the page is deliberately PUBLIC so a client opens it without a Mindy
  login (capability URL); malformed and missing ids return an IDENTICAL 404 so it can't be probed.
  Owner = the verified caller (`ctx.userEmail`), never args. Table: `market_reports`.
  Saving is best-effort — storage down → `url:null`, `_meta.saved:false`, caller still gets the
  full JSON (they paid 20 credits).
- **PDF = the page's Save-as-PDF button**, NOT a base64 binary: server-side HTML→PDF needs Chromium
  and `puppeteer` is a **devDependency**, so it'd mean `@sparticuz/chromium` (~50MB) or a render
  service. Deferred.
- **Calendar:** shipped as a flag on the existing tool, not a separate `export_events_ics` — the
  events are already in hand. `src/lib/events/ics.ts` is RFC 5545 (CRLF, **75-OCTET** folding,
  all-day `DTSTART;VALUE=DATE` + exclusive `DTEND`, stable UIDs so re-import updates).
  **Undated events are SKIPPED and counted** (`_meta.ics_skipped_undated`), never guessed onto a
  day — which is also why `get_federal_event_series` gets NO .ics (it holds cadence/typical_month,
  not confirmed instances; VEVENTs from those would put wrong dates on a real calendar).
- **GHL provision path DROPPED** (Eric, 2026-07-16): *"have the user put his information in
  directly."* BYO token only — also sidesteps GHL's per-sub-account billing.

---
