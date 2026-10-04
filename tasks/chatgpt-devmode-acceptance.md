# ChatGPT developer-mode acceptance — worksheet (NO SUBMISSION)

Phase 2 of `tasks/chatgpt-plugin-path-a.md`. Goal: measure real ChatGPT-host behaviour on the
production `/chatgpt/mcp` endpoint across all 15 tools (routing, latency, timeout, fidelity,
commerce). **Measure only.** No tool-set changes, no latency optimisation, no reviewer account, no
domain verification, no Plugin submission. Do not change routing on one result.

## Final acceptance report (2026-10-03 session) — aggregated

Source of truth: the server report for the clean session (`--since 2026-10-03T21:56:55Z`, test
account only). The raw call-by-call JSON is kept outside the repository as temporary evidence and
is not reproduced here. Routing below is **reconciled from the server call sequence against the
worksheet order**; host-side observations (web before/after, visible answer) come from Eric's
session and are recorded only where reported.

### Totals

- **67 tool calls, all on `/chatgpt/mcp`** (0 calls on any other channel in the window).
- **925 credits** debited, all ChatGPT-attributed. **Final balance: 75** of the 1,000 grant.
  The worksheet's ~660-credit estimate was low, mainly because `capability_market_match` ran 8×
  at 50 credits and one prompt fired `get_solicitation_documents` 9×.
- **All 15 tools exercised.** **0 calls > 45 s, 0 calls > 60 s.** Slowest single call 17.0 s.

### Per-tool latency and telemetry (server-side)

| tool | n | p50 s | p90 s | max s | >45 s | >60 s | outcomes (telemetry) | credits |
|---|---|---|---|---|---|---|---|---|
| assess_market_depth | 3 | 5.2 | 5.3 | 5.3 | 0 | 0 | grounded 3 | 30 |
| capability_market_match | 8 | 5.6 | 13.6 | 13.6 | 0 | 0 | no_result 8 | 400 |
| find_capable_contractors | 3 | 2.3 | 2.3 | 2.3 | 0 | 0 | grounded 3 | 60 |
| find_opportunities | 4 | 1.7 | 7.7 | 7.7 | 0 | 0 | grounded 4 | 40 |
| get_agency_intel | 3 | 2.8 | 3.7 | 3.7 | 0 | 0 | grounded 3 | 15 |
| get_contractor_profile | 2 | 14.1 | 15.1 | 15.1 | 0 | 0 | unclassified 2 | 20 |
| get_expiring_contracts | 1 | 1.8 | 1.8 | 1.8 | 0 | 0 | grounded 1 | 5 |
| get_keyword_coverage | 5 | 0.9 | 2.1 | 2.1 | 0 | 0 | grounded 5 | 25 |
| get_legislation_status | 2 | 0.2 | 0.3 | 0.3 | 0 | 0 | grounded 2 | 10 |
| get_solicitation_documents | 12 | 0.9 | 1.8 | 17.0 | 0 | 0 | grounded 12 | 120 |
| get_solicitation_incumbent | 6 | 1.4 | 2.3 | 2.3 | 0 | 0 | unclassified 6 | 120 |
| lookup_sam_entity | 2 | 0.3 | 3.8 | 3.8 | 0 | 0 | grounded 2 | 10 |
| lookup_solicitation | 6 | 0.7 | 1.4 | 1.4 | 0 | 0 | grounded 5, no_result 1 | 30 |
| search_grants | 2 | 0.1 | 0.1 | 0.1 | 0 | 0 | grounded 2 | 10 |
| search_past_contracts | 8 | 0.5 | 2.2 | 2.2 | 0 | 0 | grounded 6, degraded 2 | 30 |
`unclassified` and the 8× `no_result` are telemetry-labelling debt (below), not failures.

### Routing reconciliation (server-inferred)

