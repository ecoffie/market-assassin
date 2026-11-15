# Deadline window: at least 5–7 days of lead time (Eric-approved, development only) — 2026-11-15

Eric: "that's too short of time for long searches; people need at least 5 to 7 days minimum." Branch
`agent3/deadline-window`, on top of `agent3/dla-nsn-parts` (e9c6f74ff). No tag; Maps untouched.

## Design (the lightest that fits today's SQL path)

1. **Lead-time window (retrieval).** FIND Open still draws the first 500 matched notices by deadline. When that window is
   **full**, it draws the same plan a second time with `response_deadline ≥ now + 7 days`, deadline-ordered and capped at
   500, and merges the two. That is one extra query, only on broad searches. It is a subset of the matched set; the count
   is unchanged.
2. **Soon demotion (ranking).** A bid closing in **under 5 days** gets **+0.5** on its tier. A Direct bid closing soon then
   sorts after Direct bids with time to respond, but still above every Related row. **Nothing is hidden** (no-self-filter
   rule); a deadline filter still returns it.

**Alternatives considered:**
- **Per-day stratified buckets** (N rows per day): more queries, and an arbitrary N per bucket.
- **Minimum lead-time ordering** (sort by lead time instead of deadline): changes the meaning of the window for every search.
- **A minimum lead-time filter**: hides bids, which violates the no-self-filter rule. Rejected.

**Trade-off of the chosen design:**
- The ≥7-day slice is itself deadline-ordered. For parts (about 5,500 matched) its 500 rows span only about a day (days
  7.9–8.8), so it guarantees time to respond, not breadth.
- The demotion reorders every business. A correctly-Direct bid closing in 3 days can now rank below a system-Direct bid
  that the AI reviewers call not Direct.

## Measured on the Nov 14 fixture (runner `deadline-window/runner-full.mts`; "now" = the cutoff instant)

Top-20 deadline spread (days from the cutoff: min / median / max, then the count closing in under 5 days):

| phrasing | before (dla-nsn-parts) | after |
|---|---|---|
| aircraft short |  0.7/  5.3/  15.1  10 |  5.8/ 16.2/  33.8   0 |
| aircraft long |  0.7/  5.3/   8.8  10 |  5.8/ 10.8/  17.8   0 |
| electrical short |  1.8/  9.3/  25.8   8 |  5.8/ 17.8/  25.8   0 |
| electrical long |  1.7/ 12.8/  22.8   5 |  5.8/ 16.3/  29.8   0 |
| fasteners short |  1.8/  9.8/ 727.2   6 |  5.4/ 12.0/ 727.2   0 |
| fasteners long |  1.8/  9.8/ 727.2   7 |  5.8/ 12.8/ 727.2   0 |
| grounds short |  1.6/  5.8/  43.8   9 |  1.8/ 10.1/  43.8   4 |
| grounds long |  1.6/  7.4/  43.8   7 |  1.8/ 10.1/  43.8   4 |
| guards short |  1.8/  8.4/  51.7   9 |  3.2/  8.4/  51.7   3 |
| guards long |  3.2/  8.8/1781.5   5 |  3.2/  8.8/1781.5   3 |
| hvac short |  1.5/  7.8/ 726.5   8 |  5.3/ 17.8/ 726.5   0 |
| hvac long |  1.3/  5.8/  15.9   9 |  5.8/ 18.2/ 727.2   0 |
| ithardware short |  1.7/ 13.3/ 727.2   5 |  1.7/ 15.8/ 727.2   4 |
| ithardware long |  1.7/ 13.3/ 727.2   5 |  1.7/ 15.8/ 727.2   4 |
| janitorial short |  1.2/  4.0/   5.9  13 |  1.7/  9.2/  17.6   4 |
| janitorial long |  1.2/  5.3/  22.8  10 |  5.7/ 16.0/  29.7   0 |
| medical short |  1.6/  5.7/ 727.2   9 |  3.6/  7.4/ 727.2   1 |
| medical long |  1.5/  5.8/ 137.9   8 |  1.5/  7.2/ 137.9   5 |
| nursing short |  1.2/  9.9/ 325.5   7 |  1.7/ 15.7/ 325.5   3 |
| nursing long |  1.2/  8.8/ 325.5   8 |  1.7/ 15.7/ 325.5   3 |
| parts short |  0.7/  1.0/   1.0  20 |  7.9/  8.1/   8.8   0 |
| parts long |  0.7/  1.0/   1.0  20 |  7.9/  8.8/   8.8   0 |
| paving short |  1.8/ 15.7/  60.9   5 |  3.7/ 16.2/1113.9   1 |
| paving long |  0.8/  5.9/  22.9   6 |  0.8/ 11.3/  60.9   2 |
| steelbldg short |  1.8/  8.8/  26.8   5 |  1.8/  8.8/  87.8   5 |
| steelbldg long |  1.7/  4.9/   9.0  11 |  1.8/  8.3/  26.8   5 |
| valves short |  0.9/  1.0/   1.0  20 |  5.8/  5.8/   6.7   0 |
| valves long |  1.5/  5.8/  19.8   6 |  5.8/  7.3/  19.8   0 |

- `check_expert`: Eric-Direct in top 20 **9 → 10**; not retrieved **2** (the inactive nursing notice); Eric Not-relevant in top 20 **0**.
- Direct scores move on every business, but **84 (business, notice) pairs in the new top 20s are unlabelled**, so most
  of the change cannot be judged yet. Measured with full labels already: **nursing short 10→9, long 11→9** (soon-closing
  Direct bids demoted below system-Direct rows with more lead time). Judge only after Agent 4's labels.
