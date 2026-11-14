# Mindy Stabilization Complete: acceptance checklist (DRAFT)

**Status:** draft for owners to refine. **Only Eric declares stabilization complete.** Every item must be proven by an end-to-end test on **production** (or a production-equivalent preview where stated), with the evidence linked. A merged PR is not evidence.

The new activation baseline (`ACTIVATION_BASELINE_START`) starts only after every essential item is green. Items marked *(enhancement)* do not block.

| # | Area | Acceptance criterion (proven on production) | Owner | Evidence |
|---|---|---|---|---|
| **A. Search relevance and reliability** |||||
| A1 | Discovery matcher | A fixed panel of real business descriptions returns relevant open opportunities at the agreed precision; pronoun/function-word regressions (#2047, #2050) covered by the panel | Agent 3 (search) + Agent 4 (relevance labels) | |
| A2 | Honest empty/unknown | A query with no matches says so; an unavailable source is shown as unavailable, never zero | Agent 3 | |
| A3 | Onboarding suggestions | The opportunities shown to a new account from its business description pass Agent 4's relevance review on a sample | Agent 4 | |
| **B. Ask Mindy accuracy, grounding and errors** |||||
| B1 | Grounding | **Set:** the frozen 11-question Ask Mindy benchmark (R1–R11) plus one beginner-language question ("We provide security guards. What government opportunities can we bid on?", which failed on production 2026-11-14), so 12 in total. Graded with rubric **v1.1**: v1.0 plus one rule covering question 12, "facts trace to evidence; a source that's missing or unavailable is never shown as zero". The set and the rubric are frozen before the first run and never changed between runs. **Pass:** 3 independent PRODUCTION runs, each graded by a fresh reviewer who sees only the answer and that turn's tool evidence. Every run scores 12/12 on fact grounding: every number, identifier, name and date traces to that turn's tool results, with zero fabrications. At most 1 disclosure miss (caveats or closing wording) per run, each one listed. **How to prove it:** production disables trace events, so capture the streamed answer and grade it against that window's app_chat `mcp_call_log` rows and tool payloads. Record each turn's UTC window, `llm_usage_log` cost and `tool_errors` (must be 0). State the model served: the staff account is moved to gpt-4o-mini by the margin guard, while customers get gpt-4o, so run on a synthetic account under budget or name the model. About $0.06 per run. Running it costs OpenAI money, so it needs Eric's go-ahead | Agent 1 | |
| B2 | Honest failure: **FAILING as of 2026-11-14** | **Evidence:** at 2026-11-14 20:09Z a chat turn overflowed the 128K context on tool results (`get_expiring_contracts` limit=200). The fallback model (groq llama-3.1-8b-instant) is retired and returns 404. The route then streamed raw `AI <status>: <provider error>` text to the user. **Pass, each case shown on production or a production build:** (a) a provider failure, including context overflow, gives a plain message that names what failed and suggests narrowing the question, with no raw provider text and no partial answer presented as complete; (b) a tool failure or empty result says that source was unavailable, never "none found" or zero; (c) a timeout gives an explicit "took too long" message; (d) each case logs a `tool_errors` row and a provider event; (e) no live reference to a retired model. **Depends on:** the fallback-model decision (Option A in Agent 1's fallback recommendation) and a cap on tool-result size. Both are development work and neither is authorized yet | Agent 1 | |
| **C. Card chat and credit charging** |||||
| C1 | Delivery and answer quality | **Delivery:** for a free account, a card question streams an answer about that opportunity. **Quality (B1 rubric):** a fixed set of 6 cards (2 open solicitations, 1 sources sought, 1 award/recompete, 1 forecast, 1 notice with sparse fields), each asked "What is this and who is buying?" and "What are the deadline and next step?". That is 12 turns, 3 independent runs, on synthetic accounts. **Pass:** every fact traces to that record's tool result, zero fabrications in all 3 runs. The answer stays on the record: no profile state or NAICS filters are applied to a record-scoped question, and the card context is passed as an identifier, not prose. Billing: at most one debit per answered turn, 0 on a disconnect or failure (C2). The flag stays off until this is proven | Agent 2 (delivery, billing) + Agent 1 (quality) | |
| C2 | Charge once | All six PR #2049 cases pass live (disconnect before/after completion, refresh/reopen, retry, concurrent duplicate, genuine follow-up); ledger reconciles to `card_chat_turns` exactly | Agent 2 | |
| C3 | Free when it fails | Failed, empty, degraded and length-cut answers charge 0 | Agent 2 | |
| C4 | Pro | A Pro card answer is saved and charges 0 | Agent 2 + Eric | |
| **D. Saved opportunities and tracking** |||||
| D1 | Track from the Map | Tracking an opportunity from a card saves it; a save failure is shown to the customer, never silent | Agent 2 / product (P0 save-failure causes from the Zillow audit) | |
| D2 | Access to saved work | A customer can find, open and remove what they tracked, from a second device | Agent 2 | |
| D3 | Portability *(enhancement)* | A customer can export their tracked opportunities | — | |
| **E. Alerts, contract changes and deadlines** |||||
| E1 | Saved-search alerts | Alerts run on the canonical evaluator (or the legacy one is proven equivalent); a test watch alerts on a matching new notice and not on a non-matching one | Agent 3 | |
| E2 | Change detection | A tracked opportunity with an amendment / deadline move produces a `pursuit_change_log` row and the owner's change email within the cron window | Agent 3 | |
| E3 | Email to app | The change/alert email link opens the right opportunity (record link, never filtered away) | Agent 3 | |
| **F. Registration and onboarding** |||||
| F1 | Every signup door | Email setup-password, password, Google, Microsoft and magic link each create an account, mint a session and land in the product | Agent 2 | |
| F2 | Funnel logging | Each door writes `signup_started` / `signup_completed` and exactly one `account_verified`; existing-account redirects are not failures | Agent 2 | |
| F3 | Introductory credits | A new account receives exactly 100 credits once | Agent 2 | |
| **G. End-to-end journey** |||||
| G1 | Discover → track → return | A synthetic new customer: describes business → sees relevant opportunities → tracks one → a real change on it is detected → the email brings them back to the opportunity → their saved work and any card answer are there | All agents; run jointly | |
| G2 | Activation dashboard | `/admin/activation` loads on production and reconciles with direct SQL on the same window | Agent 2 | |

## Open questions for owners
- A1/A3 precision threshold and panel: Agent 4 to propose from the Data Core relevance work.
- E1: is legacy-evaluator equivalence acceptable, or must #2043 be on? Agent 3 to decide.
- B1/C1: criteria set by Agent 1 (2026-11-14). The rubric (GRADING-RUBRIC.md, frozen as v1.1) lives in Agent 1's local evidence folder. Commit **only** GRADING-RUBRIC.md before the first graded run, after checking it holds no customer data: market-assassin is a PUBLIC repo. The rest of that folder (staff-account answers) stays local.
- B2: blocked on two unauthorized development items (fallback model, tool-result size cap). Eric to decide.