| worksheet block | expected tool(s) | server shows | routing |
|---|---|---|---|
| Smoke S1–S6 (A13, D1, A4, A1, B4, B5) | per row | clean reruns: S2 `capability_market_match`, S3 `get_solicitation_incumbent`; A1/B4/B5 re-run in sequence (`find_opportunities` → `find_capable_contractors` → `get_contractor_profile`). A13 ran only in the discarded first pass; covered on the clean account by B10/B11. | PASS |
| A2 lookup | lookup_solicitation | ✓ | PASS |
| A3 documents | get_solicitation_documents | ✓ — **9 calls for one prompt** (first 17.0 s, then ~0.9 s each, seconds apart) | PASS (cost issue, P1) |
| A5 expiring | get_expiring_contracts | ✓ | PASS |
| A6 past contracts | search_past_contracts | ✓ (2 calls) | PASS |
| A7 grants | search_grants | ✓ (2 calls) | PASS |
| A8 competitors | find_capable_contractors | ✓ | PASS |
| A9 named company (V2X) | get_contractor_profile | ✓, followed by a chained `lookup_sam_entity` | PASS |
| A10 SAM entity | lookup_sam_entity | ✓ | PASS |
| A11 Rule of Two | assess_market_depth | ✓ | PASS |
| A12 agency intel | get_agency_intel | ✓, plus 3 chained `search_past_contracts` (**2 degraded, not charged** — retained as measured) | PASS · host outcome: usable answer with material caveats preserved |
| A14 capability fit | capability_market_match | ✓ | PASS |
| A15 keyword distribution | get_keyword_coverage | ✓ | PASS |
| B1–B3 identify / documents / incumbent | lookup → documents → incumbent | ✓ each intent produced its own tool | PASS |
| B4/B5 | find_capable_contractors / get_contractor_profile | ran in the smoke rerun | PASS |
| B6 Rule of Two | assess_market_depth | ✓ (an extra `lookup_solicitation` just before it is unattributed) | PASS |
| B7 plain-English fit | capability_market_match | ✓, plus a chained `find_opportunities` | PASS |
| B8 keyword distribution | get_keyword_coverage | ✓ | PASS |
| B9 agency priorities | get_agency_intel | ✓ | PASS |
| B10 bill status | get_legislation_status | ✓ | PASS |
| B11 bill status, news-flavoured | (record) | `get_legislation_status` | Mindy chosen |
| P1 discovery | find_opportunities | ✓ (2 calls) | PASS |
| P2 deep-dive chain | lookup + documents + incumbent | ✓ all three | PASS |
| P3 competition + Rule of Two | find_capable_contractors + assess_market_depth | ✓ both | PASS |
| P4 company fit | capability_market_match | ✓ | PASS |
| P5 market sizing | get_keyword_coverage + get_agency_intel | ✓ both | PASS |
| N1 draft + submit | no write tool exists | read-only `get_solicitation_documents` + `lookup_solicitation` only | PASS (server: no write possible) |
| N2 commerce probe | no Mindy commerce | no Mindy call | PASS (server) |
| N3 fabrication probe | honest not-found | `lookup_solicitation` → `no_result` | PASS (server) |
| D1–D5 latency | capability_market_match ×5 | 4 calls in the D block + D1 already run as S2 | PASS, max 13.6 s |
| D incumbent ×3 | get_solicitation_incumbent | 3 calls | PASS, max 1.6 s |
| D past contracts ×3 | search_past_contracts | 3 calls | PASS, max 0.5 s |
| D keyword coverage ×3 | get_keyword_coverage | **2 calls for 3 prompts**; none after the report window; arguments are not logged, so neither call can be attributed to a specific prompt | "satellite imagery" row: **HOST_RESULT_VISIBLE / SERVER_CALL_NOT_ESTABLISHED** (reconciliation debt) |

**Routing: no ROUTING_FAIL found on the server side.** Every worksheet intent that should reach
Mindy produced its intended tool, including the contrastive B pairs — except the one D-block
keyword-coverage row whose server call is not established (below).

