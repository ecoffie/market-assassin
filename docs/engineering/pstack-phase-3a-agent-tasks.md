# PStack Phase 3A — Agent Task Registry

Repository-backed coordination for **Builder**, **Verifier**, and **Integrator** roles, plus **administrator** commands for human-recorded outcomes. Phase 3A is design + prototype only: no auto merge, deploy, or production mutation.

## Phase 3A boundary (honest)

| In scope | Out of scope |
|----------|--------------|
| Multiple local agents sharing **one filesystem** (same repo checkout path) | Multi-machine coordination across laptops/VMs |
| Exclusive lock + optimistic revision on `registry.json` | Transactional remote lease store |
| CLI-recorded human approvals (`promote`, `approve`, `record-merged`, `record-deployed`) | GitHub merge, Vercel deploy, or any automated ship |

Multi-machine coordination requires a transactional remote lease/store — **Phase 3B+**, not this commit.

## Architecture (Phase 3A.1 — shared runtime)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  .claude/agent-tasks/registry.json  (tracked seed — bootstrap only)     │
│  Empty schema example in git; runtime never writes here by default.      │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  {git-common-dir}/agent-tasks/registry.json  (shared runtime)           │
│  All worktrees resolve here via git rev-parse --git-common-dir.          │
│  Lock: {runtime}.lock  ·  Temp: {runtime}.tmp.{pid}                      │
└──────────────────────────────────────────────────────────────────────────┘
         ▲ locked read/write (mkdir lock → bootstrap-if-missing → mutate)
         │
┌────────┴────────┐    ┌──────────────────┐    ┌────────┴───────┐
│ scripts/        │    │ src/lib/agent-   │    │ Cursor /     │
│ agent-task.mts  │───▶│ tasks/           │◀───│ Claude agent │
│ doctor (read)   │    │ operations.ts    │    │ windows      │
└─────────────────┘    └────────┬─────────┘    └──────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   lock.ts                 lease.ts              collisions.ts
   registry.ts             validate.ts           stale-main.ts
   verification*.ts        checkpoint.ts         dependencies.ts
```

Example task shape lives in `scripts/fixtures/agent-tasks/example-task.json` — **not** in the live registry.

## Concurrency call graph

Every mutating CLI command → `operations.*` → `mutateRegistry`:

```
mutateRegistry(path, expectedRevision, mutator, { lockOwner })
  ├─ acquireRegistryLock (atomic mkdir on registry.json.lock/)
  │    ├─ write meta.json { owner, pid, sessionId, acquiredAt }
  │    ├─ bounded spin/wait (DEFAULT_LOCK_WAIT_MS)
  │    └─ fail closed: lock_timeout (never silent takeover)
  ├─ readRegistryFile
  ├─ revision check (optional expectedRevision → revision_conflict)
  ├─ mutator(reg) — validate transitions, leases, collisions, evidence
  ├─ revision++, assertRegistryInvariants
  ├─ writeRegistryFile (tmp + rename)
  └─ finally: lock.release() — rm lock dir
```

**Lock failure / recovery**

| Situation | Behavior |
|-----------|----------|
| Active lock held | Wait up to `DEFAULT_LOCK_WAIT_MS`, then `lock_timeout` |
| Crashed holder (dead PID) | Lock remains; **no auto takeover** |
| Stale lock (dead PID or age) | `agent-task recover-lock --role administrator --confirm` |
| Revision race inside lock | Second writer gets `revision_conflict` if `expectedRevision` set |

`readRegistryFile` / `integration-handoff` (read-only) do **not** take the lock — handoff re-reads after integrator holds lease.

## Call graph (CLI → lib)

| Command | Entry | Core functions |
|---------|-------|----------------|
| `list [--ready]` | `agent-task.mts` | `readRegistryFile` → `listTasks` |
| `promote` | admin only | `promoteTask` → audit log |
| `claim` | agent | `claimTask` → deps, stale-main, collisions, lease |
| `heartbeat` | owner | `heartbeatTask` → `renewLease` |
| `checkpoint` | owner | `appendCheckpoint` → role/state gates |
| `release` / `block` | owner | `releaseTask` / `blockTask` |
| `approve` | admin | `approveTask` (integration → awaiting_approval) |
| `record-merged` | admin | human PR + SHA only |
| `record-deployed` | admin | human deployment URL + SHA only |
| `integration-handoff` | integrator + lease | `prepareIntegrationHandoff` + verification evidence |
| `doctor` | read-only | `diagnoseRegistry` — paths + counts, no payloads |
| `seed-task` | admin | `upsertTask` from fixture JSON |

Registry override: `--registry PATH` or `AGENT_TASK_REGISTRY_PATH` (tests use disposable temp files). Default runtime: `{git-common-dir}/agent-tasks/registry.json`.

## Task states

```
proposed → ready → claimed → in_progress → verification → integration
                                                      ↓
                              approve (admin) → awaiting_approval → merged → deployed

