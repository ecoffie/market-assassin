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

---

## Phase 3A.4 — the candidate-evidence contract

Four corrections. Three close defects found on the real pilot; one removes a false positive
that trained operators to ignore the collision report.

### A. Structured candidate evidence is enforced AT CHECKPOINT TIME

**The schema location, stated exactly.** Candidate identity lives at, and only at:

```
checkpoint.evidence.candidateHeadSha   // string, /^[0-9a-f]{7,40}$/i
checkpoint.evidence.candidateTreeSha   // string, same pattern
```

declared on `TaskCheckpoint['evidence']` (`types.ts`) and shape-checked by `parseCheckpoint`
(`validate.ts`). **`evidence.notes` is free prose and is never read as evidence.**

Every newly submitted `ready_for_verification` or `verified` checkpoint must carry both
fields, and must satisfy:

- every **blocking** `commandResults[].headSha` equals `candidateHeadSha`
- no **mixed** evidence — any recorded head that disagrees is a contradiction, not a warning
- a Verifier's candidate head *and* tree equal the applicable Builder checkpoint's
- Builder and Verifier actors are **distinct** unless `allowSameAgentVerification` is set

`progress` (and `blocked` / `failed` / `released`) checkpoints are unaffected: they assert no
candidate, so requiring one would block honest interim reporting.

**The defect this closes.** On TASK-PSTACK-PILOT-002 both handoff checkpoints were *accepted*
with the structured fields absent — the candidate existed only as prose inside `notes`:

```
candidateHeadSha=4a02c915... candidateTreeSha=2ec36230... baseSha=5d8a3007...
```

Prose is not a schema. Nothing reads it, nothing validates it, nothing can compare it. The
task therefore advanced `ready -> verification -> integration`, dropping the Builder and
Verifier leases along the way, and failed only much later at `integration-handoff`. By then
the actors who could have fixed their own checkpoints no longer held leases. **A validation
that fires three transitions after the mistake is not a gate; it is an autopsy.**

The check runs *before any mutation*, so a rejected submission leaves the registry
byte-identical — no revision, state, checkpoint, audit or lease change — and the submitter
simply resubmits.

### B. Administrator candidate-evidence attestation

```bash
npm run agent-task -- attest-candidate-evidence TASK-ID \
  --actor ACTOR \
  --role administrator \
  --reason "..." \
  --confirm
```

For a task whose verified chain predates the structured contract. **It is not legacy
recovery, not a checkpoint rewrite, and not an override.**

- **Not a rewrite.** Checkpoints stay byte-identical. A checkpoint is a statement signed by
  the actor who made it; an administrator editing one would destroy the only property that
  makes the chain evidence. The attestation is stored *beside* the checkpoints, as a typed
  `candidateEvidenceAttestation` record, and cites the two checkpoint IDs it derives from.
- **Not an override.** There is no `--candidate-head`, no `--candidate-tree`, and no
  `--no-git`. The identity is **derived**: a unanimous `commandResults[].headSha` consensus
  across the Builder and Verifier checkpoints, reconciled against live Git. The tree is
  **read from the worktree**, never supplied. A caller who could type the SHAs would be
  attesting to nothing but their own typing.

Preconditions, all fail-closed, all checked before anything is written: state is
`integration`; lease is `null`; a Builder → Verifier chain exists in order with **distinct**
actors; structured evidence is genuinely **missing**; required commands passed, carry heads,
and postdate the appropriate checkpoints; commandResults are unanimous with none missing;
`task.baseSha` equals current `origin/main`; the live worktree is on the right branch,
**clean**, at exactly that head, and descended from base; and **no prior attestation exists**.

On success the write is deliberately narrow — state, lease, `assignedRole`, checkpoints and
prior audit entries are untouched; only the attestation is set, one
`candidate-evidence-attested` audit entry is appended, and the revision advances exactly once.

`integration-handoff` and `approve` accept the attestation as candidate identity **but still
rerun stale-main and live candidate-artifact validation.** It is honoured only while it still
describes the task (base, branch and worktree re-checked), so a supersede or re-point
invalidates it rather than silently carrying an old approval onto new work.

### C. One canonical task-worktree resolver

