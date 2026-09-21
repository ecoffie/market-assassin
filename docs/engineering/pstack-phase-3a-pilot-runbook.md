# PStack Phase 3A — Local Three-Role Pilot Runbook

This runbook documents the **first controlled Phase 3A pilot**: a documentation-only task (`TASK-PSTACK-PILOT-001`) exercised by three local agent roles (Builder, Verifier, Integrator) plus a human Administrator. It is the operational companion to the architecture doc at `docs/engineering/pstack-phase-3a-agent-tasks.md`.

## Purpose and honest boundary

**Purpose:** prove that multiple local agents can coordinate on one repository using the Phase 3A agent-task registry — exclusive lock, optimistic revision, role-scoped leases, checkpoints, and verification profiles — without any automatic push, PR, merge, deploy, or production mutation.

**Honest local-filesystem boundary:** Phase 3A coordinates agents that share **one machine and one git common directory**. All worktrees resolve the **same runtime registry** at `{git-common-dir}/agent-tasks/registry.json`. This pilot does **not** support multiple machines, remote lease stores, or cross-host coordination. Multi-machine coordination is **Phase 3B+**.

| In scope (this pilot) | Out of scope |
|----------------------|--------------|
| Builder / Verifier / Integrator on one laptop | Agents on separate laptops or VMs |
| Shared runtime under `.git/agent-tasks/` | Transactional remote lease store |
| Local commits in an isolated worktree | Automatic `git push`, PR open, merge, deploy |
| CLI-recorded human approvals | Production env/credential mutation |

## Roles and responsibilities

| Role | Owner (this pilot) | States touched | Responsibility |
|------|-------------------|----------------|----------------|
| **Builder** | `pstack-pilot-builder` | `ready` → `claimed` → `in_progress` → `verification` | Claim before worktree; implement only within `allowedPaths`; one local commit; submit checkpoints with evidence |
| **Verifier** | `pstack-pilot-verifier` | `verification` → `integration` | Independent re-run of verification profile; cannot verify own Builder handoff (`allowSameAgentVerification: false`) |
| **Integrator** | `pstack-pilot-integrator` | `integration` → `awaiting_approval` | Stale-main, collision, dependency, and evidence gates via `integration-handoff`; prepares human handoff only |
| **Administrator** | `eric-orchestrator` | `proposed`→`ready`, `integration`→`awaiting_approval`, `awaiting_approval`→`merged`→`deployed`, lock recovery | Promote, approve, record merge/deploy with evidence refs; never auto-ship |

## Task states used in the pilot

```
proposed → ready → claimed → in_progress → verification → integration
                                                      ↓
                              approve (admin) → awaiting_approval → merged → deployed

Active recovery paths: → blocked | failed | cancelled
Lease expiry / release: claimed|in_progress → ready (safe recovery, no takeover)
```

Human-only transitions (Administrator CLI only): `proposed→ready`, `integration→awaiting_approval`, `awaiting_approval→merged`, `merged→deployed`.

## Claim-before-worktree rule

**Always claim the task before creating the branch or worktree.**

1. Preflight: task `state=ready`, `lease=null`, dependencies satisfied, collision count 0, branch/worktree absent, runtime lock absent.
2. `npm run agent-task -- claim TASK-ID --owner NAME --role builder`
3. Verify: `state=claimed`, lease owner matches, registry revision advanced, lock released, task absent from `--ready` queue.
4. Only then create the worktree at the task's `baseSha`.

Creating a worktree before claim risks two agents on the same paths without a lease.

## Shared runtime and lock locations

| Path | Role |
|------|------|
| `.claude/agent-tasks/registry.json` | **Tracked seed** — bootstrap example only; runtime never writes here by default |
| `.git/agent-tasks/registry.json` | **Shared runtime registry** — all worktrees read/write here via `git rev-parse --git-common-dir` |
| `.git/agent-tasks/registry.json.lock/` | Exclusive filesystem lock (`meta.json` with owner, pid, sessionId, acquiredAt) |
| `.git/agent-tasks/registry.json.tmp.{pid}` | Atomic write temp file during mutation |

Override for tests: `--registry PATH` or `AGENT_TASK_REGISTRY_PATH`.

## Heartbeat and lease expiry

- Default lease duration: **4 hours** (`DEFAULT_LEASE_MS`).
- Renew with: `npm run agent-task -- heartbeat TASK-ID --owner NAME [--role ROLE]`
- Each heartbeat updates `lastHeartbeatAt` and extends `expiresAt`.
- **No destructive takeover:** another owner may claim only after lease expiry (recovery path) or after the holder releases.
- On expiry while `claimed` or `in_progress`, safe recovery returns the task to `ready` without granting the next agent the previous holder's partial work.

## Allowed and forbidden path enforcement

Each task declares:

- **`allowedPaths`** — only these paths may appear in checkpoint `changedPaths` and receive `repo_files` / `git_commit` mutations.
- **`forbiddenPaths`** — glob patterns; any changed path matching these is rejected at checkpoint time (`forbidden_mutation`).

For `TASK-PSTACK-PILOT-001`:

- **Allowed:** `docs/engineering/pstack-phase-3a-pilot-runbook.md` only.
- **Forbidden (examples):** `src/**`, `scripts/**`, `package.json`, `.env*`, `**/credentials*`, `.claude/agent-tasks/registry.json`, etc.

Active tasks with overlapping `allowedPaths` while both hold leases produce **path collisions** — claim is rejected (`collision_count > 0`).

## Builder checkpoint structure

Every checkpoint must validate against the schema in `src/lib/agent-tasks/validate.ts`:

| Field | Requirement |
|-------|-------------|
| `id`, `at`, `actor`, `role` | Unique id; ISO timestamp; actor matches lease owner; role matches lease role |
| `outcome` | One of: `progress`, `ready_for_verification`, `verified`, `ready_for_integration`, `blocked`, `failed`, `released`, `awaiting_approval` |
| `changedPaths` | Repo-relative paths actually changed |
| `diffStat` | `{ files, insertions, deletions }` |
| `evidence` | `{ tests[], commands[], commandResults?, notes }` |
| `blockers` | Empty when unblocked |
| `mutationsPerformed` | Subset of task `allowedMutations` — never `merge` or `deploy` via checkpoint |
| `authorizationConsumed` | What claim/scope was used |
| `nextRequestedAction` | Explicit handoff instruction |

**Builder outcomes:**

- `progress` — `claimed` → `in_progress` (keeps lease)
- `ready_for_verification` — `in_progress` → `verification` (**clears Builder lease**)

Submit: `npm run agent-task -- checkpoint TASK-ID --owner NAME --file /path/outside/repo/cp.json`

Checkpoint JSON must live **outside the repository** so it is not accidentally committed.

## Independent Verifier evidence requirements

Verifier claims in `verification` state and must produce a checkpoint with:

- `outcome: verified` → transitions to `integration`
- **`evidence.commandResults`** for every **blocking** command in the task's `verificationProfile`
- For `docs-only` profile (this pilot):
  - `npm run verify:ma-skills` — status `passed`, blocking
  - `git diff --check` — status `passed`, blocking
- Each result: `{ command, status, ranAt, headSha?, exitCode? }`
- `warn` on a blocking command does **not** satisfy integration handoff
- Results must postdate the latest Builder `ready_for_verification` checkpoint
- Verifier **must not** be the same actor as the Builder unless `allowSameAgentVerification: true` (false for this pilot)

## Integrator stale-main, collision, and dependency checks

Before human approval, Integrator runs:

```bash
npm run agent-task -- integration-handoff TASK-PSTACK-PILOT-001 --owner pstack-pilot-integrator --role integrator
```

Handoff rejects when:

| Check | Failure code / behavior |
|-------|-------------------------|
| **Stale main** | Task `baseSha` behind `origin/main` (`main_moved_forward`) — fail closed, no auto-rebase |
| **Dependencies** | Any dependency not in terminal success state |
| **Path collisions** | Overlapping active leases on colliding paths |
| **Verification incomplete** | Missing, failed, or blocking-warn command results |
| **headSha mismatch** | Evidence headSha ≠ current branch HEAD when git metadata supplied |
| **Stale evidence** | Verifier results predating latest verifier checkpoint |

Integrator prepares handoff only — no push, PR, merge, or deploy.

## Human approval boundary

| Action | Who | CLI |
|--------|-----|-----|
| Promote task to ready | Administrator | `promote … --role administrator --evidence REF` |
| Approve integration | Administrator | `approve … --role administrator --evidence REF` |
| Record merge (human did it) | Administrator | `record-merged … --pr URL --sha SHA --evidence REF` |
| Record deploy (human did it) | Administrator | `record-deployed … --deployment URL --sha SHA --evidence REF` |

`approvalRequired: eric_explicit` on the pilot task — Eric must explicitly approve before any ship narrative. Registry records evidence refs only; it does not execute git or Vercel operations.

## Failure, block, release, and stale-lock recovery

| Situation | Command / procedure |
|-----------|---------------------|
| **Block** (owner) | `npm run agent-task -- block TASK-ID --owner NAME --reason TEXT` |
| **Release** (owner, voluntary) | `npm run agent-task -- release TASK-ID --owner NAME` → returns to `ready` |
| **Failed checkpoint** | `outcome: failed` from lease holder |
| **Lock timeout** | Wait up to `DEFAULT_LOCK_WAIT_MS` (5s); then `lock_timeout` — never silent takeover |
| **Stale runtime lock** | Dead PID or age ≥ `DEFAULT_LOCK_STALE_MS` (30 min): `npm run agent-task -- recover-lock --actor NAME --role administrator --confirm` |
| **Revision conflict** | Re-read registry revision; retry mutation with correct `expectedRevision` |
| **Lease conflict** | Wait for expiry or owner release; do not force-claim |