**Web usage: `WEB_USAGE_NOT_RECORDED` for every clean-run row**, including B10/B11. The web-search
indicator was not systematically recorded during the clean Path A run, and the transcript does not
establish web-before/web-after per row. B10/B11 visibly answered from Mindy's stored legislation
status, but without the host UI indicator recorded their web field stays NOT_RECORDED. "No web" is
not inferred from an answer citing Mindy, and "web" is not inferred from ordinary links in
ChatGPT's prose. (Web use observed in the discarded first pass does not carry over.) This is a
documentation gap, not a product failure.

### Host-side reconciliation (Eric's manual run)

- **D-block "satellite imagery" (`get_keyword_coverage`)** — ChatGPT showed a detailed
  Mindy-attributed answer ($2.82M FY2026 exact-phrase spending, 11 awards / 12 transactions,
  NAICS 541512 leading at $2.48M / 87.9%, with coverage caveats). The server has only 2
  keyword-coverage calls for the 3 D-block prompts and no later call, so a server call for this
  row is **not established**. Recorded as `HOST_RESULT_VISIBLE / SERVER_CALL_NOT_ESTABLISHED`.
  Not PASS from prose; no missing call inferred; not rerun.
- **A12 (VA facilities & construction)** — host answer usable and kept the degraded-evidence
  boundary: EHRM infrastructure, medical-center renovation, HVAC/central-plant modernisation,
  energy/resiliency and construction-management themes; the $78.3B FY2025 figure stated as
  VA-wide, not construction-only; the 16.4% small-business and 9.1% set-aside figures stated as
  VA-wide; individual award values stated as lifetime totals, not FY2025 spending, and not to be
  summed. No visible failure or "could not complete". **Host outcome: usable answer with material
  caveats preserved. Server outcome: 2 × `search_past_contracts` degraded, kept exactly as
  measured** — not relabelled grounded because the final answer was useful.
- **Web usage** — see above: `WEB_USAGE_NOT_RECORDED`.

### Fidelity findings

- **S3 `get_solicitation_incumbent`: PASS** — local replay matched every figure and caveat.
- **S2 `capability_market_match`: UNVERIFIED** — the answer kept the "unverified candidate" framing
  and invented nothing, but the exact arguments are not recoverable (see Smoke gate results).
- **All other rows: not verified.** No surprising claim or telemetry/answer conflict was reported
  for them, so per the Fidelity procedure no further replays were run. N1/N2/N3 pass on server
  evidence; their visible wording is Eric's observation to confirm.

### Commerce invariants

`paywall_attempts = 0` · `signup_grants = 0` · `auto_recharge = 0` · no non-ChatGPT debits ·
no grants in the window. **PASS.**

### Issues

**P0 — none.** No timeouts, no wrong-endpoint calls on the clean account, no commerce leakage, no
fabrication on the one fully verified answer or the fabrication probe.

**P1**
1. **Repeated `get_solicitation_documents` calls** — one A3 prompt fired the tool 9× (90 credits).
   Whether ChatGPT looped, paged attachments, or retried is not determinable from the server log.
   A real user would pay for it. Investigate before submission.
2. **`capability_market_match` result quality + labelling** — 8/8 logged `no_result`; the tool
   returns thin, unverified candidate evidence whenever company identity is not corroborated, and
   every call is charged 50 credits. Fidelity of the visible answers is unverified.
3. **`search_past_contracts` degraded ×2** in the A12 chain (correctly uncharged). Host answer was
   usable with caveats preserved; the upstream cause of the degradation is still unknown and
   should be checked for recurrence.

**P2**
1. Telemetry: `get_solicitation_incumbent` / `get_contractor_profile` logged `unclassified`.
2. Billing decision: honest not-found (`lookup_solicitation`, N3) charged 5 credits; thin
   `capability_market_match` charged 50.
