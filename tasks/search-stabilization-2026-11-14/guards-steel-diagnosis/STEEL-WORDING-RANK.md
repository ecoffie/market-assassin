# Steel wording rank (Eric-approved, development only) — 2026-11-15

Branch `agent3/steel-wording-rank`, on top of F1+F3 (`3cc4d2224`). No tag, no release; RC3 untouched. Decision recorded by
Agent 4 at research `06e9503e2`.

**Rule:** for the steel preset only, a RELATED row whose **title or description** says "pre-engineered metal/steel
building", "standing seam", "metal roof(ing)", "steel building" or "red iron" ranks at tier 1.05. That puts it above every
other RELATED, code-only and filler row, and below DIRECT. Nothing is relabelled DIRECT. Title and description only:
those are the columns FIND Open selects, so the runner and the route see the same text (FIND never reads `sow_text`).

**Measured on the Nov 14 fixture** (Direct, distinct solicitations, lower–upper bound, Eric's labels take precedence):

| Phrasing | F1+F3 | + wording rank |
|---|---|---|
| Steel short | 6–9 | **7–10** (+1 unlabelled: "Child Development Center (CDC), Tinker AFB") |
| Steel long | 6–10 | 6–10 |
| The other 26 phrasings | — | top 20 identical |

**The three targets:**
- F-15 AGE Facility: short phrasing **rank 71 → 19**. Long phrasing was already at rank 14.
- Outdoor Fitness Facility (Eric: Direct): short phrasing already at rank 14. Long phrasing: matched, but **outside the
  500-row deadline window**, so no ranking rule can reach it.
- NAS JAX Large Aircraft Temporary Hangars: its wording ("metal building") is only in the SOW. Ranks 249 (short) and 28
  (long), unchanged. Adding `sow_text` to FIND's selected columns would be a separate, larger change.

Also outside the rule: "Minor Construction / Sustainability…" (Eric: Direct, "red iron" in the description) is labelled
WEAK_NON_MARKET, not RELATED, so Eric's rule leaves it at rank 281 (short) / 233 (long).

Steel short now has 7 of the 9 Eric-precedence Direct solicitations that exist in its top 20. Steel long has 6.
