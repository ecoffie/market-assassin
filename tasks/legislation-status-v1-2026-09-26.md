# get_legislation_status v1 — acceptance contract (2026-09-26)

Approved scope: legislation **status + document metadata** over the stored NDAA corpus
(`institute_sources`, #1559→#1644), through the #1699 shared reader. No bill text, no live
Congress API, no web, no collector / action-history / vote changes.

Why: fresh-host production test 2026-09-25 — "What is the status of the FY2027 NDAA?" in a
new claude.ai chat with the Mindy connector ON → host used web search only, never Mindy.
A tool alone does not fix that: the served connector instructions are 14,228 chars and the
host-visible portion ended at ~1,989; the existing routing section starts at char 8,406. So
v1 = tool + **routing line inside the visible top** + negative boundaries on neighbors.

## Stage model (the 10 version codes present in production, 2026-09-25)

| code | stage | chamber | enacted | display |
|---|---|---|---|---|
| IH | INTRODUCED | House | no | Introduced in the House |
| IS | INTRODUCED | Senate | no | Introduced in the Senate |
| RH | REPORTED_IN_HOUSE | House | no | Reported by House committee (not passed) |
| RS | REPORTED_IN_SENATE | Senate | no | Reported by Senate committee (not passed) |
| EH | HOUSE_PASSED | House | no | Passed the House |
| ES | SENATE_PASSED | Senate | no | Passed the Senate |
| CPS | SENATE_PASSED | Senate | no | Considered and passed the Senate |
| EAH | HOUSE_PASSED_WITH_AMENDMENT | House | no | House passed this Senate bill with an amendment (chambers not yet agreed) |
| ENR | ENROLLED | both | per measure | Enrolled — passed both chambers in identical form |
| PUBLIC-LAW | PUBLIC_LAW | — | yes | Public Law — the enacted authority |

Unknown code → `OTHER` with the raw Congress label; never promoted. Conference / calendar /
received-in-other-chamber codes are NOT represented and NOT invented.

## 19. Gold fixtures (hermetic, production row shapes)

| # | query | expected |
|---|---|---|
| A | What is the status of the FY2027 NDAA? | fy_vehicle; overall enacted=false; House H.R. 8800 HOUSE_PASSED; Senate S. 4784 REPORTED_IN_SENATE; 2 separate bills; reports HRPT-698 / SRPT-127; links; coverage complete; bill_text_not_held |
| B | Has the FY2027 NDAA become law? | same; enacted=false |
| C | HR8800 / H.R. 8800 / HR 8800 | bill; only H.R. 8800's 3 versions + HRPT-698; no Senate records |
| D | Show me the committee report for S 4784 | S. 4784 with SRPT-127 only; report provenance; law_status not_applicable |
| E | FY2026 NDAA / PL 119-60 / Public Law 119-60 | enacted via S. 1071 PL 119-60, enacted_by → PUBLIC-LAW record; H.R. 3838 + S. 2296 not enacted |
| F | S. Rept. 119-127 | committee report only; never a bill version |
| G | S. Rept. 119-39 errata | only the errata record, is_errata=true, separate from SRPT-39 |
| H | H.R. 1234 (coverage complete) / FY2027 with the vehicle absent | NOT_FOUND_IN_COVERED_CORPUS, scope stated (NDAA-titled, 119th Congress), never "does not exist" |
| I | same misses with coverage partial / unknown | NOT_ESTABLISHED |
| J | What does H.R. 8800 say about cybersecurity? | H.R. 8800 status + content_request {cybersecurity, topic} + content_status NOT_HELD; no title search |
| K | FY2025 NDAA / H.R. 2670 118th Congress | NOT_ESTABLISHED, out of held scope |
| L | What changed between the House and Senate NDAA? | content kind comparison, NOT_HELD |

Mutation controls: House-passed-as-law, reported-as-passed, partial-as-not-found,
report-as-bill-version each must turn a test red.

## 20. Fresh-host acceptance (after deploy; new claude.ai chat, Mindy ON, verbatim prompts)

| prompt | PASS |
|---|---|
| A What is the status of the FY2027 NDAA? | first Mindy tool = get_legislation_status; no Federal Register; stages right; nothing called law |
| B Has the FY2027 NDAA become law? | same tool; "no" with stage evidence |
| C Show me H.R. 8800. | same tool; H.R. 8800 only |
| D What does the FY2027 NDAA say about cybersecurity? | may use the tool for status; says text not held; no fabricated provisions |
| E What does the Navy care about? | get_agency_intel, not the status tool |
| F What new federal rules affect drones? | get_regulatory_demand, not the status tool |
| G I want to sell cybersecurity to SOCOM. | find_opportunities / P2 intact; status tool not called |

Record per prompt: first Mindy tool, web search Y/N, answer, any law mis-statement.

## 21. Implementation sequence

1. Reader: `readLegislativeCorpus()`, `groupLegislativeEvidence(rows, null)`, `version_code` on versions.
2. `legislation-query.ts` (deterministic resolution + content detection) + `legislation-stages.ts`.
3. `src/mcp/tools/legislation-status.ts` + fixtures A–L + mutations.
4. Registry / credits (5) / schemas / stdio server / tool group / smoke.
5. Routing line in `P2_FIRST_TURN_INSTRUCTIONS` + bullet in `MCP_CONNECTOR_INSTRUCTIONS`; tests.
6. Neighbor negative clauses (regulatory demand, agency intel, CAI) on both transports; boundary test.
7. Catalog: whitepaper + .docx, changelog, Tool Map artifact → mirror, literature, ledger, runbook.
8. Gate → PR → STOP. After merge approval: Git deploy, serving SHA, production checks, fresh-host A–G.

## 22. Decision record

- Corpus sufficient for status v1: YES (stages from stored versions; law from PUBLIC-LAW).
- Missing action history blocks status: NO — web-only roll calls / July 14 cloture are outside
  collected scope (collector stores only `latestAction`); stored stages agree with the web.
  Labelled `action_history_not_held`; wording "latest stored action as of …".
- Credits: 5 (3 PostgREST reads, 29 rows, ~0.26 s; neighbors lookup_solicitation /
  get_regulatory_demand / get_agency_intel = 5; 5 is the paid floor).
- Follow-up (not v1): the weekly `institute-legislation-sync` has one recorded run; the
  2026-09-27 13:40 UTC fire is the first operational proof — check `cron_job_runs`.
- GO.
