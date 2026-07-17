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
| A fresh signup account got (`signup_grant`) | ~~100~~ → **300** (raised 2026-07-17, see below) |
| A Pro account is entitled to (`PRO_MONTHLY_CREDITS`) | **6000** |

Verified against the live catalog API and ledger: `signup_grant` had **4 entries ever, max +100**; `MCP_SIGNUP_CREDITS` was not set in Vercel, so the code default of 100 was what a new account received.

**RESOLVED 2026-07-17:** `MCP_SIGNUP_CREDITS=300` set in Vercel Production and verified live (`/api/mcp/catalog` → `signupCredits: 300`). 300 covers one 201-credit pass with ~49% headroom. **This is TEMPORARY — revert to 100 once the review passes.** It applies to *every* new signup, not just the reviewer, and the revert has no fixed date (see [blocker 4](#4--team-or-enterprise-workspace-required) / the review-timing note).

Why the global grant rather than hand-topping an account: `grantSignupCreditsIfFirst()` fires **once per account, only when no balance row exists**. A reviewer testing the real OAuth connect flow authenticates as *themselves* and lands a brand-new account — the signup grant is the only lever that reaches them.

The priciest tools eat the grant immediately: `draft_proposal` **50**, `find_capable_contractors` **25**, `generate_market_report` **20**, `referee_proposal_compliance` **12**, `draft_proposal_section` **12**.

**Why it fails review.** The portal requires *"credentials for a fully populated account"* and that you confirm *"you've run every tool yourself."* The criteria require *"Every tool must return a successful response when called with valid parameters."* A reviewer on a normal signup hits `insufficient_credits` at roughly the halfway mark and **every subsequent tool fails** — a rejection caused purely by metering.

**Fixed 2026-07-17:** `MCP_SIGNUP_CREDITS=300`, live and verified. 201 is one clean pass with **zero** retries and reviewers do retry, so 300 leaves ~99 credits of slack — enough for a couple of re-runs, but **not** enough to re-run the proposal flagship path twice (`draft_proposal` 50 + `referee_proposal_compliance` 12 + `extract_compliance_matrix` 8 ≈ 70 a go). Bump to 500 if a reviewer reports running dry.

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

- 🔴 **The proposal reprice is HALF-APPLIED, live right now.** `#263` ("coupled proposal-flagship reprices + Pro allowance 1,000→6,000") raised proposal prices *and* was supposed to raise the Pro allowance together. The price half is live; the allowance half is not, for July:

  | | |
  |---|---|
  | last July `pro_monthly` grant ran | 2026-07-16 **09:00:24 UTC** |
  | the 1,000→6,000 bump landed on main | 2026-07-16 **14:12 UTC** (`ea3a6e21`) |

  All **713 grants were +1000**. `applyCreditOnce` is keyed `pro:{email}:{month}`, so **July will never be re-granted**. 713 Pro users are on the old 1,000 allowance against the new prices — a full proposal run is now ~100 credits (draft 50 + matrix 8 + referee 12 + …), so they get **~10 proposals this month**. That is *verbatim* the state `packages.ts` cites as the reason for the bump: *"Pro's old 1,000/mo would only cover ~10 proposals."*

  Self-corrects at the August run. **Decision needed:** backfill the 5,000 difference to the 713 Pro accounts for July (`admin_grant`, or `applyCreditOnce` under a new key), or accept ~2 weeks of the old allowance at new prices. This is a money/customer call, not an engineering one.

  Related: `PRO_MONTHLY_CREDITS` is env-overridable and `packages.ts` warns *"if `MCP_PRO_MONTHLY_CREDITS` is set in Vercel (it may hold the old 1000), UPDATE it to 6000 too — the env wins."* **Checked: it is NOT set**, so the 6000 default applies and the warning is moot. Live catalog confirms `proMonthlyCredits: 6000`.

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
