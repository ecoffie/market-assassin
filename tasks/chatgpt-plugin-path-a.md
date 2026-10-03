# Mindy ChatGPT Plugin: Path A (ChatGPT-specific MCP profile)

Status: **Phase 1 built (PR open, not merged, not deployed). Not submitted to OpenAI.**
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

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Correctness of the tools themselves (lookup_solicitation scoring, find_opportunities copy, recompete dedupe) | other branches, in flight |
| 1 | This profile: routing, OAuth audience binding, 15-tool allowlist, descriptions, annotations, instructions, projection, neutral refusals, tests | **built (this PR)** |
| 2 | OAuth / public readiness: real ChatGPT developer-mode connect, consent page review, DCR behaviour with OpenAI's client, auto-recharge decision, param-description cleanup | not started |
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
2. **Param descriptions are the registry's, verbatim** (owner rule: schemas identical). A few
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