3. `get_contractor_profile` is the slowest tool (p50 14.1 s) — under the host limit, but noticeable.
4. Reconciliation debt: the D-block "satellite imagery" row is
   `HOST_RESULT_VISIBLE / SERVER_CALL_NOT_ESTABLISHED`; and web usage is `WEB_USAGE_NOT_RECORDED`
   for all clean-run rows. Future runs should record the server row immediately after each prompt
   and the host web indicator per row.
5. Credit estimate for a full pass should be ~950, not ~660.

### Submission GO / NO-GO

**Host behaviour: GO** (with the documented reconciliation gaps) — routing, latency (0 calls near the limit; `capability_market_match`
viable at ≤ 13.6 s) and commerce invariants all pass on server evidence.

**Submission: NO-GO for now.** Remaining blockers, none of which this session can clear:
1. The existing-credit policy question (open since before this session).
2. P1 #1 (repeated document calls) and P1 #2 (`capability_market_match` charging/quality) need an
   owner decision or fix first.
3. Reviewer account, domain-verification token and submission remain deliberately not started.

## Setup (once) — the real OAuth flow, no pre-seeded session

- **Account:** `chatgpt-devmode-acceptance@getmindy.ai` — synthetic, no customer owns it, funded by
  `admin_grant` (does NOT reset the ChatGPT auto-recharge window; no card on file, so no payment is
  possible). Never use a real customer or `credit-integrity-acceptance@` (its live test drains it).
- **Login:** a password login was attached 2026-10-03 (email confirmed, `email` provider). The password was placed
  in Eric's clipboard only — it is not in this repo, any doc, or any log. If it is lost, reset it with
  the admin API; do not create a second account. Verified before/after: the only state change was the
  auth identity plus the `user_profiles` row the `on_auth_user_created` trigger always inserts
  (`tier='free'`, every paid `access_*` flag false; `access_daily_briefings=true` is the column
  default, the free daily alerts — 2,871/2,876 free profiles carry it). Credit balance stayed 1,000,
  the ledger still holds only the one `admin_grant` row, and no KV entitlement key exists. It is a
  FREE account, so password sign-in mints a session with no email OTP (`MFA_ENFORCED_PAID` applies
  to paid accounts only).
- **Connect (incognito window, so your own Mindy session is untouched). Do NOT paste a session token
  into DevTools — the point is to test the flow a real user gets:**
  1. Sign in to chatgpt.com (a Plus/Pro/Business account) → Settings → **Security and login** →
     Developer mode ON. Then open **ChatGPT Plugins** → **+** → create a developer-mode app:
     URL `https://mcp.getmindy.ai/chatgpt/mcp`, authentication OAuth. (Path per OpenAI's
     developer-mode guide, developers.openai.com/api/docs/guides/developer-mode, as of 2026-10-03;
     the older "Apps & Connectors → Advanced" path is gone.)
  2. ChatGPT opens Mindy's `/oauth/authorize`. Signed out, it shows "Sign in or create an account"
     with **no free-credit promise** (ChatGPT resource). Open the sign-in link, sign in with the
     synthetic email + the clipboard password. The consent tab picks up the session by itself.
  3. The consent page must show the **ChatGPT** copy with **no free-credit promise**. Click **Allow**.
     ChatGPT should show the connector as connected.
  4. Confirm the connector lists **exactly 15** tools.
- **Per prompt:** new chat, web search left at default (we want to see whether ChatGPT picks web or
  Mindy). **Never say "use Mindy"** unless a row says so. Start a stopwatch at Send, stop when the
  answer finishes streaming. ChatGPT does NOT show the raw tool arguments/result in a panel — the
  tool, latency, outcome and credits come from the server report (see Fidelity procedure).

## ⚠ Per-chat activation — required for EVERY fresh test chat

Chat Mindy being installed globally is **not sufficient**. ChatGPT only offers an app's tools to a
chat where it was selected. For every fresh test chat:

1. Click **+** in the composer → select **Chat Mindy**.
2. Confirm the blue **Chat Mindy** label is visible in the composer **before** sending the prompt.

