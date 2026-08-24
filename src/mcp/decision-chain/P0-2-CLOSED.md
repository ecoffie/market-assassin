# P0-2 — CLOSED on a confirmed live signal.

Merged `6a4da818`, deployed to production via git integration, verified against the
deployed MCP on 2026-08-24.

## Live acceptance test — all four calls pass

| # | Call | Result |
|---|---|---|
| 1 | FLUIDYNE #1 | **PASS** — `top_agencies`: Department of Defense $58,612,537 (100%). 5 real awards with PIIDs, NAVSUP/DLA offices, NAICS, set-aside flags. `enrichment_status: "complete"` |
| 2 | FLUIDYNE #2 | **PASS** — byte-identical payload, served from cache |
| 3 | LOCKHEED #1 | **PASS** — all **4** agencies (DoD 99.98%, NASA, DHS, Commerce), matching the header's `agencies_served: 4`. Awards include the F-35 Block Four contract at $98.2M |
| 4 | LOCKHEED #2 | **PASS** — identical payload, cached |

## Before vs after

| | before | after |
|---|---|---|
| FLUIDYNE `top_agencies` | `[]` | `[{DoD, $58.6M, 100%}]` |
| FLUIDYNE `recent_awards` | `[]` | 5 awards |
| LOCKHEED `top_agencies` | `[]` | 4 agencies |
| LOCKHEED `recent_awards` | `[]` | 5 awards |
| `enrichment_status` | absent | `"complete"` |

The header/body contradiction is gone: `agencies_served: 4` now sits beside four actual
agencies rather than an empty array.

## What the second calls prove

The design promise was never merely "live lookup works" — it was
**first cold request → scan → cache → subsequent request served without another scan**.
Both repeat calls returned identical payloads, confirming the enrichment cache is being
written (which the old `cacheOnly` path never did, and which is why cold keys stayed cold
forever).

Credits behaved as designed: 10 per call, the tool's flat metered price, unchanged by
whether a scan occurred.

## Not observed, and therefore not verified

`enrichment_status: "budget_limited"` did not appear in any of the four calls — the budget
was available throughout. **The degraded path is covered by unit tests but has not been
seen live.** The `[p0-2] enrichment budget_limited` telemetry will surface it if real users
hit it; if the rate is high, `allowColdLookup()` limits are too tight for a metered tool and
should be tuned separately — explicitly not by bypassing the guard.

## Note on the deploy

`vercel --prod` from the CLI failed with `Request body too large. Limit: 10mb`. This is
pre-existing repo bloat (a 39MB .pptx, an 8MB .pptx, PDFs and videos in the tracked tree),
not caused by this branch, though the 2.5MB of decision-chain fixtures contribute. **Vercel's
git integration deployed the merge automatically and successfully** — the CLI path was
unnecessary. Worth a separate cleanup: the CLI deploy route is currently broken for anyone
who needs it.
