# Mindy ChatGPT Plugin: Path A (ChatGPT-specific MCP profile)

Status: **Phase 1 built + ChatGPT-only param descriptions + owner-FINAL 15 (2026-10-03), rebased onto
main `9c24b306` (#1777 + #1778). Draft PR #1776, not merged, not deployed. Not submitted to OpenAI.**

Prerequisites, all satisfied 2026-10-03:
- **Auto-recharge attribution (#1778)** — LIVE, merged `9c24b306`; migration applied 2026-10-03 via
  `--only`; prod-accepted. ChatGPT personal debits carry `p_channel='chatgpt'`; the cron and engine
  refuse a ChatGPT-caused threshold crossing. Route→RPC proof on this branch:
  `src/app/chatgpt/mcp/__tests__/route.billing-chain.unit.test.ts`.
- **Phase 0 tool correctness** — #1772 lookup_solicitation (`a31693cb`), #1773 FY rollover
  (`e8c61d33`), #1774 FIND copy (`64d5b154`), #1775 recompete dedupe (`b6d69d89`): all LIVE,
  prod-accepted 2026-10-03.
Owner: Eric. Started 2026-10-02.

Path A = expose a curated, commerce-free subset of the existing Mindy MCP server to
ChatGPT at `https://mcp.getmindy.ai/chatgpt/mcp`. Same origin as the Claude MCP (a
plugin's origin cannot change after submission), same OAuth authorization server, a
different resource/audience and a different handler. No ChatGPT-specific UI.

## Owner decisions (frozen 2026-10-02; do not reinterpret)

1. **Commerce cleanup is `/chatgpt/mcp`-ONLY.** The Claude/general endpoint
   (`mcp.getmindy.ai/mcp`, `getmindy.ai/mcp/mcp`) behaves exactly as main has it: main's PUBLIC
   catalog (#1777 — 53 of the 64 registered tools on 2026-10-03; the test asserts main's own list,
   not a count), same copy, same credit footer, same paywall. Guarded by
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
5. **Exactly 15 tools — owner-confirmed FINAL (2026-10-03, ceiling unchanged):**
   find_opportunities, lookup_solicitation, get_solicitation_documents,
   get_solicitation_incumbent, get_expiring_contracts, search_past_contracts, search_grants,
   find_capable_contractors, get_contractor_profile, lookup_sam_entity, assess_market_depth,
   get_agency_intel, get_legislation_status, capability_market_match, get_keyword_coverage.
   REMOVED from the Phase-1 list: search_contractors (replaced by find_capable_contractors),
   search_federal_events, get_award_detail. get_legislation_status stays deliberately (owned,
   provenance-aware corpus). Any other name on `/chatgpt/mcp` is unknown: never dispatched,
   never billed. Every allowlisted tool must be in the PUBLIC catalog (`listPublicMcpTools()`,
   #1777); `chatgptRegistrationList()` throws otherwise.

## Phase 2 owner decisions on the open items (2026-10-02/03)

Numbered as Eric answered them; they map onto the "Open items" list below.

1. **Auto-recharge out-of-band path (open item 1) — DONE via attribution (#1778, LIVE).** Every
   ChatGPT personal debit records its channel and grows `chatgpt_spend_since_recharge`; an
   automatic payment is allowed only if the account would still qualify with that spend removed
   (`mcp_recharge_gate` / `rechargeGate`). Pooled ChatGPT calls debit the pool only.
2. **ChatGPT-only parameter descriptions (open item 2) — GO (2026-10-02).** Implemented:
   `CHATGPT_PARAM_COPY` in `src/lib/mcp/chatgpt-profile.ts`, applied by
   `chatgptInputSchema()` when building the ChatGPT registration. Only description TEXT
   changes; type / required / enum / bounds are the registry's zod types, cloned. An override
   naming a parameter the registry lacks throws (drift guard). Claude/general endpoint input
   schemas proven byte-identical (tools/list SHA before = after, plus a per-param registry
   equality test in `route.claude-unchanged.unit.test.ts`). 17 overrides across 8 tools (15 across 8 after the final-15 swap, 2026-10-03); see
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
| find_opportunities.uei | "FIND is company-anchored", "company_registered_psc / company_registered_naics", "ELIGIBLE \| NOT_ELIGIBLE (+reason) \| UNKNOWN", "never ask for it before first value" | internal labels, enum constants, journey jargon |
| find_opportunities.states | "reported in query_summary.region.unresolved" | internal field path |
| find_opportunities.stage | "MARKET_RESEARCH … VEHICLE_SOLICITATIONS … NON_FAR", "a labelled secondary signal" | enum constants in prose (the enum itself is unchanged) |
| find_opportunities.agency | "Optional buying agency" | commerce-adjacent wording (buy) |
| find_opportunities.advanced | "power-user codes … for customers" | internal jargon |
| find_opportunities.location | "Semantics differ by horizon (documented in result)" | jargon |
| find_opportunities.limit_per_horizon | "Not a cross-horizon merge." | jargon |
| lookup_solicitation.confirm_notice_id | "a MATCHED_CANDIDATE", "upgrade to current truth" | result-enum label, jargon, "upgrade" |
| search_grants.agency | "(client-side prefix filter)" | implementation detail |
| capability_market_match.client_name | "label for the deliverable header" | internal jargon |
| get_solicitation_documents.notice_id | "Get it from search_sam_opportunities results." | names a tool not on this surface |
| find_capable_contractors.limit | "cached BigQuery rollup, so returning more has no per-call cost" | cost + internal storage |
| assess_market_depth.set_aside | "Normalized label: …" | internal jargon (values unchanged) |
| assess_market_depth.limit | "Max businesses to return in the list." | inaccurate: it also sizes the evaluation sample (default 200), and the list is capped at 15 |

Final-15 re-inventory (2026-10-03): the three new tools emit 15 parameter descriptions; the four
above were overridden, the rest kept (`text_limit` / `text_offset` / `documents` / `document_ids`
carry the paging contract the model needs and name only the result's own `next_page`). Rows for
the three dropped tools were removed. Total on the wire: 69 parameter descriptions. A test now
fails if ANY ChatGPT-facing string (title, description, parameter description, server
instructions, serverInfo) names a registered tool outside the 15.

Remaining enum VALUES quoted in a description (e.g. `search_past_contracts.state_scope` "pop") are kept: they are the literal
values the model must pass. Test `route.unit.test.ts` bans commerce terms and the labels above
on every ChatGPT parameter description, so a future registry edit that adds one fails CI.

## Final 15 (2026-10-03): annotations and overlaps

| Tool | Title | openWorldHint | Why |
|---|---|---|---|
| find_opportunities | Find Opportunities | true | live SAM.gov Entity API when a UEI is given |
| lookup_solicitation | Look Up a Solicitation | false | stored SAM notices only |
| get_solicitation_documents | Solicitation Documents | true | cold notice: live SAM noticedesc + attachment download (fills Mindy's notice/storage/doc caches with public data — platform side effect) |
| get_solicitation_incumbent | Solicitation Incumbent | true | live SAM + USASpending |
| get_expiring_contracts | Expiring Contracts | true | live USASpending for task-order parent end dates |
| search_past_contracts | Search Past Contracts | true | live USASpending |
| search_grants | Search Grants | true | live Grants.gov |
| find_capable_contractors | Find Capable Contractors | false | Mindy's BigQuery award warehouse only |
| get_contractor_profile | Contractor Profile | false | BigQuery only |
| lookup_sam_entity | SAM.gov Registration | true | live SAM Entity API |
| assess_market_depth | Small-Business Market Depth (Rule of Two) | false | stored `sam_entities` + BigQuery only |
| get_agency_intel | Agency Intel | true | live USASpending spending |
| get_legislation_status | Legislation Status (NDAA) | false | stored Congress record |
| capability_market_match | Capability Market Match | true | third-party embeddings + live USASpending |
| get_keyword_coverage | Keyword Market Coverage | false | BigQuery only |

Overlap routing written into the descriptions (tested):
- **lookup_solicitation** identifies one notice → **get_solicitation_documents** reads it →
  **get_solicitation_incumbent** says who holds its contract.
- **find_capable_contractors** = "who could compete / who could I team with" for a NAICS (+PSC,
  state); leans toward smaller firms (more than 25 million dollars of matching awards are left out
  — `maxObligated` default in `findCapableSmallBusinesses`). **get_contractor_profile** = one named
  company. **assess_market_depth** = the Rule-of-Two determination (capable small-business count,
  met / not met / undetermined, sample coverage). **capability_market_match** starts from a company
  description, not a code.

Projection for the new tools (`_meta` allowlist additions):
- get_solicitation_documents: `doc_count`, `signed_url_ttl_seconds`, `returned_chars`, `total_chars`,
  `coverage_complete`, `attachments_listed`, `attachments_with_text`, `piee`, `piee_links`,
  `retrieval_limitation`. `_meta.source` (cache / on_demand / none = Mindy's retrieval path) is
  dropped for this tool. `next_page`, `coverage`, `documents[]` pass through untouched (the paging
  contract). Captured fixture: notice 458091d7… (2 docs, SOW 44,468 chars → `next_page` non-null),
  read with `SAM_DOCS_READONLY=on` on a warm notice (no writes).
- assess_market_depth: `market_depth`, `capable_depth`, `rule_of_two_met`, `businesses_returned`,
  `businesses_available` (all grounding/coverage; it emits no telemetry). Shape fixture built from
  `src/mcp/tools/market-depth.ts` — a live call writes the KV result cache, so it was not run.
- find_capable_contractors: emits no `_meta`; the projection derives `grounded` (ok + count > 0),
  `degraded` (ok=false, i.e. warehouse lookup throttled) and `validation_error`
  (`naics_or_psc_required`) from its own fields. Captured fixture: cache-only BigQuery read for
  541512 (`liveBq:false`, no writes).
- Removed with their tools: the search_federal_events keys (`sam_count`, `ai_count`, `ai_discovery`,
  `ics_events`, `ics_skipped_undated`).
- `host_rules` / `_next` filtering now checks against the FULL registry (64), so a rule that steers
  to a tool hidden from the public catalog is filtered too.

### get_solicitation_documents: notice-description behaviour (read-only check, 2026-10-03)

The Sept 20 failure mode (SAM noticedesc 429s left the body empty) is now handled in code:
`fetchNoticeDescriptionWithFailover` tries every distinct SAM key before giving up, and an empty
body sets `_meta.degraded = true` plus a `retrieval_limitation` explaining that a missing body does
not mean the notice has no scope (never a silent empty). But the backlog it falls back on is large:
read-only counts on prod — **12,530 of 31,262 active notices (40%) have `description IS NULL`**
(7,458 of those posted in the last 14 days) and **none of them has `description_checked_at` set**,
while both `backfill-descriptions` crons report `success` (latest stamp 2026-10-03 04:05 UTC). So a
ChatGPT read of a recent notice will often fall to the live, on-demand noticedesc fetch (quota-
bound), and on a 429 day it returns degraded with the limitation. Worth a look outside this PR:
why the backfill is not draining the active NULL rows.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Correctness of the tools themselves (lookup_solicitation scoring, find_opportunities copy, recompete dedupe) | **LIVE** (#1772–#1775, prod-accepted 2026-10-03) |
| 1 | This profile: routing, OAuth audience binding, 15-tool allowlist, descriptions, annotations, instructions, projection, neutral refusals, tests | **built (this PR)** |
| 2 | OAuth / public readiness: real ChatGPT developer-mode connect, consent page review, DCR behaviour with OpenAI's client, auto-recharge decision, param-description cleanup | param descriptions **done**; auto-recharge attribution **LIVE (#1778)**; rest not started |
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

1. **[RESOLVED 2026-10-03 — #1778 LIVE]** Auto-recharge out-of-band path. The hourly backstop
   `GET /api/cron/mcp-autorecharge` used to be balance-based and channel-blind. #1778 added
   channel attribution (option c): ChatGPT personal debits pass `p_channel='chatgpt'`, and the
   cron pre-filter, the engine and `mcp_autorecharge_claim` all apply the same gate
   (`balance < T AND balance + S < T`). This route still never calls `maybeAutoRecharge`.
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
- (Phase 1, pre-#1777) ChatGPT token: initialize → serverInfo websiteUrl `https://getmindy.ai`; tools/list → 15;
  tools/call `draft_proposal` → "Tool draft_proposal not found" (never dispatched).
- Claude token on `/chatgpt/mcp` → 401; ChatGPT token on `/mcp/mcp` → 401; Claude token on `/mcp` → 64 tools.
- No tools/call was run through the server locally: `.env.local` points at production Supabase, and
  `runMeteredTool` writes a call-log row and a debit. The projected sample came from a direct,
  read-only `get_legislation_status` call passed through `projectChatgptResult`.

## Post-deploy proof plan (after merge + deploy, by Eric's go-ahead)

1. `curl -si -X POST https://mcp.getmindy.ai/chatgpt/mcp` → 401 + the ChatGPT `resource_metadata`.
2. `curl -s https://mcp.getmindy.ai/.well-known/oauth-protected-resource/chatgpt/mcp` → ChatGPT resource;
   `.../oauth-protected-resource/mcp` → unchanged.
3. Claude connector smoke (`scripts/mcp-oauth-smoke.mjs`) still green: main's public catalog, footer present.
4. ChatGPT developer mode → add connector `https://mcp.getmindy.ai/chatgpt/mcp` with a test account
   that already has credits → tools/list shows 15 → one cheap call → confirm the debit and that no
   signup grant row appeared.
