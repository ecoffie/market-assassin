# Claude Connectors Directory — submission readiness (2026-07-17)

## TL;DR

**SUBMITTED to the Connectors Directory on 2026-07-17.** Team seat bought, 11-step
portal wizard completed, `demo@getmindy.ai` handed over as the reviewer account.
It now auto-scans and lists as a **Community** connector; **Verified** is escalated
by Anthropic automatically (not applied-for) for connectors flagged as highly
useful.

Getting here took **six bug fixes in one day** — three server-side and invisible
to any unauthenticated probe (#330, #335, #341), two the portal's own schema
checker caught (#350, #351), and one real product bug a live demo surfaced (#346).
The through-line: **the layer I verified was never the layer that mattered.**

> Every figure below was checked against the live endpoint, the live DB, or the live catalog API — not a build status.

---

## Status

| gate | state | proof |
|---|---|---|
| Transport + canonical URL | ✅ | real MCP `initialize` → 200 on `mcp.getmindy.ai/mcp` |
| OAuth end-to-end | ✅ | logs: `authorize → approve 200 → token 200 → tools` |
| Server identity | ✅ | `name:"Mindy"`, described, iconned, `websiteUrl` |
| Tool annotations (both surfaces) | ✅ | **47 read-only / 2 write** split visible in Claude |
| Privacy policy | ✅ | retention + AI processing + MCP sections live |
| Public documentation | ✅ | `getmindy.ai/mcp` |
| Test credentials | ✅ | `demo@getmindy.ai` — login verified, `mfaRequired:false` |
| Populated account | ✅ | Tantus vault, 5 NAICS, **CRM write proven** (`added:1`) |
| Credits | ✅ | 498 on the demo account; **100** for everyone else |
| **Team/Enterprise seat** | ⬜ | **the only thing left** |

---

## Submission-day timeline (2026-07-17)

The whole thing shipped in one day, and the portal itself surfaced bugs that no
amount of pre-checking had. The pattern, over and over: **the layer I verified was
not the layer that mattered.** An unauthenticated probe passes while the
authenticated path 404s; a title renders while `annotations.title` is absent; a
demo works by API while the reviewer's exact UI flow is the untested one.

Order the bugs surfaced and were fixed:

| # | PR | Surfaced by | What |
|---|---|---|---|
| 1 | #330 | Eric's own connect attempt | consent page polled forever for a key nothing sets |
| 2 | #335 | connecting to the new canonical URL | subdomain 404'd every AUTHENTICATED call |
| 3 | #341 | a missing logo in the chat | hosted server was anonymous ("mcp-typescript server on vercel") |
| 4 | #346 | a live demo asking for 8(a) work | set-aside filter hid 130 of 196 opportunities, silently |
| 5 | #350 | the portal's Tools step | all 49 tools "Missing annotations: title" |
| 6 | #351 | the portal's "1 to fix" | object params (`gates`/`ratings`) emitted no JSON-Schema type |

Plus the groundwork earlier in the day: privacy policy rewrite (#328), tool
annotations on both surfaces (#318/#322), the canonical-URL flip, and the reviewer
account provisioner (#337).

**Submitted through the portal the same day.** Team seat bought, 11-step wizard
completed, auth declared as OAuth 2.0 + DCR, credentials handed over for
`demo@getmindy.ai` with the sign-in-first ordering spelled out.

## The three that would have sunk it (server-side, invisible to probing)

### 1. The canonical subdomain 404'd every AUTHENTICATED call (#335)

`mcp.getmindy.ai/mcp` had **never worked** for real MCP traffic. Every token in the DB was minted against the apex, so nobody hit it — until the canonical URL moved to the subdomain.

```
07:36:57  POST 200  /oauth/token   ← auth succeeded
07:36:58  POST 404  /mcp           ← then this
```

`mcp-handler` matches the path by **strict equality** (`dist/index.js:676`). `basePath:'/mcp'` derived `'/mcp/mcp'`. A Next rewrite **does not rewrite `request.url`**, so the handler saw `/mcp`, compared it to `/mcp/mcp`, and 404'd.

**Why every probe missed it:** `withMcpAuth` returns **401 before the handler runs**. The 401, `WWW-Authenticate`, discovery, resource exact-match, TLS, HTTP/1.1 — all green, all structurally blind. **Unauth 401 / auth 404 was the only tell, and seeing it needs a real token.**

Fixed with explicit endpoints `'/mcp' | '/sse' | '/message'`.

**Consequence: `/mcp/mcp` no longer exists.** The apex MCP path is retired (it was already dead — its tokens fail the `aud` check). Local dev has no reachable HTTP edge either; use `npm run mcp:dev` (stdio).

### 2. The consent page polled forever for a key nothing sets (#330)

The whole connect flow was dead. Three `/oauth/authorize` hits, **zero** `/approve`, zero errors — while Eric sat signed in with 2,000 credits on screen.

The page gated on `localStorage.getItem('mi_beta_email')`, which **only the `/app` surfaces write**. A user signed in via `/mcp/*` holds a valid MI token and no such key → "Sign in to continue" → **polled every 1.5s for a value that would never appear**.

`/api/mcp/session`'s own docstring already said that key was untrustworthy. The console was fixed; this page was left behind.

**Self-concealing:** `/mcp/account` *backfills* the key, so anyone who visited the account page first could connect and anyone who didn't never could. It read as flaky, not broken. See `tasks/mi-beta-email-cleanup.md`.

### 3. The hosted server had no identity (#341)

`serverInfo` was never set, so **mcp-handler's default was our identity in every handshake**:

```
name: "mcp-typescript server on vercel", version: "0.1.0"
```

That's what a reviewer running `initialize` would have seen. The stdio server has always said `mindy-govcon`; the hosted edge — the one Claude actually connects to — was anonymous. No `icons` either, so clients had nothing to draw.

Now: `name:"Mindy"`, description, `websiteUrl`, `icons:[512x512]`. **Ruled out first:** both origins serve byte-identical `/icon.png` and `<link rel="icon">`, so the apex→subdomain move was *not* the cause.

## The two the portal itself caught (schema, invisible until the wizard read it)

### 4. Every tool: "Missing annotations: title" (#350)

A tool title can live in two places: `Tool.title` (2025 spec, `BaseMetadata`) and
`annotations.title` (2024 spec, still in `ToolAnnotationsSchema`). We set only the
top-level one — so cards **rendered** a title while the portal's checker, which
reads `annotations.title`, reported all 49 missing. `mcpRegistrationList`
destructured title **out** of the annotations object. Fix: set it in both from the
one curated `TOOL_META` string.

### 5. `evaluate_bid_decision`: "Parameters missing type: gates, ratings" — the "1 to fix" (#351)

The registry declared both correctly (`type:'object'` + `additionalProperties`),
but the **converter** dropped it: `propToZod` handled enum/array/scalars only, so a
`type:'object'` param fell to `scalar('object')` → `z.unknown()`, which serializes
with **no `type` field**. `gates`/`ratings` are the only nested object params across
49 tools — hence the lone "1 to fix." Fix: `object → z.record(z.string(), <value
type>)`, reading the value type from `additionalProperties`.

**Both were invisible to every local check** — the SDK uses its own zod→schema
serializer, so a local `zod-to-json-schema` scan lied (it flagged even plain
strings). Only the live `tools/list` — and the portal — showed the truth.

**And a caching trap on top:** the submission draft froze the tool list captured at
first-connect. A soft "Refresh" re-rendered the stale copy; only a full
disconnect + re-add + **new draft** re-read the corrected schema. Same class as the
logo cache.

## The bug a live demo caught: the 8(a) filter (#346)

Not a directory bug — a real product bug, found when Eric asked Claude for 8(a)
work near MD mid-submission and got **zero**. The filter did
`ilike('set_aside_description', '%8(a)%')`, but SAM writes competed notices as
"8a Competed" (no parens), so it matched 66 rows and **hid 130**. And the tool's
own description told the model to send "8(a)" — the value that fails. Now filters on
`set_aside_code`, maps `8(a) → [8A, 8AN]` (competed + sole source), and returns an
actionable error instead of a silent zero for an unknown token. Violated a stated
review criterion verbatim: *"return actionable error messages rather than silently
accepting invalid data."*

---

## The reviewer test account

`demo@getmindy.ai` / password issued by `scripts/provision-reviewer-account.ts` (printed once, not stored here).

Two constraints make this non-obvious. **The script asserts both** rather than trusting memory:

**It must be FREE.** `MFA_ENFORCED_PAID='on'`. A **paid** account signing in with a password gets `{mfaRequired:true}` and **no token** — the OTP goes to an inbox we control and the reviewer doesn't. **Do not grant this account Pro/Team/Enterprise.** `resolveAccess` treats `access_team` as Pro ("Team is a superset of Pro"), so a Team grant locks the reviewer out just as hard. It buys nothing anyway — see the tier note below.

**It must have NO credit-balance row.** `grantSignupCreditsIfFirst()` grants only when no row exists. `demo@govcongiants.com` and `disa-demo@getmindy.ai` both sit at **0 with a row** → they'd grant nothing and every tool would fail `insufficient_credits`. This account was instead funded directly: **500 via `admin_grant`** (498 after the CRM write test), which is deterministic and independent of the signup grant.

Populated via the existing `scripts/seed-demo-vault.ts` — TANTUS TECHNOLOGIES, real UEI `HG5EUM78L3Y9`, 3 real USASpending contracts, 5 NAICS / 6 keywords. CRM connected to GHL location `V4H04EQ2wl6n6fkvBzyM`; a real write is proven (`connected:true, added:1, failed:0`).

**Access instructions must spell out the ordering:** sign in at `getmindy.ai/app` **first**, in the same browser, *then* add the connector. Claude Desktop opens the default browser and the consent page needs an existing session.

---

## Corrections — things I asserted and got wrong

| I claimed | Actually |
|---|---|
| A free account can't run `get_winning_playbook` (Pro-gated) | **False.** `MCP_ENFORCE_TIERS` is `''` and `on()` requires the literal `'true'` → `enforceTiers` is **false**, the gate never runs. I read that the env var *existed* and never read its **value**. **No tier change was needed.** |
| Pro allowance is 1000/mo | **6000.** I read 1000 off the ledger — historical, pre-dating the 2026-07-16 bump. |
| SSE is auto-rejected | The portal accepts *"streamable HTTP or SSE"*. |
| OAuth **2.1** is the real lift | It's **OAuth 2.0** — and it was already built. Never the bottleneck. |
| Review takes weeks before listing | Submission is **auto-scanned and listed as Community by default**. "Verified" is escalated by Anthropic automatically. |
| "All tools are reads — quick pass" | **Two write.** That one was a safety bug, not paperwork. |

**The pattern:** four of six were reading that a thing *existed* without reading what it *said*.

---

## Loose ends with clocks

- 🔴 **Rotate the GHL Private Integration Token.** It was pasted into a session transcript (2026-07-17). GHL PITs don't expire on their own. Location `V4H04EQ2wl6n6fkvBzyM`.
- 🟠 **Delete the `Mindy ReviewerTest` contact** (`reviewer-test@example.com`, tag `mindy-directory-review`) written into that location by the write test. **A reviewer will create another one** — use a sandbox location, not a live pipeline.
- 🟠 **`MCP_ENFORCE_TIERS` is off**, so `get_winning_playbook` — the "one LIVE moat tool" — is ungated for **everyone**, not just the reviewer. Turning it on before listing would make the reviewer's free account fail it. Decide *after* approval.
- 🟡 **Per-tool icons aren't reachable.** `ToolSchema` supports `icons`, but the SDK's `registerTool` config accepts only `title/description/inputSchema/outputSchema/annotations/_meta`, and 1.29.0 is the latest published. Server-level icon works (renders in the grouped tool list + connectors panel); per-tool marks on each execution line do not. Worth an upstream issue on `modelcontextprotocol/typescript-sdk`; not worth patching around.
- 🟡 **The July Pro allowance is half-applied** — 713 users on the old 1,000 against the new prices. Self-corrects in August. Backfill-or-accept is a money call (see #325).

---

## What was submitted (portal field reference — kept for the record / re-submission)

1. **Team or Enterprise seat** — bought 2026-07-17.
2. Portal → Connection: `https://mcp.getmindy.ai/mcp`, transport **streamable HTTP**.
3. Portal → Tools: they sync from the server. Expect **49**, grouped 47 read-only / 2 write.
4. Portal → Listing: name, tagline (≤55), description (≤2000), categories, docs URL (`getmindy.ai/mcp`), privacy URL (`getmindy.ai/privacy`), support contact, icon, slug (**permanent once published**).
5. Portal → Authentication: **OAuth with dynamic client registration** (DCR). See the caveat below.
6. Portal → Data handling: Mindy is a **genuine mix** — proprietary corpus (podcast, playbook, contractor DB) *plus* public federal APIs (USASpending, SAM, Grants.gov, SEC EDGAR, GSA CALC, NIH RePORTER). Declare it accurately.
7. Portal → Test & launch: the credentials above **and the sign-in-first ordering**.
8. Submit.

**DCR caveat for step 5:** Anthropic's docs say *"For servers expecting high traffic from the directory, prefer CIMD or `oauth_anthropic_creds` over DCR"* — DCR registers a new client on every fresh connection. We're already at **~5 clients per user** (24 clients / 5 users). **CIMD is NOT a one-field change**: advertising `client_id_metadata_document_supported` makes Claude send `client_id` as a URL, `getClient()` does a DB lookup, `approve` returns `invalid_client` → **every new connection 400s**. Real CIMD = fetch + validate the client metadata document (~1 day). `oauth_anthropic_creds` (email Anthropic a client_id/secret) is the cheaper path.

**Interim, needs no approval:** keep distributing Mindy as a **custom connector URL**. Per the docs, *"A connector does not need to be in the directory for you to use it"* and *"once connected, a community connector works the same way as a verified one."* Safe to say "works with Claude"; don't claim listing or endorsement until it's real.
