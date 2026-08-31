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
- **`commandResults.headSha` mismatch vs verified candidate head** (not vs current main)
- builder/verifier `candidateHeadSha` / `candidateTreeSha` mismatch or mixed command head SHAs
- assigned worktree HEAD/tree/branch/cleanliness diverging from verified candidate at handoff and approve
- results predating the latest verifier checkpoint
- **`currentMainSha` stale-main drift** — independent of candidate identity; never substitute candidate head for current main

## Commit identities (Phase 3A.2)

| Field | Meaning |
|-------|---------|
| `baseSha` | Authorized `origin/main` commit when the task was created — stale-main baseline |
| `candidateHeadSha` | Committed feature artifact HEAD being verified and integrated |
| `candidateTreeSha` | Tree object for `candidateHeadSha` |
| `currentMainSha` | Live `origin/main` at claim/handoff/approve — must match `baseSha` when main has not advanced |

Structured `candidateHeadSha` and `candidateTreeSha` live on builder `ready_for_verification` and verifier `verified` checkpoints (and in `commandResults.headSha`). Integration requires a **clean, committed** candidate in the assigned worktree whose HEAD matches the verified candidate — not `main`.

## File layout

| Path | Purpose |
|------|---------|
| `.claude/agent-tasks/registry.json` | Tracked **seed** (empty bootstrap example — runtime never writes here) |
| `{git-common-dir}/agent-tasks/registry.json` | Shared **runtime** registry (all worktrees) |
| `scripts/fixtures/agent-tasks/example-task.json` | Documentation fixture only |
| `src/lib/agent-tasks/lock.ts` | Exclusive filesystem lock |
| `src/lib/agent-tasks/registry.ts` | Locked `mutateRegistry` + atomic IO |
| `src/lib/agent-tasks/git-evidence.ts` | Sanitized git subprocess resolution (main + worktree artifact) |
| `src/lib/agent-tasks/candidate-artifact.ts` | Candidate identity extraction + worktree consistency |
| `src/lib/agent-tasks/verification.ts` | Evidence validation + integration gate |
| `src/lib/agent-tasks/operations.ts` | All mutations + handoff |
| `scripts/agent-task.mts` | CLI (`npm run agent-task`) |
| `src/lib/agent-tasks/*.test.ts` | unit + concurrent + CLI e2e |

## Checkpoint schema (standard)

Every checkpoint includes: `actor`, `outcome`, `changedPaths`, `diffStat`, `evidence` (tests + commands + optional `commandResults` + optional structured `candidateHeadSha` / `candidateTreeSha`), `blockers`, `mutationsPerformed`, `authorizationConsumed`, `nextRequestedAction`. Merge and deploy mutations are rejected at validation time.

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

---

## Phase 3A.3 — task supersession (stale-main lifecycle)

### `baseSha` is immutable, and that is a feature

A task's `baseSha` is the anchor every integration guarantee is measured against:

- `detectStaleMain` compares it to `origin/main` to decide whether the task may integrate;
- `resolveWorktreeArtifact` proves the candidate commit **descends from it**;
- the Builder's and Verifier's recorded evidence was produced against that exact base.

Editing `baseSha` in place would silently re-point all three at a base the recorded
evidence never ran against. The verified checkpoints would still *look* valid while
describing work done somewhere else — a confidently-wrong record, which is the failure
class this registry exists to prevent. There is therefore **no `baseSha` writer anywhere
in the registry**, and `promote` deliberately has no base parameter.

### When to supersede instead of reconcile

They solve different problems and are not interchangeable:

| | `reconcile-state` | `supersede` |
|---|---|---|
| Problem | phase was destroyed by the old always-ready release | base itself is stale; main moved on |
| Evidence | still valid against the **same** base | can no longer be integrated |
| Effect | repairs the task, preserving it | closes the task, opens a successor |
| Base | unchanged | successor anchored at current `origin/main` |

