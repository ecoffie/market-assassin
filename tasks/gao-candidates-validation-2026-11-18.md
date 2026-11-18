# GAO candidate validation — 2026-11-18 (Agent 3)

**Status: PREPARE / VALIDATE only.** Do **not** write `src/data/agency-pain-points.json`.
Preserve all **278** historical `(Source: GAO)` strings. Agent 4 owns any production data-file mutation.

## Verdict

| Measure | Count |
|---|---:|
| Candidates in proposal file | 111 |
| Already living (not a gain) | 60 |
| Net-new | 51 |
| Validation PASS (citations + date + https URL + agency) | 51 |
| Validation FAIL | 0 |
| Of PASS, clear (no review flag) | 41 |
| Of PASS, requires_review | 10 |

Machine-readable: `tasks/gao-candidates-validation-2026-11-18.json`.

## Guards applied (additive ingest readiness)

1. `document_number` matches `GAO-…`
2. `source_url` is `https://…`
3. `publication_date` is `YYYY-MM-DD` and **≥ 2001-01-01** (never re-inject 1993–2000)
4. Agency present; resolution not `unresolved`
5. Pain point text non-thin

## Decision still required (Eric / Agent 5)

- Adopt the 41 clear PASS net-new into `agency_painpoints_db` (recommended) vs served JSON (creates a second stale copy — decision pack warns against JSON).
- Human-check the 10 `requires_review` High-Risk program-owner mappings.
- Do **not** retire the 278 in this PR — presentation labeling ships instead.

## Failures

_None._
