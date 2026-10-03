# Mindy ChatGPT Plugin: Path A (ChatGPT-specific MCP profile)

Status: **Phase 1 built + ChatGPT-only param descriptions (draft PR #1776, not merged, not deployed). Not submitted to OpenAI.**

> ⛔ **#1776 must NOT merge until Phase 0 production acceptance passes** (the tools' own
> correctness on prod: lookup_solicitation scoring, find_opportunities copy, recompete dedupe).
Owner: Eric. Started 2026-10-02.

Path A = expose a curated, commerce-free subset of the existing Mindy MCP server to
ChatGPT at `https://mcp.getmindy.ai/chatgpt/mcp`. Same origin as the Claude MCP (a
plugin's origin cannot change after submission), same OAuth authorization server, a
different resource/audience and a different handler. No ChatGPT-specific UI.

## Owner decisions (frozen 2026-10-02; do not reinterpret)

1. **Commerce cleanup is `/chatgpt/mcp`-ONLY.** The Claude/general endpoint
   (`mcp.getmindy.ai/mcp`, `getmindy.ai/mcp/mcp`) behaves exactly as before: same 64
   tools, same copy, same credit footer, same paywall. Guarded by
   `src/app/mcp/[transport]/__tests__/route.claude-unchanged.unit.test.ts`.
2. **No commerce on `/chatgpt/mcp`:** no prices, purchase/top-up links, upgrade pitches,
   checkout, `continue_url`, saved purchase retries (`recordPaywallAttempt` does not run
   for `channel: 'chatgpt'`), credit footer, or `_meta.credits`.
3. **No new-user free-credit acquisition via ChatGPT.** `/chatgpt/mcp` never calls
   `grantSignupCreditsIfFirst`; the token endpoint grants neither signup nor referral
   credits for the ChatGPT audience; the consent page hides the free-credit promise for a
   ChatGPT connect (it would be false).
4. **A ChatGPT call may decrement an existing balance** (via `runMeteredTool`, billing
   seam intact) **but never triggers auto-recharge in-request.** The out-of-band cron is
   an open item (below).
5. **Exactly 15 tools:** find_opportunities, lookup_solicitation,
   get_solicitation_incumbent, get_award_detail, get_expiring_contracts,
   search_past_contracts, search_grants, search_contractors, get_contractor_profile,
   lookup_sam_entity, get_agency_intel, search_federal_events, get_legislation_status,
   capability_market_match, get_keyword_coverage. Any other name on `/chatgpt/mcp` is
   unknown: never dispatched, never billed.

## Phase 2 owner decisions on the open items (2026-10-02/03)

Numbered as Eric answered them; they map onto the "Open items" list below.

1. **Auto-recharge out-of-band path (open item 1) — MODIFY.** Attribution design (record the
   spending channel so the hourly cron can tell a ChatGPT-caused threshold crossing apart)
   is **pending owner review**. **Fallback if that design is not approved:** refuse the
   ChatGPT call that would take an opted-in (auto-recharge enabled) user's balance across
   their auto-recharge threshold. Not implemented yet.
2. **ChatGPT-only parameter descriptions (open item 2) — GO (2026-10-02).** Implemented:
   `CHATGPT_PARAM_COPY` in `src/lib/mcp/chatgpt-profile.ts`, applied by
   `chatgptInputSchema()` when building the ChatGPT registration. Only description TEXT
   changes; type / required / enum / bounds are the registry's zod types, cloned. An override
   naming a parameter the registry lacks throws (drift guard). Claude/general endpoint input
   schemas proven byte-identical (tools/list SHA before = after, plus a per-param registry
   equality test in `route.claude-unchanged.unit.test.ts`). 17 overrides across 8 tools; see
   "Parameter description inventory" below.
3. **Follow-up offers filtered to the allowlist (open item 6) — GO (2026-10-03).** Already
   implemented in Phase 1 (`projectNext` + host_rules filter); tests in
   `chatgpt-profile.unit.test.ts` (find_opportunities projection). Unchanged.
4. **OAuth-only on `/chatgpt/mcp` (open item 4) — GO (2026-10-03).** Already implemented in
   Phase 1; test "rejects an mcp_live_ API key (OAuth-only surface)" in
   `src/app/chatgpt/mcp/__tests__/route.unit.test.ts`. Unchanged.

### Parameter description inventory (2026-10-02)

Every description emitted in the 15 tools' input schemas on `/chatgpt/mcp` was walked at
every depth (properties, array items, records, unions): **65 descriptions, all top-level**
(the registry→zod bridge emits no nested descriptions: array items carry a type only, objects
become typed records). Offending strings, now overridden on ChatGPT only:

| Tool.param | Offending text | Why |
|---|---|---|
| get_expiring_contracts.limit | "Local table — a larger set has no per-call cost." | cost + internal storage |
| search_contractors.limit | "Cached index — a larger set has no per-call cost." | cost + internal storage |
| search_federal_events.limit | "Local table — a larger set has no per-call cost." | cost + internal storage |
| search_contractors.keyword | "Free-text company-name match" | "free" (commerce word) |
| find_opportunities.uei | "FIND is company-anchored", "company_registered_psc / company_registered_naics", "ELIGIBLE \| NOT_ELIGIBLE (+reason) \| UNKNOWN", "never ask for it before first value" | internal labels, enum constants, journey jargon |
| find_opportunities.states | "reported in query_summary.region.unresolved" | internal field path |
| find_opportunities.stage | "MARKET_RESEARCH … VEHICLE_SOLICITATIONS … NON_FAR", "a labelled secondary signal" | enum constants in prose (the enum itself is unchanged) |
| find_opportunities.agency | "Optional buying agency" | commerce-adjacent wording (buy) |
| find_opportunities.advanced | "power-user codes … for customers" | internal jargon |
| find_opportunities.location | "Semantics differ by horizon (documented in result)" | jargon |
| find_opportunities.limit_per_horizon | "Not a cross-horizon merge." | jargon |
| lookup_solicitation.confirm_notice_id | "a MATCHED_CANDIDATE", "upgrade to current truth" | result-enum label, jargon, "upgrade" |
| get_award_detail.id | "USASpending generated_internal_id … (skips the resolve)" | internal field name |
| search_grants.agency | "(client-side prefix filter)" | implementation detail |
| search_federal_events.agency | "Messy raw names resolve via normalization." | implementation jargon |
| search_federal_events.include_ics | "`ics` … VCALENDAR … _meta.ics_skipped_undated" | internal key names |
| capability_market_match.client_name | "label for the deliverable header" | internal jargon |

Remaining enum VALUES quoted in a description (e.g. `search_contractors.sort_by` "default
total_obligated", `search_past_contracts.state_scope` "pop") are kept: they are the literal
values the model must pass. Test `route.unit.test.ts` bans commerce terms and the labels above
on every ChatGPT parameter description, so a future registry edit that adds one fails CI.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Correctness of the tools themselves (lookup_solicitation scoring, find_opportunities copy, recompete dedupe) | other branches, in flight |
| 1 | This profile: routing, OAuth audience binding, 15-tool allowlist, descriptions, annotations, instructions, projection, neutral refusals, tests | **built (this PR)** |
| 2 | OAuth / public readiness: real ChatGPT developer-mode connect, consent page review, DCR behaviour with OpenAI's client, auto-recharge decision, param-description cleanup | param descriptions **done**; auto-recharge attribution **pending owner review**; rest not started |
| 3 | Reviewer account + submission package (annotations.json, test prompts, screenshots of ChatGPT itself, privacy/terms review) | not started |

## Hard stops

- No React UI / iframe widgets / Map / screenshots-in-tool / write tools / proposal
  drafting / CRM on the ChatGPT surface.
- **No submission until OpenAI answers the existing-credit question** (can a plugin
  spend a balance the user bought outside ChatGPT?) **or Eric explicitly accepts the risk.**

## Where things live

| What | File |
|---|---|
| Allowlist, copy, annotations, instructions, projection, refusal mapping | `src/lib/mcp/chatgpt-profile.ts` |
| Neutral refusal copy | `src/lib/mcp/chatgpt-refusals.ts` |
| Handler | `src/app/chatgpt/mcp/route.ts` |
| Resources / audiences (RFC 8707/9728) | `src/lib/mcp/oauth/resources.ts` |
| ChatGPT protected-resource metadata | `src/app/api/oauth/metadata/protected-resource/chatgpt/route.ts` (+ rewrite in `next.config.ts`) |
| Token audience + no-grant | `src/app/oauth/token/route.ts` |
| Billing channel (no paywall capture) | `src/lib/mcp/metered.ts` (`MeteredContext.channel`) |
| Annotation justifications (submission) | `docs/chatgpt-plugin/annotations.json` |

## Open items found during Phase 1 (for Phase 2+)

1. **Auto-recharge out-of-band path (needs an Eric decision before submission).**
   In-request auto-recharge is skipped on `/chatgpt/mcp`. But the hourly backstop
   `GET /api/cron/mcp-autorecharge` (`src/app/api/cron/mcp-autorecharge/route.ts:36-46`)
   calls `listRechargeCandidates()` (`src/lib/mcp/autorecharge.ts:361`), which selects every
   user with auto-recharge enabled + a saved card whose PERSONAL balance is below their
   threshold, and charges them via `maybeAutoRecharge()` (`autorecharge.ts:292`, off-session
   Stripe PaymentIntent). It is balance-based and channel-blind: if a ChatGPT call takes an
   opted-in user below threshold, the next cron tick charges their card. The ledger does not
   record the call's channel, so the cron cannot tell. Options:
   - (a) Accept: auto-recharge is a standing, user-configured mandate on the balance
     regardless of which client spent it (Claude, API key, ChatGPT). Disclose it.
   - (b) Refuse ChatGPT calls for users with auto-recharge enabled whose post-debit balance
     would fall below threshold (channel-scoped pre-check; changes ChatGPT UX).
   - (c) Record channel on the debit (ledger/call log) and have the cron skip users whose
     most recent below-threshold crossing came from a ChatGPT debit (billing-schema change).
   - (d) Disable auto-recharge entirely for accounts that have ever connected ChatGPT.
   Not implemented in Phase 1 (none is a trivial channel-scoped guard).
2. **[RESOLVED 2026-10-02 — decision 2 GO, see above]** Param descriptions were the registry's, verbatim (owner rule: schemas identical). A few
   mention cost ("a larger set has no per-call cost": get_expiring_contracts.limit,
   search_contractors.limit, search_federal_events.limit) or internal labels
   (find_opportunities.uei). Phase 2: decide whether to allow ChatGPT-only param-description
   overrides (types/required unchanged).
3. **Consent page** (`/oauth/authorize`): ChatGPT connects now get ChatGPT-specific consent
   copy and no free-credit promise. The sign-in step still links to the Mindy app's own
   signup; review that flow end to end with a real ChatGPT connect.
4. **API keys are not accepted on `/chatgpt/mcp`** (OAuth ChatGPT-audience tokens only).
5. Tool results can still contain Mindy-internal prose inside data fields the projection
   keeps (e.g. notes). Re-audit with real ChatGPT transcripts in Phase 2.
6. **`_next` offers for tools not on this surface are dropped, not just de-priced.** find_opportunities
   offers understand_customer / get_current_acquisition_intelligence / schedule_market_search,
   none of which exist on `/chatgpt/mcp`; keeping the prompt would have ChatGPT offer an action it
   cannot take. Credits are stripped from any `_next` entry that survives. Likewise
   `presentation.host_rules` lines that steer to an absent tool or `_next` are filtered (14 of 16
   kept on a real cyber/FL result). `_meta.watch_coverage` is kept (owner list) although watches
   are not offered on ChatGPT; revisit in Phase 2.
7. **lookup_solicitation items carry `provenance: 'sam_opportunities'`** (an internal table name) in
   result data. Kept in Phase 1 (projection only trims documented internals); consider mapping to a
   public label in Phase 2.

## Phase 1 proof (2026-10-02, local only, nothing deployed)

- Local `next start` on the production build with a LOCAL-ONLY signing secret: unauthenticated
  POST `/chatgpt/mcp` → 401 with `resource_metadata="https://mcp.getmindy.ai/.well-known/oauth-protected-resource/chatgpt/mcp"`;
  that document returns `resource: https://mcp.getmindy.ai/chatgpt/mcp`; the default document is unchanged.
- ChatGPT token: initialize → serverInfo websiteUrl `https://getmindy.ai`; tools/list → 15;
  tools/call `draft_proposal` → "Tool draft_proposal not found" (never dispatched).
- Claude token on `/chatgpt/mcp` → 401; ChatGPT token on `/mcp/mcp` → 401; Claude token on `/mcp` → 64 tools.
- No tools/call was run through the server locally: `.env.local` points at production Supabase, and
  `runMeteredTool` writes a call-log row and a debit. The projected sample came from a direct,
  read-only `get_legislation_status` call passed through `projectChatgptResult`.

## Post-deploy proof plan (after merge + deploy, by Eric's go-ahead)

1. `curl -si -X POST https://mcp.getmindy.ai/chatgpt/mcp` → 401 + the ChatGPT `resource_metadata`.
2. `curl -s https://mcp.getmindy.ai/.well-known/oauth-protected-resource/chatgpt/mcp` → ChatGPT resource;
   `.../oauth-protected-resource/mcp` → unchanged.
3. Claude connector smoke (`scripts/mcp-oauth-smoke.mjs`) still green: 64 tools, footer present.
4. ChatGPT developer mode → add connector `https://mcp.getmindy.ai/chatgpt/mcp` with a test account
   that already has credits → tools/list shows 15 → one cheap call → confirm the debit and that no
   signup grant row appeared.
