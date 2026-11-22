# Feature: Opportunity deep dive

**Prompts:** add scenarios to `tests/fixtures/ask-mindy-regression.json` as they are recorded (a solicitation number
the test account may look up, for example from a public SAM.gov notice). No customer solicitation numbers.

**What a passing answer shows:**
- A pursue/pass read with its conditions, not a hedge.
- An incumbent is named only when the tool evidence identifies one; otherwise "could not identify", never "there is
  no incumbent".
- The question for the contracting officer comes from the notice's own documents in the evidence.
- No bid/no-bid gates are invented (the recipe leaves them to the answer, grounded in the documents).
