# Claude Connectors Directory — submission readiness (2026-07-17)

## TL;DR

**Not ready.** Four blockers. The engineering is done — OAuth, transport, canonical URL — but **a reviewer would fail us for reasons that have nothing to do with the server working.**

The plan we started from was wrong on three points (verified against the live docs 2026-07-17, see [Corrections](#corrections-to-the-original-plan)). The real blockers are a **credit ceiling**, an **incomplete privacy policy**, and **annotations that aren't live**. One of them — a CRM write declared read-only — is a live safety bug, not a paperwork gap.

---

## Blockers

### 1. 🔴 A reviewer runs out of credits halfway through

Every tool is credit-gated. `route.ts` rejects at `balance <= 0`.

| | credits |
|---|---|
| Run every tool once (48 priced tools) | **201** |
| A fresh signup account gets (`signup_grant`) | **100** |
| A Pro account gets (`pro_monthly`) | **1000** |

Verified against the live ledger: `signup_grant` has **4 entries ever, max +100**; the 709 accounts sitting at exactly 1000 are all `pro_monthly` grants. `MCP_SIGNUP_CREDITS` is **not set in Vercel**, so the code default of 100 is what a new account actually receives.

The priciest tools eat the grant immediately: `draft_proposal` **50**, `find_capable_contractors` **25**, `generate_market_report` **20**, `referee_proposal_compliance` **12**, `draft_proposal_section` **12**.

**Why it fails review.** The portal requires *"credentials for a fully populated account"* and that you confirm *"you've run every tool yourself."* The criteria require *"Every tool must return a successful response when called with valid parameters."* A reviewer on a normal signup hits `insufficient_credits` at roughly the halfway mark and **every subsequent tool fails** — a rejection caused purely by metering.

**Fix:** make the reviewer account **Pro** (1000/mo) or top it up to **500+**. 201 is one clean pass with zero retries; reviewers retry.

---

### 2. 🔴 The hosted edge declares a CRM write as read-only — LIVE NOW

`tool-schemas.ts` applied one blanket `READ_ONLY_ANNOTATIONS` to **every** tool on `mcp.getmindy.ai`:

```ts
readOnlyHint: true, idempotentHint: true   // ← on add_contacts_to_crm
```

`add_contacts_to_crm` POSTs to the user's own GoHighLevel `/contacts/upsert`, which **dedupes by email/phone — so it can overwrite an existing contact's fields**. Anthropic's docs: these hints *"determine auto-permissions in Claude: read-only tools can run without per-call confirmation."* **Claude is currently told it may write to a customer's CRM unprompted.** `generate_market_report` is mislabelled the same way (persists a row, mints a public `/reports/{id}` link).

**Fix:** PR **#322** — per-tool `TOOL_META`. Unmerged ⇒ still live.

**Why it was missed:** PR #318 annotated `src/mcp/server.ts` — the **stdio** server. The hosted edge builds tools via `route.ts → mcpRegistrationList() → listMcpTools() → tool-registry.ts`, a different path. **Two surfaces, one catalog** — the "one fix = every surface" rule. The registry also exposes **5 tools stdio doesn't** (`search_sam_opportunities`, `get_market_vocabulary`, `get_contractor_profile`, `find_capable_contractors`, `get_balance`) — **48 hosted vs 43 stdio** — so #318 could never have reached them.

---

### 3. 🔴 Privacy policy is incomplete → *immediate* rejection

`getmindy.ai/privacy` returns 200 but is missing required coverage. The docs list five areas and state: **"Missing or incomplete privacy policies result in immediate rejection."**

| required | status |
|---|---|
| Data collection practices | ✅ |
| Usage **and storage** | ⚠️ partial — usage yes, storage NOT FOUND |
| Third-party sharing | ✅ |
| **Data retention** | ❌ **NOT FOUND — no section at all** |
| Contact information | ✅ (`hello@getmindy.ai`) |

It also never mentions **MCP, connectors, Claude, or AI assistants**, so it doesn't describe the connector's data flow.

**Fix:** add a data-retention section + storage detail; add a paragraph covering the MCP connector data path.

---

### 4. 🟠 Team or Enterprise workspace required

The submission portal lives in org admin settings. *"Admin settings aren't available on individual plans."* Pro/Max can't submit. On Team, only Owners can; Enterprise can delegate via a **Directory management** custom role.

---

## Also open (not submission blockers)

- **5 users are disconnected.** The `MCP_OAUTH_RESOURCE` flip changed the token audience; all 66 resource-bound tokens were minted against the apex and `tokens.ts` rejects `claims.aud !== OAUTH_RESOURCE`. They must re-add at `https://mcp.getmindy.ai/mcp`. Mostly internal (`bra***@`, `eri***@govcongiants.com`).
- **The apex is a second, subtly-broken door.** `getmindy.ai/mcp/mcp` still 401s but now advertises the subdomain's `resource` → mismatch. Redirect or retire it before listing.
- **Connect page shows the old URL** until PR **#319** merges.
- **`tokens.ts` default** still pointed at the apex, with prod relying on the env var to override — meaning preview/local advertised a mismatched resource, and deleting the env var would silently revert prod. Fixed in #319.
- **DCR client proliferation.** 24 registered clients for 5 users (**~5 per user**). Anthropic's docs: *"For servers expecting high traffic from the directory, prefer CIMD or `oauth_anthropic_creds` over DCR."* Not a blocker; will not scale.
- **CIMD is NOT a one-field change.** Advertising `client_id_metadata_document_supported` makes Claude send `client_id` as a URL; `getClient()` does a DB lookup in `mcp_oauth_clients` and `approve` returns `invalid_client` when there's no row ⇒ **every new connection would 400**. Real CIMD = fetch + validate the client metadata document (~1 day). Don't ship the flag alone.
- **Data handling declaration.** The portal asks whether the API is your own, proxied with permission, or a third party's. Mindy is a genuine mix — proprietary corpus (podcast, playbook, contractor DB) + public federal APIs (USASpending, SAM, Grants.gov, SEC EDGAR, GSA CALC, NIH RePORTER). Declare it accurately; *"your server must call your own first-party APIs, or APIs you legitimately proxy."*

---

## Verified DONE

| gate | evidence |
|---|---|
| Transport | `mcp.getmindy.ai/mcp` responds; portal accepts **streamable HTTP or SSE** |
| OAuth 2.0 + PKCE + discovery | `401` + `WWW-Authenticate` w/ `resource_metadata`; `code_challenge_methods_supported:["S256"]`; `/oauth/register` → **201**; `/oauth/token` accepts form-urlencoded (**400, not 415**) |
| Canonical URL | metadata `resource` == `https://mcp.getmindy.ai/mcp` — **exact match** to what a user types |
| Cross-host AS | `authorization_servers:["https://getmindy.ai"]`, AS metadata 200 — explicitly supported |
| Tool names ≤ 64 chars | max is 28 (`get_contractor_award_history`) |
| No catch-all `api_request` tool | purpose-built tools only |
| Public documentation | `getmindy.ai/mcp` + `/mcp/pricing` (200). `/docs` 404 — the connect page satisfies *"a blog post or help-center article is sufficient"* |
| Terms | `getmindy.ai/terms` 200 |

---

## Corrections to the original plan

Verified against the live docs on 2026-07-17. The plan was wrong on three of five gates:

| plan said | actually |
|---|---|
| "Streamable HTTP — **not** legacy SSE (auto-rejected)" | **False.** The portal's Connection step accepts *"streamable HTTP or SSE"*. |
| "**OAuth 2.1** + PKCE — *the* real lift" | It's **OAuth 2.0** (`oauth_dcr` = "OAuth 2.0 with Dynamic Client Registration"). And it was **already built** — not the bottleneck. |
| "Timeline: two weeks to a few months" | **Submission is auto-scanned and listed by default as a Community connector.** *"Verified"* is escalated by Anthropic automatically for connectors "flagged as highly useful" — *"you do not need to take any action."* You can't apply for it. |
| "Mindy's tools are all reads — quick pass" | **False, and it's a safety issue.** Two write: `add_contacts_to_crm` (destructive) and `generate_market_report` (additive). |
| "`getmindy.ai/mcp` is the endpoint" | That's a **prerendered marketing page** (405 on POST). The endpoint was `getmindy.ai/mcp/mcp`, now canonically `mcp.getmindy.ai/mcp`. |

The plan was **right** on: `client_credentials` M2M is unsupported (*"Every connection requires user consent"*), tool annotations required, privacy policy required, populated test account required, Team/Enterprise required, `mcp-review@anthropic.com` for escalations, and **every silent killer** — WAF egress (`160.79.104.0/21`), form-encoded token endpoints, generic 500s, oversized payloads.

---

## Order of operations

1. Merge **#322** (hosted annotations — closes the live safety bug) and **#318** (stdio) and **#319** (connect-page URL).
2. Verify the deployed `tools/list` on `mcp.getmindy.ai` shows per-tool hints — **not** the source, the live endpoint.
3. Privacy policy: add data retention + storage + the MCP data-flow paragraph.
4. Reviewer test account: Pro or **500+** credits, fully populated, with step-by-step access instructions.
5. Redirect or retire the apex `getmindy.ai/mcp/mcp`.
6. Tell the 5 users to re-add at `mcp.getmindy.ai/mcp`.
7. Team seat → submit.

**Interim, and it needs no approval:** keep distributing Mindy as a **custom connector URL**. Per the docs, *"A connector does not need to be in the directory for you to use it"* and *"once connected, a community connector works the same way as a verified one."* Safe to say "works with Claude"; don't claim listing or endorsement until it's real.