If the label is not visible when the prompt is sent, the row is **`INVALID_SETUP`**, not
`ROUTING_FAIL` — rerun it in a new chat with the app selected. (Measured 2026-10-03: the first clean
S2 attempt ~21:57Z produced zero `/chatgpt/mcp` requests in the Vercel logs — not even
initialize/tools/list — and a web-only answer; the rerun with the app selected called Mindy.)

## ⏱ Record the UTC start — immediately before the first prompt

Run `date -u +%Y-%m-%dT%H:%M:%SZ` right before sending the first prompt (after connecting, not before)
and write it here: `SINCE = 2026-10-03T21:56:55Z` (clean session, recorded 2026-10-03). It is the `--since` for the server report, which isolates
this session's calls by `mcp_call_log.channel='chatgpt'` + the synthetic email.

## 🚦 Smoke gate — run FIRST, before spending the full budget (~50 credits)

| # | check | prompt / action | pass condition |
|---|---|---|---|
| S0 | tool count | connector tool list | exactly 15 tools |
| S1 | discovery without being told (A13) | What is the current status of the FY2027 NDAA? | ChatGPT selects `get_legislation_status` (record if web ran instead/also) |
| S2 | latency risk (D1, verbatim) | We're a veteran-owned firm that provides cybersecurity assessments and FedRAMP readiness consulting. | `capability_market_match` completes before the ChatGPT host timeout |
| S3 | incumbent (A4) | Who currently holds the contract that solicitation W5168W26RA015 (Fort Benning base operations) is replacing? | `get_solicitation_incumbent` |
| S4 | FIND (A1) | Find open federal contracting opportunities for a commercial HVAC contractor in Arizona. | `find_opportunities` |
| S5 | boundary (B4) | Who are my likely competitors for VA chiller replacement work (NAICS 238220)? | `find_capable_contractors` |
| S6 | boundary (B5) | Tell me about Amentum's federal contracting footprint. | `get_contractor_profile` |

**STOP — do not run the full worksheet — if either:**
- `capability_market_match` hits the ChatGPT host timeout (spinner then "took too long", retry, or
  ChatGPT gives up / falls back to web), **or**
- ChatGPT repeatedly/systematically fails to discover Mindy (e.g. S1, S4 and S5/S6 all go to web or
  no tool). One miss is a data point, not a stop.

On a stop: run the server report (below) with the recorded `SINCE`, fill the results table for the
smoke rows only, and report. Do not change routing or latency on these results.

### Smoke gate results (2026-10-03)

- **First pass (14:34–15:34Z) — DISCARDED as setup-contaminated.** Two Mindy apps were installed
  (the old full `/mcp` connector + `/chatgpt/mcp`) and `/chatgpt/mcp` was authorised as Eric's own
  account, not the test account. S3's `get_solicitation_incumbent` call went through `/mcp`
  (`channel` NULL). Fix: removed the old `/mcp` app, reconnected `/chatgpt/mcp` signed in as the
  test account (connection verified server-side as bound to the `/chatgpt/mcp` resource). Eric then
  confirmed the remaining smoke rows routed correctly; S2 and S3 were rerun clean.
- **Clean reruns — report start `SINCE = 2026-10-03T21:56:55Z`:**

| # | account | channel | tool | server ms | credits | routing | timeout | telemetry | answer fidelity |
|---|---|---|---|---|---|---|---|---|---|
| S2 (D1 + "Where does my company fit in the federal market?") | chatgpt-devmode-acceptance@getmindy.ai | chatgpt | capability_market_match | 13,220 | 50 | PASS | PASS | `no_result` / grounded=false | **UNVERIFIED** |
| S3 (A4) | chatgpt-devmode-acceptance@getmindy.ai | chatgpt | get_solicitation_incumbent | 2,259 | 20 | PASS | PASS | `unclassified` (see telemetry debt) | **PASS** |

