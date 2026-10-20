# SUPERSEDED — acceptance against the branch deployment, not main

This run is retained as history. It does **not** support production closure.

| | |
|--|--|
| Ran | 2026-09-21T01:53:51Z → 01:54:00Z |
| Target | `https://mcp.getmindy.ai/mcp` |
| Serving deployment at that time | `dpl_8KvnbR18VWnHY6FfdPuh2bezY4K2` |
| Serving commit | `dece7dba` — branch `fix/cyrus-freshness-provenance`, `source: cli`, `actor: cursor-cli` |
| Result | `ok: true`, no flag drift vs local baseline |

## Why it is superseded

The deployment under test was a CLI deploy of the **feature branch**, made 20s after the
#1597 squash merge and before any release approval. It took the production aliases from the
legitimate git build of the merge commit, and it **omitted newer merged main work** — notably
#1595's dispatcher-Bearer auth fix in `src/app/api/cron/snapshot-multisite/route.ts`.

The Cyrus fix code itself was exercised (branch head == reviewed head), but the runner's own
`compare` condition — "serving deploy contains the merge SHA" — was not satisfied.

Replaced by the acceptance run against the restored `main` deployment.
