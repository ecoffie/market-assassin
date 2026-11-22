# Feature: Where to start (market map)

**Prompts:** R1–R10 in `tests/fixtures/ask-mindy-regression.json` are FIND-style questions; they are the drive set.

**What a passing answer shows (graded by `grade.ts` against the turn's tool evidence):**
- First sentence answers the question; no count followed by "ask me to list them".
- Every expiring/open/forecast item named in the answer exists in that turn's tool evidence.
- A horizon that could not be checked is called unavailable, never zero.
- States the customer asked for are covered (no silently dropped state).

**With `ASK_MINDY_RECIPES` on for the test email (flag-gated PRs only):**
- The trace notices contain `fit_ranking_note` when `find_opportunities` ran.
- Top picks appear in the note's order, each with its plain-word reason; no numeric fit score is printed.
- A pick whose set-aside the test company does not hold is presented as a subcontract route.
- With the flag off, the same prompts produce the same grade as `main` (no regression rows).