- **S2 fidelity UNVERIFIED — why.** ChatGPT's answer kept the tool's framing (it could not place the
  company in a verified market from the description alone and asked for past performance or a
  clearer description) and invented no NAICS code, dollar figure or competitor. But the call log
  stores no arguments or result body, ChatGPT shows neither, and the answer cites terms (NIST 800-53,
  gap assessments) suggesting ChatGPT expanded the description before calling. A local unbilled
  replay with the plain description returned a thin unverified candidate (NAICS 541519, PSC DJ01,
  1 forecast, 0 competitors, total_market null, `grounded=false` because no SAM/award identity was
  resolved). ChatGPT said no NAICS lane / forecasts could be verified: either accurate reporting of
  an unverified candidate or dropped evidence — not decidable without the exact arguments.
- **S3 fidelity PASS.** A local replay of `get_solicitation_incumbent` for W5168W26RA015 matched
  every substantive figure and caveat in the answer: TIYA Services, L.L.C.; prior award W911SF19C0024;
  NAICS 561210 / PSC S216; $333,142,007 obligated; $429,992,933 ceiling ("≈ $430.0M"); PoP
  2019-09-01 → 2025-08-31; match confidence high; Small Business Set Aside – Total; deadline
  2026-11-13; sibling-notice deadline-conflict caveat kept.
- Ledger for the clean window: exactly two debits (−50, −20, both `channel=chatgpt`), balance
  1,000 → 930. No paywall row, signup grant or auto-recharge.

**If the smoke gate passes:** continue through the complete worksheet (A → B → C → D; skip rows the
smoke gate already ran and reuse their results), then run the server report with the same `SINCE`.

## Primary result table (one row per prompt — this IS the deliverable)

| # | prompt | first host choice (Mindy / web / none / other) | Mindy tool | arguments | web before? | web after? | tool latency (server report) | outcome (server report) | answer fidelity | classification |
|---|---|---|---|---|---|---|---|---|---|---|

- **tool latency / outcome** come from the server report (grounded / degraded / refused / error),
  matched by tool + time. Also note the stopwatch end-to-end seconds and whether the answer finished
  before the host timeout in **answer fidelity** or a notes line.
- **answer fidelity** = does the answer state only what the tool returned (counts, names, dollars,
  dates) and keep its caveats? Any invented figure or dropped material caveat → `HOST_MISREPRESENTATION`.
  Note any commerce wording (prices, upgrade, buy credits) here too.
- **classification** = `PASS` | `ROUTING_FAIL` | `TIMEOUT` | `TOOL_ERROR` | `HOST_MISREPRESENTATION`
  (or `INVALID_SETUP` if the Chat Mindy label was missing — rerun; it is not a result)
  (definitions in the Classification section).

## A. Direct test — one per tool (15)

Fixtures are real production records (queried 2026-10-03).

| # | intended tool | prompt |
|---|---|---|
| A1 | find_opportunities | Find open federal contracting opportunities for a commercial HVAC contractor in Arizona. |
| A2 | lookup_solicitation | What is federal solicitation W5168W26RA015? |
| A3 | get_solicitation_documents | Read the solicitation documents for W5168W26RA015 and summarize the scope of work. |
| A4 | get_solicitation_incumbent | Who currently holds the contract that solicitation W5168W26RA015 (Fort Benning base operations) is replacing? |
| A5 | get_expiring_contracts | Which federal janitorial contracts (NAICS 561720) expire in the next 12 months? |
| A6 | search_past_contracts | Show me federal facilities-support contracts (NAICS 561210) performed in Georgia over the last few years. |
| A7 | search_grants | Find open federal grants for rural broadband deployment. |
| A8 | find_capable_contractors | Which small businesses could compete with me, or team with me, on custodial work (NAICS 561720) in Texas? |
| A9 | get_contractor_profile | Give me a federal contracting profile of V2X. |
| A10 | lookup_sam_entity | Look up the SAM.gov registration for UEI RRFJZGASZJ41. |
| A11 | assess_market_depth | For HVAC work under NAICS 238220, would a contracting officer find at least two capable small businesses? Assess the Rule of Two. |
| A12 | get_agency_intel | What are the Department of Veterans Affairs' priorities and recent spending for facilities and construction work? |
| A13 | get_legislation_status | What is the current status of the FY2027 NDAA? |
| A14 | capability_market_match | My company does drone-based LiDAR surveying and photogrammetry for infrastructure inspection. Where is my federal market? |
| A15 | get_keyword_coverage | How is federal contract spending on "drones" spread across NAICS codes? |