`src/lib/agent-tasks/task-worktree.ts` — `resolveSharedRepoRoot` /
`resolveTaskWorktreePath`.

**The bug.** Callers resolved a task worktree as `join(process.cwd(), task.worktree)`, which
is correct only from the main checkout. From a **linked worktree** — where the runbook puts
the Integrator — it nests the path into itself:

```
cwd  = /repo/.claude/worktrees/pilot-v2
task = .claude/worktrees/pilot-v2
join → /repo/.claude/worktrees/pilot-v2/.claude/worktrees/pilot-v2   # does not exist
```

Git then either walks up to the enclosing worktree and answers about the **wrong** repository
state, or fails naming a path no human configured. One is silently wrong; the other misdirects
the diagnosis.

**The fix.** A task's `worktree` is stored relative to the *shared repository root*, so it is
resolved against that root — derived from the absolute **git common directory**, the one value
identical from the main checkout, any linked worktree, and the task's own worktree. (This is
the same anchor `resolveRuntimeRegistryPath` already uses, so the registry and the artifacts
it describes now agree on where "the repository" is. `--show-toplevel` would reintroduce the
bug: it returns the *caller's* worktree.)

Path traversal outside the shared repository is **rejected**, not clamped — a task pointing
at `../../elsewhere` is a corrupt record, and rewriting it to something plausible would hide
that. Paths containing spaces work because every hop is `node:path` plus `execFile` argv,
never a shell string. Used by handoff, approve, attestation, and every artifact resolution.

### D. Collision report counts only active candidates

`findPathCollisions` filters only the *other* side, and the global sweep fed **every** task in
as a candidate — so a **cancelled** predecessor was reported as colliding with its own live
successor. That is precisely the shape supersession creates *on purpose*. A report that flags
the intended outcome of a supported operation trains operators to ignore it, which is worse
than no report.

Two corrections: the candidate side must itself be **active and lease-holding**, and each
genuine overlap is emitted **once** (canonical `taskId < otherTaskId`) instead of as two
mirrored rows that read as two problems.

**Task-specific behaviour is unchanged.** `findPathCollisions` remains the gate inside
`validateIntegrationGate` and `claimTask`, where the candidate is a known active task being
admitted and the asymmetry is correct — the question there is "may *this* task proceed", not
"what overlaps exist". Narrowing the shared helper would silently weaken both gates.

### Also fixed: an inverted evidence-freshness rule

`validateVerificationEvidence` required every command result to run at or **after** the
checkpoint reporting it. Real work runs the commands *first*, then writes the checkpoint — so
every honest verifier failed, and the only submissions that could pass were ones with
**fabricated timestamps postdating their own checkpoint.** The rule rewarded exactly what it
meant to prevent. Measured on the real pilot: `verify:ma-skills` ranAt `02:15:19` against
cp.at `02:15:30` → *"result predates latest verifier checkpoint"*.

It was invisible because the candidate-identity failure fired first. Freshness is now measured
against the **builder handoff** — the point from which the candidate commit exists — so
evidence gathered between handoff and the verifier's checkpoint is accepted, while evidence
predating the handoff (describing an earlier artifact) is still refused.

### ⚠️ Never use the bare-root source debris as the CLI implementation

The repository root is a **bare** repo, but it also holds a full working-tree snapshot left
over from an earlier session. Its `src/lib/agent-tasks/` is a **Phase 3A.1-era orphan**: 22
files against HEAD's 37, with `candidate-artifact.ts`, `candidate-evidence-contract.ts`,
`git-evidence.ts`, `release-phase.ts`, `supersession.ts`, `attestation.ts`,
`checkpoint-evidence.ts` and `task-worktree.ts` all absent, and **zero** occurrences of
`candidateHeadSha` or `supersede`.

It is not tracked, not a worktree (`git status` there fails with *"this operation must be run
in a work tree"*), and cannot be reached by any git operation — so nothing warns you it is
stale. Running the CLI from that root executes a version with no candidate contract at all,
which would silently accept exactly the submissions Phase 3A.4 exists to reject.

**Always run `agent-task` from a registered worktree**, never from the bare root. The runtime
registry itself is safe either way — it resolves through the git common dir — but the *code*
is not.
