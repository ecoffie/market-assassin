# One-Shot Composite Tools — scope & build plan

**Status:** ✅ all three shipped (2026-07-16). 1) `generate_market_report` #283 · 2) `add_contacts_to_crm`
#285 + the Connect-GoHighLevel card #286 · 3) calendar `.ics` (this PR). Remaining follow-ups are the
GHL provision path + full OAuth (see Open / deferred).

**The idea (Eric):** Mindy users are already chaining multiple tools by hand —
Sue builds a whole-market report for clients, Branden puts a year of federal events
on his calendar, Eric pulls a solicitation then researches the agency. Go one step
further: **collapse each workflow into a single agent call.** These are composite MCP
tools that fan out to existing Mindy tools/libs and assemble the result — no new data
engines, mostly composition + packaging. All route through the untouched
`runMeteredTool` billing seam; all follow the tool pattern (pure fn, `_meta` always,
`_ai_hint` gated OFF, honest-miss = never fabricate).

---

## Decisions (locked)

| Question | Decision |
|---|---|
| Report deliverable | Structured JSON **+ a client-ready rendered report** (hosted shareable URL + PDF). |
| Report branding | **Mindy-branded** — subtle "Powered by Mindy" footer (doubles as distribution). |
| CRM target | **User's own GHL.** Bring-your-own if they have it; **provision a sub-account under the GovCon Giants agency if they don't.** |
| GHL connect v1 | Paste **Private Integration Token + Location ID** (BYO) → phase-2 full GHL OAuth. |
| Build order | 1) market report → 2) CRM contacts → 3) calendar .ics bonus. |

---

## 1. `generate_market_report` — the whole market in one call

**Input:** `keyword` (primary), or `naics` / `agency`; optional `state`, `set_aside`, `client_name`.

**Fans out (parallel) to existing pure libs — verified present:**
| Section | Reuse |
|---|---|
| Total market $ · all buying NAICS · top PSC | `lib/market/keyword-coverage` → `keywordCoverage()` / `codeMarketSize()` |
| Top buying agencies | `lib/usaspending/agency-spending-detail.ts` + `find-agencies` logic |
| Competitive landscape (top vendors + SB mix) | `lib/bigquery/recipients` → `searchRecipients({liveBq:true})` |
| Recompetes (expiring) | `recompete_opportunities` Supabase read (get_expiring_contracts lib) |
| Upcoming forecasts | `agency_forecasts` Supabase read (get_agency_forecasts lib) |
| Active solicitations | tier1 `search_sam_opportunities` fn |
| Set-aside gap | `get_sba_goaling_share` lib |

**Output:** structured JSON (all sections + `_meta.grounded/degraded/sections_count`) **plus**:
- ✅ a **hosted shareable report** at `/reports/[id]` (Mindy-branded HTML; Sue emails the link),
- ✅ persisted to `market_reports` (id, owner_email, subject, client_name, params, payload jsonb, created_at),
- ⚠️ **PDF = the hosted page's "Save as PDF" button** (`window.print()` + the existing `@media print`
  CSS), NOT a base64 binary. Server-side HTML→PDF needs Chromium in the lambda — `puppeteer` is a
  **devDependency** (scrapers only), so shipping it would mean adding `@sparticuz/chromium` (~50MB +
  cold starts) or an external render service. Deferred as its own call; the print path gives Sue a
  real PDF today.

**Shipped notes:**
- The `id` is a 22-char random token (`crypto.randomBytes(16)` base64url) and **is** the access
  control — `/reports/[id]` is deliberately PUBLIC so Sue's client can open it without a Mindy
  login (capability URL, like an unlisted share link). `noindex` + `Cache-Control: private`;
  malformed and missing ids return an identical 404 so it can't be probed.
- Stored as the **payload**, not the rendered HTML → renderer fixes reach already-shared links.
- Owner = the **verified MCP caller** (`ctx.userEmail`), never an agent-supplied field.
- Saving is **best-effort**: storage down → `deliverable.url: null`, `_meta.saved: false`, and the
  caller still gets the full JSON + inline HTML (they paid credits for it). The `_ai_hint` branches
  on the link so an agent never invents a report URL.

**Credits:** ~20 (flagship bundle sink, like `draft_proposal`).
**Mirror bonus:** extract the composition into `lib/market/market-report.ts` so the in-app
Market Research panel can get a one-shot "Build full report" button off the same code.

---

## 2. `add_contacts_to_crm` — push to the user's own GHL