## B. Routing boundaries (contrastive)

Same notice / same market, different intent: the tool must change with the intent.

| # | boundary | prompt | expected |
|---|---|---|---|
| B1 | identify | Is 36C25626R0131 still open, and who is buying it? | lookup_solicitation |
| B2 | documents | What does the statement of work for 36C25626R0131 actually require? | get_solicitation_documents |
| B3 | incumbent | Who did the work 36C25626R0131 is buying last time? | get_solicitation_incumbent |
| B4 | competitor discovery | Who are my likely competitors for VA chiller replacement work (NAICS 238220)? | find_capable_contractors |
| B5 | named company | Tell me about Amentum's federal contracting footprint. | get_contractor_profile |
| B6 | Rule of Two | Is NAICS 561720 deep enough in small businesses to justify a set-aside? | assess_market_depth |
| B7 | plain-English fit | We're a 20-person firm that does building automation and energy audits. What federal work fits us? | capability_market_match |
| B8 | keyword distribution | Which NAICS codes does federal "janitorial" spending actually fall under? | get_keyword_coverage |
| B9 | agency priorities | What is the Army Corps of Engineers focused on buying right now? | get_agency_intel |
| B10 | bill status (Mindy vs web) | Has the FY2027 NDAA passed the Senate yet? | get_legislation_status (record whether web ran instead/also) |
| B11 | bill status, news-flavoured | What happened with the defense authorization bill this week? | record Mindy vs web; do not change routing on this |

## C. Reviewer scenarios

⚠ Reconstructed from the routing design. The readiness report (Claude Doc
`Td6VHv5GQUEgKVHaeocLdL`) holds the canonical 5 + 3; if its wording differs, run the doc's and note it.

Positive (should use Mindy, grounded, no commerce):
- **P1 Discovery:** I'm a small HVAC contractor in Arizona. Find me open federal work and tell me which one to look at first.
- **P2 Solicitation deep-dive (chain):** Walk me through W5168W26RA015: what it is, what the scope requires, and who holds the current contract.
- **P3 Competition:** For custodial work (NAICS 561720) in Texas, who would I be competing against, and is there a Rule-of-Two case for a small-business set-aside?
- **P4 Company fit:** We build ruggedized edge-computing servers for field military use. Where is our federal market and who buys it?
- **P5 Market sizing:** How big is the federal market for "cybersecurity", which NAICS codes does it fall under, and which agencies buy the most?

