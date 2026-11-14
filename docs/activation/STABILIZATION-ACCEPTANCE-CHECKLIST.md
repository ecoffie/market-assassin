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
| B1 | Grounding | A fixed question set: every fact traces to returned data; no fabricated numbers, names or dates | Agent 1 | |
| B2 | Error handling | Provider failure, tool failure and timeout each produce an honest message, never a wrong answer | Agent 1 | |
| **C. Card chat and credit charging** |||||
| C1 | Delivery | Free account: a card question streams a grounded answer about that opportunity | Agent 2 (+ Agent 1 for answer quality) | |
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
- B1: size of the fixed question set and pass bar. Agent 1 to propose.