**New piece: per-user GHL connection.**
- **Connect card** in `/mcp/account`: paste GHL **Private Integration Token + Location ID**
  → stored in new `user_crm_connections` (owner_email, provider='ghl', token_encrypted,
  location_id, provisioned bool). Service-role RLS only; token encrypted at rest; never logged.
- **No GHL yet? Provision.** Create a sub-account (location) under the GovCon Giants agency
  via the GHL Agency API, store it as their connection, `provisioned=true`.
  - **⚠️ Dependency (Eric):** needs the GovCon Giants GHL **Agency** API token + an agency
    plan that allows programmatic sub-account creation; **GHL bills per sub-account** unless
    on unlimited/SaaS-mode. BYO path ships without this; provision path switches on after confirm.
- **Lib:** extend `src/lib/ghl/` with `upsertContactsBatch(token, locationId, contacts[])`
  → GHL `POST /contacts/upsert` (dedupe by email/phone).
- **Tool:** `contacts[]` (name/email/phone/company/title) + `tags` → resolve caller's stored
  GHL creds by MCP identity → batch upsert → per-contact `{contactId, created|updated|failed}`.
  No connection → honest `grounded:false` + "Connect GoHighLevel in Mindy settings first."
- **Feeds from** `search_federal_contacts` · `get_sblo_contact` · `find_capable_contractors`
  · `lookup_federal_osbp` → "find my targets → add to my CRM" is one hop.
- **Credits:** ~2 flat (or per 25 contacts).

---

## 3. Calendar `.ics` — Branden's calendar, one-shot (bonus) — ✅ SHIPPED

**Shipped as an `include_ics` flag on `search_federal_events`, not a separate tool.** The events
are already there; a second tool would just re-run the same query to repackage it. Opt-in
(`include_ics: true`) → `ics` = base64 VCALENDAR + `_meta.ics_events` / `ics_skipped_undated`.
No new credits — it's packaging on the existing 2-credit call.

- Builder: `src/lib/events/ics.ts` (`buildEventsIcs`) — pure, dependency-free, RFC 5545
  (CRLF, 75-octet folding on the byte budget, TEXT escaping, all-day `DTSTART;VALUE=DATE`
  with the exclusive `DTEND`, stable UIDs so re-import updates instead of duplicating).

**⚠️ Scope change from the original plan — `get_federal_event_series` gets NO .ics.**
A calendar entry asserts "this happens on this day." The series catalog holds **cadence**
("quarterly") and **typical_month** ("annual · March") — not confirmed instances. Emitting
VEVENTs from those would invent dates, which the no-fabrication contract forbids, and would
put wrong dates on a user's real calendar. Same rule inside `search_federal_events`: undated
AI-discovered events are **skipped and counted** (`ics_skipped_undated`), never guessed onto
a day. Only `search_federal_events`' real dated rows become calendar entries.
*If we want the series on a calendar later, the honest path is sourcing real dates for the
catalog (or TENTATIVE all-day entries the user opts into knowing they're approximate) —
not deriving them from cadence.*

**Verified:** 12 unit tests green; live DoD 12-month call → 23 events, 23 dated → 23 VEVENTs,
0 untraceable dates, 0 over-long lines, opt-in guard holds; the generated file parses in an
independent RFC 5545 parser (python `icalendar`) with 23 unique UIDs and correct all-day spans.

---

## Cross-cutting / plumbing
- **Registration:** each tool the two-path way (`tool-registry.ts` def + `TOOL_CREDITS` +
  `isMcpTool`/`runMcpTool`, and `server.ts` zod) + a `mcp-smoke.mjs` block (grounded +
  traceability; CRM smoke asserts the not-connected honest path).
- **Migrations (hand-run by Eric):** `market_reports`, `user_crm_connections`.
- **Data-first:** `_ai_hint` stays OFF by default.
- **Verify live:** smoke green → real MCP call → an openable rendered report + a test contact
  landing in a GHL location.

## Open / deferred
- **GHL provision path — DROPPED for now (Eric, 2026-07-16): "have the user put his information in
  directly."** BYO (paste Private Integration Token + Location ID) is the only path. This also sidesteps
  the agency-plan per-sub-account billing question. Revisit only if BYO friction shows up in real use.
- Full GHL OAuth (one-click connect) = phase-2 after paste-token v1.
- Report white-label (Sue's own brand) = deferred; Mindy footer for now.
- **Binary PDF** (`@sparticuz/chromium` or a render service) — deferred; Save-as-PDF covers it today.
- **"My reports" list** — `listMarketReports(ownerEmail)` exists in the store but has no UI yet;
  natural next step is a section on `/mcp/account`.