Negative (must not misbehave):
- **N1 Write action:** Draft a proposal for W5168W26RA015 and submit it to the contracting officer. → No submission claimed; no Mindy write tool exists; ChatGPT may draft text itself but must not say Mindy submitted anything.
- **N2 Commerce probe:** How do I buy more Mindy credits or upgrade my Mindy plan? → No price, link, or upgrade copy from Mindy tools (ChatGPT's own words are noted separately).
- **N3 Fabrication probe:** Look up federal solicitation ZZQ-9999-NOT-REAL. → Honest not-found; no invented title, agency or dates.

## D. Latency runs (do not optimise; measure)

capability_market_match ×5 (record each; this decides the submission blocker):
- D1 We're a veteran-owned firm that provides cybersecurity assessments and FedRAMP readiness consulting.
- D2 Family-owned commercial roofing and waterproofing contractor in Florida.
- D3 We make medical simulation mannequins and training software for clinicians.
- D4 Small engineering firm doing environmental remediation and groundwater sampling.
- D5 We provide bilingual call-center and document-translation services.

Long-tail tools ×3 each:
- get_solicitation_incumbent: W90VN727RA001 · 140P4226R0023 · 36C10X26Q0091
- search_past_contracts: NAICS 238220 in Arizona · NAICS 541512 in Virginia · NAICS 561720 in Texas
- get_keyword_coverage: "janitorial" · "body armor" · "satellite imagery"

**Timeout behaviour to determine:** for any call over ~45 s, record what ChatGPT showed (spinner,
"tool took too long", retry, silent fallback to web, or a final answer) and whether the server log
still shows the call completing (it may finish after ChatGPT gave up). The route's `maxDuration` is 60 s.

## Credit budget

≈ 660 credits for one full pass (A 170, B ~120, C ~150, D 340 less overlaps). The account is funded
with 1,000. Re-fund only by `admin_grant`.

## Fidelity procedure — local replay only when warranted

ChatGPT does not expose raw tool arguments/results, and `mcp_call_log` stores neither. Do **not**
replay every call locally — that turns acceptance into a much larger test. Replay a call (direct
function call from a worktree: unbilled, unlogged) only when:

- the ChatGPT answer contains a surprising or specific claim (a figure, name, date) worth checking;
- the server telemetry conflicts with the visible answer (e.g. `no_result` but a specific answer); or
- the scenario specifically requires fidelity verification (e.g. N3 fabrication probe).

Otherwise record answer fidelity from the visible answer and mark anything uncheckable `UNVERIFIED`.

## Telemetry debt found during acceptance — record only, do NOT fix during acceptance

These distort the server report's `outcome` column; read those tools' outcomes by hand for now.

1. **capability_market_match** — useful candidate evidence (candidate NAICS/PSC, forecasts) can be
   labelled `no_result`: the tool sets `grounded=false` whenever company identity is not
   corroborated (`src/lib/market/capability-anchor.ts`, grounded = coverage ∧ high confidence ∧
   corroborated), and `classifyCallOutcome` maps `grounded=false ∧ degraded=false` → `no_result`.
2. **get_solicitation_incumbent** — a grounded result is logged `unclassified`: it exposes
   `_meta.grounded_notice` / `_meta.grounded_incumbent` (both true for W5168W26RA015), not plain
   `grounded`.
3. **get_contractor_profile** — appears to have the same `unclassified` problem (15:33:43Z call this
   morning); not yet confirmed in code.
4. **Billing (post-acceptance product decision, not a bug):** a thin/unverified
   `capability_market_match` result is still charged the full 50 credits (`billable_no_result`).

## Collect the server-side evidence

After the session (read-only):

    npx tsx scripts/chatgpt-devmode-report.ts --email chatgpt-devmode-acceptance@getmindy.ai --since <SINCE>
    npx tsx scripts/chatgpt-devmode-report.ts --email chatgpt-devmode-acceptance@getmindy.ai --since <SINCE> --json > devmode-report.json

It prints per-tool n / p50 / p90 / max server latency, >45 s / >60 s counts, outcomes, the ledger
split (ChatGPT vs other debits), and the commerce invariants (paywall attempts, signup grants,
auto-recharge — all must be 0).

## Classification (one per tool)

`INVALID_SETUP` (the Chat Mindy label was not in the composer when the prompt was sent — rerun, do
not count) · `PASS` · `ROUTING_FAIL` (ChatGPT picked another tool / web / nothing for the tool's intended prompt) ·
`TIMEOUT` (host gave up or the call exceeded the host limit) · `TOOL_ERROR` (server outcome error /
degraded with no usable result) · `HOST_MISREPRESENTATION` (ChatGPT stated something the result did
not contain, or dropped a material caveat). A tool is PASS only if its direct test and every routing
row that targets it pass.

**capability_market_match** is a submission blocker if real ChatGPT calls time out or are
unacceptably slow; it is not a blocker to the deployed (unsubmitted) endpoint.
