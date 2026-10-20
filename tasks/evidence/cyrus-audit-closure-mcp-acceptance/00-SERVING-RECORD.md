# Cyrus public MCP acceptance — against restored production main

**PASS.** All three of the runner's `compare` conditions are satisfied.

| | |
|--|--|
| Ran (UTC) | 2026-09-21T02:02:07Z → 02:02:14Z |
| Target | `https://mcp.getmindy.ai/mcp` |
| **Serving deployment** | `dpl_EBUSQ57JWB5TJtzafJWkJQYaF1sj` · READY · `target: production` · `source: git` |
| **Serving SHA** | `1262c59ef49453efde80a2a170f8951b58431f41` (ref `main`) |
| **Runner SHA** | `dece7dbae09d1fc9be904ad2a3d487aa8b6841e1` (local worktree checkout) |
| Result | `ok: true` · 33/33 assertions · `failures: []` · `flag_drift_vs_local: []` · exit 0 |

## Serving SHA vs runner SHA

They differ and that is expected. The runner SHA is only the local checkout. The serving
SHA is the **squash merge commit** of PR #1597 on `main`.

`dece7dba` is **not** an ancestor of `1262c59e` — #1597 was squash-merged, which rewrites the
commit. Ancestry is therefore the wrong test. Verified instead by **content equivalence**:

```
git diff --quiet dece7dba 1262c59e -- \
  src/lib/contractor/ src/lib/bigquery/ src/lib/chat/tier2-tools.ts \
  src/lib/awards-ingest/ scripts/cyrus-audit-closure-mcp-acceptance.ts
# => identical
```

The serving deploy **is** the merge SHA, so "serving deploy contains the merge SHA" holds
directly.

## Newer merged work preserved in the serving build

`1262c59e` contains #1595 (`isDispatcher` Bearer auth in
`src/app/api/cron/snapshot-multisite/route.ts`), #1596, #1598 and `.githooks/pre-push`.
Confirmed live, non-mutating:

| probe | result |
|---|---|
| prod + correct `Bearer $CRON_SECRET`, no `source` | `400 Missing required parameter: source` — auth **passed**, stopped before any work |
| prod + wrong bearer | `401` — control |
| superseded branch build `dece7dba` + correct bearer | `401` — the regression this restoration removed |

No ingestion was triggered.

## Authorized production writes made by this run

MCP one-shot key issued for `cyrus-audit-closure-mcp@getmindy.ai` and revoked in `finally`;
3 `tool_call` debits (−10, −10, −5 = **25 credits**). No new grant — balance was already
≥ 50, so `grantCredits` did not fire.

Prior run against the superseded branch deployment is retained at
`tasks/evidence/cyrus-audit-closure-mcp-acceptance-SUPERSEDED-branch-deploy/`.
