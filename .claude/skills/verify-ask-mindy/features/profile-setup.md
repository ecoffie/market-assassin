# Feature: Profile setup and readiness

**Prompts:** add scenarios as they are recorded, using the TEST account's own UEI or website only.

**What a passing answer shows:**
- The readiness checklist items (SAM registration, NAICS, service codes, points of contact, past performance,
  keywords, SBA profile, website), each as in place, missing, unknown or unavailable.
- A failed SAM or award lookup reads as unavailable, never "unregistered" or "no past performance".
- SBA-only fields are reported unavailable (the SBA lookup is not built yet); website is unknown.
- Value first: no question about the company blocks the answer.