## Prohibitions (this pilot)

- **No automatic push, PR, merge, or deploy**
- **No credentials** in registry files or checkpoints
- **No production mutation** — forbidden paths include env and credentials patterns
- **No manual JSON editing** of the runtime registry as the normal lifecycle path
- **No multi-machine claims** — single shared filesystem only

## Sanitized CLI examples (this pilot)

All commands run from the **shared repository root** unless noted.

### Preflight

```bash
git fetch origin
git rev-parse HEAD origin/main
npm run agent-task -- doctor
npm run agent-task -- list --ready
npm run agent-task -- deps TASK-PSTACK-PILOT-001
npm run agent-task -- collisions
```

### Administrator — promote (already done for pilot)

```bash
npm run agent-task -- promote TASK-PSTACK-PILOT-001 \
  --state ready \
  --actor eric-orchestrator \
  --role administrator \
  --evidence "First controlled Phase 3A local documentation-only pilot."
```

### Builder — claim, worktree, progress, commit, handoff

```bash
npm run agent-task -- claim TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-builder \
  --role builder

git worktree add -b docs/pstack-phase-3a-pilot \
  .claude/worktrees/pstack-phase-3a-pilot \
  3c827cdc0a96f1ec5ab2384020bcf758726d0cc8

# checkpoint JSON written outside repo, e.g. /tmp/cp-progress.json
npm run agent-task -- checkpoint TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-builder \
  --file /tmp/cp-progress.json

cd .claude/worktrees/pstack-phase-3a-pilot
# … author allowed file only …
npm run verify:ma-skills
git diff --check
git add docs/engineering/pstack-phase-3a-pilot-runbook.md
git commit --author="Eric Coffie <evankoffdev@gmail.com>" \
  -m "docs(pstack): add Phase 3A pilot runbook"

npm run agent-task -- heartbeat TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-builder

npm run agent-task -- checkpoint TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-builder \
  --file /tmp/cp-ready-for-verification.json
```

### Verifier — claim and verify

```bash
npm run agent-task -- claim TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-verifier \
  --role verifier

cd .claude/worktrees/pstack-phase-3a-pilot
npm run verify:ma-skills
git diff --check
# record results in checkpoint commandResults, then:
npm run agent-task -- checkpoint TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-verifier \
  --file /tmp/cp-verified.json
```

### Integrator — handoff

```bash
npm run agent-task -- claim TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-integrator \
  --role integrator

npm run agent-task -- integration-handoff TASK-PSTACK-PILOT-001 \
  --owner pstack-pilot-integrator \
  --role integrator
```

### Administrator — approve and record (human performed git/vercel separately)

```bash
npm run agent-task -- approve TASK-PSTACK-PILOT-001 \
  --actor eric-orchestrator \
  --role administrator \
  --evidence "Eric reviewed pilot handoff."

npm run agent-task -- record-merged TASK-PSTACK-PILOT-001 \
  --actor eric-orchestrator \
  --role administrator \
  --pr "https://github.com/org/repo/pull/NNNN" \
  --sha "<merge-sha>" \
  --evidence "Human merged after review."

npm run agent-task -- record-deployed TASK-PSTACK-PILOT-001 \
  --actor eric-orchestrator \
  --role administrator \
  --deployment "https://getmindy.ai" \
  --sha "<deploy-sha>" \
  --evidence "Human deployed after review."
```

## Repeat-the-pilot checklist

1. [ ] `HEAD` equals task `baseSha`; runtime lock absent; seed registry unchanged in git.
2. [ ] Seed or upsert task; Administrator promotes to `ready` with ≥12 char evidence for `docs-only`.
3. [ ] Preflight: `doctor`, `deps`, `collisions`, `--ready` lists the task once.
4. [ ] Builder **claims first**, then creates branch/worktree at `baseSha`.
5. [ ] Builder: only `allowedPaths` change; one commit; subject-only message; no push.
6. [ ] Builder checkpoints: `progress` → `ready_for_verification` (JSON outside repo).
7. [ ] Verifier: independent claim; blocking commands in `commandResults`; `verified` checkpoint.
8. [ ] Integrator: `integration-handoff` passes stale-main + evidence gates.
9. [ ] Administrator: `approve` → human merge/deploy → `record-merged` / `record-deployed`.
10. [ ] Confirm: no credential files touched; runtime state only under `.git/agent-tasks/`.

---

*Phase 3A pilot — local filesystem only. Not valid for multi-machine coordination.*
