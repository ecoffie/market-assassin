# ChatGPT developer-mode acceptance — worksheet (NO SUBMISSION)

Phase 2 of `tasks/chatgpt-plugin-path-a.md`. Goal: measure real ChatGPT-host behaviour on the
production `/chatgpt/mcp` endpoint across all 15 tools (routing, latency, timeout, fidelity,
commerce). **Measure only.** No tool-set changes, no latency optimisation, no reviewer account, no
domain verification, no Plugin submission. Do not change routing on one result.

## Setup (once) — the real OAuth flow, no pre-seeded session

- **Account:** `chatgpt-devmode-acceptance@getmindy.ai` — synthetic, no customer owns it, funded by
  `admin_grant` (does NOT reset the ChatGPT auto-recharge window; no card on file, so no payment is
  possible). Never use a real customer or `credit-integrity-acceptance@` (its live test drains it).
- **Login:** a password login was attached 2026-10-03 (Supabase auth user
  `92e46b92-9834-44db-805e-19866bca9933`, email confirmed, `email` provider). The password was placed
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
  1. Sign in to ChatGPT → Settings → Apps & Connectors → Advanced → Developer mode ON → Create
     connector: URL `https://mcp.getmindy.ai/chatgpt/mcp`, auth OAuth.
  2. ChatGPT opens Mindy's `/oauth/authorize`. Signed out, it shows "Sign in or create an account"
     with **no free-credit promise** (ChatGPT resource). Open the sign-in link, sign in with the
     synthetic email + the clipboard password. The consent tab picks up the session by itself.
  3. The consent page must show the **ChatGPT** copy with **no free-credit promise**. Click **Allow**.
     ChatGPT should show the connector as connected.
  4. Confirm the connector lists **exactly 15** tools.
- **Per prompt:** new chat, developer mode ON, Mindy connector enabled, web search left at default
  (we want to see whether ChatGPT picks web or Mindy). **Never say "use Mindy"** unless a row says so.
  Start a stopwatch at Send, stop when the answer finishes streaming. Expand the tool-call panel to
  read the tool name + arguments.

## ⏱ Record the UTC start — immediately before the first prompt

Run `date -u +%Y-%m-%dT%H:%M:%SZ` right before sending the first prompt (after connecting, not before)
and write it here: `SINCE = ____________`. It is the `--since` for the server report, which isolates
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

## Collect the server-side evidence

After the session (read-only):

    npx tsx scripts/chatgpt-devmode-report.ts --email chatgpt-devmode-acceptance@getmindy.ai --since <SINCE>
    npx tsx scripts/chatgpt-devmode-report.ts --email chatgpt-devmode-acceptance@getmindy.ai --since <SINCE> --json > devmode-report.json

It prints per-tool n / p50 / p90 / max server latency, >45 s / >60 s counts, outcomes, the ledger
split (ChatGPT vs other debits), and the commerce invariants (paywall attempts, signup grants,
auto-recharge — all must be 0).

## Classification (one per tool)

`PASS` · `ROUTING_FAIL` (ChatGPT picked another tool / web / nothing for the tool's intended prompt) ·
`TIMEOUT` (host gave up or the call exceeded the host limit) · `TOOL_ERROR` (server outcome error /
degraded with no usable result) · `HOST_MISREPRESENTATION` (ChatGPT stated something the result did
not contain, or dropped a material caveat). A tool is PASS only if its direct test and every routing
row that targets it pass.

**capability_market_match** is a submission blocker if real ChatGPT calls time out or are
unacceptably slow; it is not a blocker to the deployed (unsubmitted) endpoint.