Rule of thumb: if `git rev-list --count <baseSha>..origin/main` is `0`, a broken phase is a
**reconcile**. If it is greater than `0`, the task is stale and needs a **supersede** — no
amount of reconciling will get it through the integration gate.

### Stale-main lifecycle

```
main advances past baseSha
        │
        ▼
integration-handoff / approve  →  stale_main (fail closed, by design)
        │
        ▼
administrator: supersede TASK-OLD --new-task TASK-NEW ...
        │
        ├── TASK-OLD  → cancelled, baseSha/checkpoints/audit PRESERVED, + supersededByTaskId
        └── TASK-NEW  → ready, baseSha = current origin/main, zero checkpoints
        │
        ▼
Builder claims TASK-NEW and rebuilds from the successor's current-main base
```

Both halves are written inside **one** `mutateRegistry` call: the registry is written once
and the revision advances exactly once, or nothing is written at all. There is no window in
which the source is cancelled but the successor is missing, which would strand the work.

### Source ↔ successor audit relationship

| | Source (`TASK-OLD`) | Successor (`TASK-NEW`) |
|---|---|---|
| Audit action | `supersede` | `superseded-from` |
| Transition | `<prior state>` → `cancelled` | `proposed` → `ready` |
| Link field | `supersededByTaskId` | `supersedesTaskId` |
| Metadata | `supersededByTaskId`, `oldBaseSha`, `newBaseSha`, `currentMainSha`, `reason` | `sourceTaskId`, `supersedesTaskId`, `oldBaseSha`, `newBaseSha`, `reason` |

The links are **mutual and enforced**: `assertRegistryInvariants` rejects a dangling
pointer, a one-sided link, a superseded source that is not `cancelled`, and self-supersession.
A chain is walkable with `supersessionChain(registry, id)`.

### The Builder starts from the successor's base

The successor is created with **zero checkpoints** on purpose. Old verification evidence is
retained *historically* on the cancelled source — it is a record of what was proven, and it
is never reused. Nobody may integrate `TASK-NEW` on the strength of a verification that ran
against `TASK-OLD`'s base; the Builder claims the successor and re-runs the work against
current main, and an independent Verifier re-verifies it.

### What the administrator may and may not supply

Supplied: successor **task ID**, **branch**, **worktree**, and **reason**.

Copied verbatim from the source: title, authorized scope, priority, dependencies,
allowedPaths, forbiddenPaths, verification profiles, allowed mutations, approval policy.

Never copied: checkpoints, lease, assigned actor/role, prior audit entries, merge/deploy
evidence, candidate head/tree identity, blocked or stale execution state.

`assertScopeNotWidened` runs on the **built** successor and rejects broader `allowedPaths`,
added `allowedMutations`, dropped `forbiddenPaths`, dropped verification profiles, a weakened
`approvalRequired`, newly-enabled `allowSameAgentVerification`, or silently dropped
dependencies. An administrator who can name a successor still cannot use it to grant that
successor more authority than the task it replaces.

The successor's base is resolved from **real `origin/main`** inside the CLI
(`resolveCurrentMainSha`). There is deliberately no `--no-git` path and no `--current-main`
override on `supersede`: fabricated main metadata is the one input that could silently anchor
a successor at a base that is not real.

### Usage

```bash
npm run agent-task -- supersede TASK-OLD \
  --new-task TASK-NEW \
  --branch BRANCH \
  --worktree WORKTREE \
  --actor ACTOR \
  --role administrator \
  --reason "why the base is stale" \
  --confirm
```

Rejected fail-closed when: the actor is not an administrator, `--confirm` or `--reason` is
missing, the source holds an **active** lease (an expired one is recoverable), the source is
terminal, the successor ID already exists or is malformed, the successor's branch or worktree
is already assigned to another live task, or the successor's paths overlap a **third** active
task. Overlap with the source itself is allowed — and only — because the source is cancelled
in the same atomic write.

`supersede` does **not** create the Git branch or worktree. The successor's Builder does that
after claiming it, which keeps worktree creation on the claim path where it already lives.