Any active: → blocked | failed | cancelled
Lease expiry / release: claimed|in_progress → ready (safe recovery, no takeover)
```

Human-only transitions (CLI admin commands, never auto): `proposed→ready`, `integration→awaiting_approval`, `awaiting_approval→merged`, `merged→deployed`.

## Roles

| Role | Typical states | Responsibility |
|------|----------------|----------------|
| **Builder** | ready → claimed → in_progress → verification | Implement in worktree; checkpoint with tests |
| **Verifier** | verification → integration | Run verification profile; cannot verify own builder handoff unless `allowSameAgentVerification` |
| **Integrator** | integration → awaiting_approval | Stale-main + evidence gate via `integration-handoff` |
| **Administrator** | audit transitions | `promote`, `approve`, `record-merged`, `record-deployed`, `recover-lock` |

## Verification profiles

Machine-readable required commands in `verification-profiles.ts`. Integration handoff rejects:

- missing required command results
- `failed` or blocking `skipped` results
- `warn` on blocking commands (warn-only ≠ success)
- `headSha` mismatch vs current main (when git metadata supplied)
- results predating the latest verifier checkpoint

## File layout

| Path | Purpose |
|------|---------|
| `.claude/agent-tasks/registry.json` | Tracked **seed** (empty bootstrap example — runtime never writes here) |
| `{git-common-dir}/agent-tasks/registry.json` | Shared **runtime** registry (all worktrees) |
| `scripts/fixtures/agent-tasks/example-task.json` | Documentation fixture only |
| `src/lib/agent-tasks/lock.ts` | Exclusive filesystem lock |
| `src/lib/agent-tasks/registry.ts` | Locked `mutateRegistry` + atomic IO |
| `src/lib/agent-tasks/operations.ts` | All mutations + handoff |
| `scripts/agent-task.mts` | CLI (`npm run agent-task`) |
| `src/lib/agent-tasks/*.test.ts` | unit + concurrent + CLI e2e |

## Checkpoint schema (standard)

Every checkpoint includes: `actor`, `outcome`, `changedPaths`, `diffStat`, `evidence` (tests + commands + optional `commandResults`), `blockers`, `mutationsPerformed`, `authorizationConsumed`, `nextRequestedAction`. Merge and deploy mutations are rejected at validation time.

## Safety boundaries

- **No credentials** in registry files
- **No automatic merge/deploy** — admin commands record evidence refs only
- **No production mutation** — forbidden paths include env/credentials
- **Fail closed** on malformed JSON, lock timeout, revision conflict, stale main, path collisions
- **No manual JSON editing** as the normal lifecycle path — use CLI admin commands
- **Worktree compatible** — claim suggests `.claude/worktrees/<slug>`

## Verification profiles ↔ Phase 2 skills

| Profile | Required command(s) |
|---------|---------------------|
| `map-contract-verify` | `node scripts/verify-filter-contract.mjs` |
| `data-provenance` | `npm run test:chain` |
| `cross-surface-parity` | vitest saved-searches unit test |
| `ma-skills` | `npm run verify:ma-skills` |
| `oracles` | `npm run verify:oracles` |
| `docs-only` | `npm run verify:ma-skills` + `git diff --check`; docs/skills/registry paths only; admin promote evidence ≥12 chars |
